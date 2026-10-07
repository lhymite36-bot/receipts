#!/usr/bin/env node
// Receipts voice: casts a saved script (<out>.pkg.json) with TWO separate Gemini TTS voices and QA-checks the result.
//   node pipeline/voice-cast.js <out>          -> <out>.voice.wav, <out>.lines/NN-<who>.wav, <out>.voice-log.json
// - Skeptic (speakers me / narrator / others) and Claim Guy (speaker "brain") are generated in separate single-voice requests,
//   one request per character, split back into turns (consecutive lines) by an audio aligner; one request per turn as fallback,
//   so a model can never blend them into one voice.
// - Timing is ours: punchlines get a beat of silence before them; Claim Guy is sped up and louder.
// - QA (audio-features.js): per line pitch/variance/loudness/timbre; refuses (exit 5) when the two characters don't clearly differ
//   or a character is monotone. Exit 4 = TTS quota exhausted on every allowed model (never falls back to a flagged model unless allowed).
// env (defaults in pipeline/voice.env): VOICE_SKEPTIC, VOICE_CLAIM, STYLE_SKEPTIC, STYLE_CLAIM, TTS_MODELS (allowed, in order),
//   TTS_FLAGGED_MODELS + ALLOW_FLAGGED_MODEL=1, TTS_MAX_WAIT (s, wait for a 429 retry window up to this), CLAIM_TEMPO, ALLOW_FLAT=1.
'use strict';
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const A = require('./audio-features');
const OUT = process.argv[2]; if (!OUT) { console.error('usage: voice-cast.js <out-prefix>'); process.exit(2); }
const KEY = process.env.GEMINI_API_KEY; if (!KEY) { console.error('NO GEMINI_API_KEY'); process.exit(2); }
const E = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const CAST = {
  skeptic: { voice: E('VOICE_SKEPTIC', 'Algenib'), style: E('STYLE_SKEPTIC', 'Say in a dry, deadpan, sarcastic, unimpressed voice, crisp and clipped, with a smirk, letting each punchline land flat'), gainDb: -19, tempo: Number(E('SKEPTIC_TEMPO', '1.0')) },
  claim: { voice: E('VOICE_CLAIM', 'Puck'), style: E('STYLE_CLAIM', 'Say like an overconfident, loud, hyped-up influencer selling a miracle, fast and theatrical, totally sure of himself'), gainDb: -14.5, tempo: Number(E('CLAIM_TEMPO', '1.08')) },
};
const MODELS = E('TTS_MODELS', 'gemini-3.8-flash-tts,gemini-2.5-flash-preview-tts').split(',').map((s) => s.trim()).filter(Boolean);
const FLAGGED = E('TTS_FLAGGED_MODELS', 'gemini-3.8-flash-lite-tts,gemini-3.1-flash-tts-preview').split(',').map((s) => s.trim()).filter(Boolean);
const QUEUE = MODELS.concat(process.env.ALLOW_FLAGGED_MODEL === '1' ? FLAGGED : []);
const MAX_WAIT = Number(E('TTS_MAX_WAIT', '900'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const red = (s) => String(s).split(KEY).join('REDACTED');
const RATE = 24000;

const p0 = JSON.parse(fs.readFileSync(OUT + '.pkg.json', 'utf8')); const pkg = p0.pkg || p0;
const clean = (t) => String(t || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
const lines = pkg.beats.map((b, i) => ({ i, who: String(b.speaker || '').toLowerCase() === 'brain' ? 'claim' : 'skeptic', speaker: b.speaker || 'narrator', text: clean(b.text), punch: !!b.punch })).filter((l) => l.text);
const words = (t) => t.split(/\s+/).filter(Boolean).length;

// Raw takes are cached (<out>.takes/), so a quota stop never wastes the requests that already succeeded.
async function tts(model, voice, prompt) {
  const key = (parts) => require('crypto').createHash('sha1').update(model + '|' + voice + '|' + (parts.length === 1 && !parts[0].speech_metadata ? parts[0].text : JSON.stringify(parts))).digest('hex').slice(0, 16);
  const h = key(prompt.parts); const cf = OUT + '.takes/' + h + '.pcm';
  // A take requested earlier with the legacy "Say ...:" prompt on the same model + voice is reused too: alignSplit trims a
  // read-aloud preamble and every line is ASR-verified afterwards, so a bad take cannot slip through.
  const lf = prompt.legacy ? OUT + '.takes/' + key(prompt.legacy) + '.pcm' : null;
  for (const f of [cf, lf]) if (f && fs.existsSync(f)) { const buf = fs.readFileSync(f); const x = new Float32Array(buf.length >> 1); for (let i = 0; i < x.length; i++) x[i] = buf.readInt16LE(i * 2) / 32768; console.log('  cached take', path.basename(f, '.pcm') + (f === lf ? ' (legacy prompt)' : '')); return x; }
  const x = await ttsLive(model, voice, prompt); const buf = Buffer.alloc(x.length * 2); for (let i = 0; i < x.length; i++) buf.writeInt16LE(Math.round(x[i] * 32767), i * 2);
  fs.mkdirSync(OUT + '.takes', { recursive: true }); fs.writeFileSync(cf, buf); return x;
}
// Gemini 3.5+ TTS models take the delivery as speech_metadata.style and read the text verbatim (a "Say ...:" prefix can get
// read aloud there); older models take the documented natural-language prefix.
const structured = (m) => { const v = /gemini-(\d+(?:\.\d+)?)/.exec(m); return v && parseFloat(v[1]) >= 3.5; };
function ttsPrompt(model, style, text, batch) {
  const legacy = [{ text: batch ? style + '. Read each paragraph separately, with a clear one-second pause between paragraphs:\n\n' + text.join('\n\n') : style + ': ' + text }];
  if (structured(model)) return { model, legacy, parts: batch ? text.map((t) => ({ text: t, speech_metadata: { style } })) : [{ text, speech_metadata: { style } }] };
  return { model, parts: legacy };
}
async function ttsLive(model, voice, prompt) {
  const body = { contents: [{ role: 'user', parts: prompt.parts }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } };
  for (let a = 1; ; a++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { const d = (((j.candidates || [])[0] || {}).content || {}).parts; const au = d && d.map((x) => x.inlineData).find(Boolean); if (!au) throw Object.assign(new Error('no audio'), { soft: true });
      const buf = Buffer.from(au.data, 'base64'); const x = new Float32Array(buf.length >> 1); for (let i = 0; i < x.length; i++) x[i] = buf.readInt16LE(i * 2) / 32768; return x; }
    const msg = red(JSON.stringify(j.error || j)); const wait = /retry in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s/.exec(msg); const secs = wait ? (Number(wait[1] || 0) * 3600 + Number(wait[2] || 0) * 60 + Number(wait[3])) : 30;
    if (r.status === 429 && secs <= MAX_WAIT && a <= 4) { console.log(`  ${model} 429, waiting ${Math.ceil(secs)} s for the quota window`); await sleep((secs + 2) * 1000); continue; }
    if ((r.status === 500 || r.status === 503) && a <= 3) { console.log(`  ${model} ${r.status}, retry ${a}`); await sleep(a * 15000); continue; }
    throw Object.assign(new Error(`${model} HTTP ${r.status} ${msg.slice(0, 300)}`), { status: r.status, quota: r.status === 429, retryIn: secs });
  }
}
// split one take into n utterances: for each expected boundary (by word share of the speech span), take the nearby pause
// that best balances closeness and length. Robust to dramatic pauses inside a line.
function split(x, n, wc) {
  const hop = Math.round(0.01 * RATE); const fr = []; for (let s = 0; s + hop <= x.length; s += hop) { let e = 0; for (let i = 0; i < hop; i++) e += x[s + i] ** 2; fr.push(Math.sqrt(e / hop)); }
  const peak = Math.max(...fr); const th = Math.max(0.006, peak * 0.05); const voiced = fr.map((v) => v > th);
  const first = voiced.indexOf(true); const last = voiced.lastIndexOf(true); if (first < 0) return null;
  const seg = (a, b) => x.subarray(Math.max(0, (a - 3) * hop), Math.min(x.length, (b + 4) * hop));
  if (n === 1) return [seg(first, last + 1)];
  const gaps = []; let g = -1; for (let k = first; k <= last; k++) { if (!voiced[k] && g < 0) g = k; if (voiced[k] && g >= 0) { if (k - g >= 12) gaps.push({ a: g, b: k, len: k - g, c: (g + k) / 2 }); g = -1; } }
  if (gaps.length < n - 1) return null;
  const W = wc.reduce((p, q) => p + q, 0); let cum = 0; const cuts = []; let minA = first;
  for (let j = 0; j < n - 1; j++) {
    cum += wc[j]; const exp = first + (cum / W) * (last - first);
    const cand = gaps.filter((q) => q.a > minA && !cuts.includes(q)); if (!cand.length) return null;
    const best = cand.map((q) => ({ q, sc: Math.abs(q.c - exp) / 100 - Math.min(q.len, 120) / 100 * 0.9 })).sort((p, r) => p.sc - r.sc)[0].q;
    cuts.push(best); minA = best.b;
  }
  const segs = []; let st = first; cuts.forEach((c) => { segs.push([st, c.a]); st = c.b; }); segs.push([st, last + 1]);
  return segs.map(([a, b]) => seg(a, b));
}
// Our timing, not the model's: internal pauses longer than maxGap s are shortened to keep s (Claim Guy rattles on, Skeptic keeps short beats).
// Batch-take aligner: for each turn boundary, candidate pauses (nearest to the word-share estimate first) are checked by
// transcribing the audio up to that pause (Gemini audio understanding: text quota, not TTS quota) and comparing it with the
// expected words. Returns null when no candidate matches (caller falls back to one request per turn).
async function transcribe(x) {
  const tmp = `/tmp/vc-asr-${process.pid}`; A.writeWav(tmp + '.wav', x, RATE);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp + '.wav', '-ac', '1', '-ar', '16000', '-b:a', '48k', tmp + '.mp3']);
  const b64 = fs.readFileSync(tmp + '.mp3').toString('base64'); fs.unlinkSync(tmp + '.wav'); fs.unlinkSync(tmp + '.mp3');
  const body = { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/mp3', data: b64 } }, { text: 'Transcribe verbatim. Output only the words spoken.' }] }] };
  for (let round = 0; round < 4; round++) {
    for (const m of E('ASR_MODELS', 'gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.7-flash').split(',')) {
      try { const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body) }); if (!r.ok) continue; const j = await r.json(); return String(j.candidates[0].content.parts[0].text || ''); } catch (_) { /* next */ }
    }
    await sleep(20000 * (round + 1)); // all ASR models rate-limited / overloaded: back off and retry
  }
  return null;
}
const toks = (t) => String(t).toLowerCase().replace(/[0-9]+/g, (d) => ({ 1: 'one', 2: 'two', 3: 'three', 5: 'five', 10: 'ten' }[d] || d)).replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
function sim(heard, want) { const h = toks(heard); const w = toks(want); if (!w.length) return 0; let i = 0; let hit = 0; for (const t of w) { const k = h.indexOf(t, i); if (k >= 0) { hit++; i = k + 1; } } const extra = Math.max(0, h.length - w.length); return (hit - extra * 0.7) / w.length; }
async function alignSplit(x, paras) {
  const hop = Math.round(0.01 * RATE); const fr = []; for (let s = 0; s + hop <= x.length; s += hop) { let e = 0; for (let i = 0; i < hop; i++) e += x[s + i] ** 2; fr.push(Math.sqrt(e / hop)); }
  const th = Math.max(0.006, Math.max(...fr) * 0.05); const voiced = fr.map((v) => v > th); const first0 = voiced.indexOf(true); const last = voiced.lastIndexOf(true);
  const gaps = []; let g = -1; for (let k = first0; k <= last; k++) { if (!voiced[k] && g < 0) g = k; if (voiced[k] && g >= 0) { if (k - g >= 10) gaps.push({ a: g, b: k, c: (g + k) / 2 }); g = -1; } }
  // Read-aloud preamble (a model speaking its delivery instruction before the lines): if the take does not open with the first
  // paragraph, start at the first pause after which it does.
  let first = first0; const head = toks(paras[0]).slice(0, 3); const opens = (t) => { const h = toks(t).slice(0, head.length + 3); return head.filter((w) => h.includes(w)).length >= Math.min(2, head.length); };
  const h0 = await transcribe(x.subarray(first * hop, Math.min(x.length, (first + 400) * hop))); if (h0 == null) return null;
  if (!opens(h0)) {
    let found = false;
    for (const q of gaps.filter((q) => q.c < first + (last - first) * 0.6).sort((p, r) => (r.b - r.a) - (p.b - p.a)).slice(0, 8)) { const hh = await transcribe(x.subarray(q.b * hop, Math.min(x.length, (q.b + 400) * hop))); if (hh == null) return null; if (opens(hh)) { console.log('  aligner: trimmed read-aloud preamble (' + ((q.b - first) / 100).toFixed(1) + ' s)'); first = q.b; found = true; break; } }
    if (!found) { console.log('  aligner: take does not open with turn 1 (skipped or misread)'); return null; }
  }
  const wc = paras.map((p) => words(p)); const W = wc.reduce((p, q) => p + q, 0); let cum = 0; const cuts = []; let st = first;
  for (let j = 0; j < paras.length - 1; j++) {
    cum += wc[j]; const exp = first + (cum / W) * (last - first);
    const cand = gaps.filter((q) => q.a > st + 20).sort((p, q) => Math.abs(p.c - exp) - Math.abs(q.c - exp)).slice(0, 6);
    let best = null;
    for (const q of cand) { const heard = await transcribe(x.subarray(st * hop, q.a * hop)); if (heard == null) return null; const sc = sim(heard, paras[j]); if (!best || sc > best.sc) best = { q, sc }; if (sc >= 0.9) break; }
    if (!best || best.sc < 0.75) { console.log('  aligner: no pause matches turn ' + (j + 1) + (best ? ' (best ' + best.sc.toFixed(2) + ')' : '')); return null; }
    cuts.push(best.q); st = best.q.b;
  }
  const segs = []; st = first; cuts.forEach((c) => { segs.push([st, c.a]); st = c.b; }); segs.push([st, last + 1]);
  console.log('  aligner: split at ' + cuts.map((c) => (c.c / 100).toFixed(2) + 's').join(', '));
  return segs.map(([a, b]) => x.subarray(Math.max(0, (a - 3) * hop), Math.min(x.length, (b + 4) * hop)));
}
function compressSilence(x, maxGap, keep) {
  const hop = Math.round(0.01 * RATE); const n = Math.floor(x.length / hop); const fr = []; for (let k = 0; k < n; k++) { let e = 0; for (let i = 0; i < hop; i++) e += x[k * hop + i] ** 2; fr.push(Math.sqrt(e / hop)); }
  const th = Math.max(0.006, Math.max(...fr) * 0.05); const out = []; let k = 0;
  while (k < n) { if (fr[k] > th) { out.push(x.subarray(k * hop, (k + 1) * hop)); k++; continue; } let j = k; while (j < n && fr[j] <= th) j++; const len = (j - k) * 0.01;
    if (len > maxGap && k > 0 && j < n) { const kk = Math.round(keep / 0.01); out.push(x.subarray(k * hop, (k + Math.ceil(kk / 2)) * hop)); out.push(x.subarray((j - Math.floor(kk / 2)) * hop, j * hop)); } else out.push(x.subarray(k * hop, j * hop)); k = j; }
  out.push(x.subarray(n * hop)); const tot = out.reduce((a, b) => a + b.length, 0); const y = new Float32Array(tot); let o = 0; out.forEach((b) => { y.set(b, o); o += b.length; }); return y;
}
function tempoGain(x, tempo, gainDb, tag, who) {
  let y = who === 'claim' ? compressSilence(x, 0.22, 0.12) : compressSilence(x, 0.6, 0.42);
  if (Math.abs(tempo - 1) > 0.005) { const a = `/tmp/vc-${process.pid}-${tag}-a.wav`; const b = `/tmp/vc-${process.pid}-${tag}-b.wav`; A.writeWav(a, x, RATE);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', a, '-af', 'atempo=' + tempo, '-ar', String(RATE), '-ac', '1', b]); y = A.readWav(b).x; fs.unlinkSync(a); fs.unlinkSync(b); }
  let e = 0; let n = 0; for (let i = 0; i < y.length; i++) { if (Math.abs(y[i]) > 0.01) { e += y[i] ** 2; n++; } } const rms = Math.sqrt(e / Math.max(1, n));
  const g = Math.pow(10, gainDb / 20) / (rms || 1); const out = new Float32Array(y.length); for (let i = 0; i < y.length; i++) { const v = y[i] * g; out[i] = Math.tanh(v * 1.1) / Math.tanh(1.1); }
  return out;
}
// A turn = consecutive lines of one character. Inside a turn, a punchline is preceded by "..." so the voice takes a beat.
const turnText = (t) => t.map((l, k) => (k && l.punch ? '... ' : '') + l.text).join(' ');
async function castCharacter(model, who, ls) {
  // returns units [{ ls: [lines of one turn], x }]: one batch request per character split at the pauses, else one request per turn.
  const c = CAST[who];
  const turns = []; ls.forEach((l) => { const t = turns[turns.length - 1]; const contiguous = t && lines.slice(lines.indexOf(t[t.length - 1]) + 1, lines.indexOf(l)).every((m) => m.who === who); if (t && contiguous) t.push(l); else turns.push([l]); });
  // Default: one request per character (saves TTS quota), split per turn with the aligner; TTS_BATCH=0 or a failed
  // alignment -> one request per turn.
  if (turns.length > 1 && process.env.TTS_BATCH !== '0') {
    const x = await tts(model, c.voice, ttsPrompt(model, c.style, turns.map(turnText), true)); const segs = await alignSplit(x, turns.map(turnText));
    const ok = segs && segs.every((sg, k) => { const spw = (sg.length / RATE) / Math.max(1, words(turnText(turns[k]))); return spw > 0.15 && spw < 1.2; });
    if (ok) return { units: segs.map((sg, k) => ({ ls: turns[k], x: sg })), method: 'one request per character, aligned + split per turn', calls: 1 };
    console.log('  batch take did not split into ' + turns.length + ' turns; falling back to one request per turn');
  }
  const units = []; for (const t of turns) { const x = await tts(model, c.voice, ttsPrompt(model, c.style, turnText(t), false)); units.push({ ls: t, x: split(x, 1, [1])[0] }); }
  return { units, method: 'one request per turn', calls: turns.length };
}
(async () => {
  const groups = { skeptic: lines.filter((l) => l.who === 'skeptic'), claim: lines.filter((l) => l.who === 'claim') };
  // Each character is cast on the first allowed model that has quota (the two voices are separate requests anyway).
  const casts = {}; const usedBy = {}; const tried = new Set();
  for (const who of ['claim', 'skeptic']) {
    if (!groups[who].length) continue;
    for (const model of QUEUE) {
      tried.add(model);
      try { console.log(`TTS ${model} ${who} voice=${CAST[who].voice} lines=${groups[who].length}`); casts[who] = await castCharacter(model, who, groups[who]); casts[who].model = model; usedBy[who] = model; break; }
      catch (e) { console.log('  ' + e.message.slice(0, 260)); if (!e.quota && !(e.status >= 500)) throw e; }
    }
    if (!casts[who]) { console.log('TTS_QUOTA: no allowed model has quota for ' + who + ': ' + [...tried].join(', ') + (process.env.ALLOW_FLAGGED_MODEL === '1' ? '' : ' (flagged models not allowed: ' + FLAGGED.join(', ') + ')')); process.exit(4); }
  }
  const used = [...new Set(Object.values(usedBy))].join(' + ');
  // assemble with our own comic timing
  const dir = OUT + '.lines'; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const parts = []; const log = []; let prev = null; let t = 0;
  const units = Object.entries(casts).flatMap(([who, cst]) => cst.units.map((u) => Object.assign(u, { who, method: cst.method, model: cst.model }))).sort((a, b) => a.ls[0].i - b.ls[0].i);
  for (const u of units) {
    const c = CAST[u.who]; const l = u.ls[0]; const y = tempoGain(u.x, c.tempo, c.gainDb, l.i, u.who); const text = u.ls.map((m) => m.text).join(' ');
    const gap = prev === null ? 0.05 : l.punch ? 0.6 : prev !== u.who ? 0.28 : 0.14;
    parts.push(new Float32Array(Math.round(gap * RATE))); t += gap;
    const f = path.join(dir, String(l.i).padStart(2, '0') + '-' + u.who + '.wav'); A.writeWav(f, y, RATE); parts.push(y);
    const ft = A.features(y, RATE, words(text));
    if (process.env.ASR_CHECK !== '0') { const heard = await transcribe(y); ft.asr = heard == null ? null : +sim(heard, text).toFixed(2); ft.heard = heard == null ? null : heard.trim().slice(0, 300); }
    log.push(Object.assign({ i: u.ls.map((m) => m.i).join('+'), who: u.who, speaker: u.ls.map((m) => m.speaker).join('+'), voice: c.voice, model: u.model, method: u.method, punch: l.punch, start: +t.toFixed(2), text, file: f }, ft)); t += y.length / RATE; prev = u.who;
  }
  parts.push(new Float32Array(Math.round(0.35 * RATE)));
  const total = parts.reduce((s, p) => s + p.length, 0); const all = new Float32Array(total); let o = 0; parts.forEach((p) => { all.set(p, o); o += p.length; });
  A.writeWav(OUT + '.voice.wav', all, RATE);
  // QA
  const agg = (who) => { const L = log.filter((x) => x.who === who && x.voiced > 8); if (!L.length) return null; const w = L.map((x) => x.dur);
    const wm = (k) => +(L.reduce((s, x) => s + x[k] * x.dur, 0) / w.reduce((s, v) => s + v, 0)).toFixed(2); return { lines: L.length, f0: Math.round(A.median(L.map((x) => x.f0))), f0StdSt: wm('f0StdSt'), lineF0SpreadSt: +A.std(L.map((x) => 12 * Math.log2(x.f0))).toFixed(2), rmsDb: wm('rmsDb'), rmsStdDb: wm('rmsStdDb'), centroid: Math.round(wm('centroid')), wps: wm('wps') }; };
  const S = agg('skeptic'); const C = agg('claim'); const checks = [];
  const chk = (name, ok, val) => checks.push({ name, ok: !!ok, val });
  if (S && C) {
    const dSt = +Math.abs(A.semis(C.f0, S.f0)).toFixed(1); const dCent = +(Math.abs(C.centroid - S.centroid) / S.centroid * 100).toFixed(0);
    chk('voices differ: pitch gap >= 4 semitones or timbre (centroid) gap >= 20%', dSt >= 4 || dCent >= 20, { pitchGapSt: dSt, centroidGapPct: dCent });
    chk('Claim Guy faster than Skeptic (words/s)', C.wps > S.wps * 1.05, { claim: C.wps, skeptic: S.wps });
    chk('Claim Guy louder than Skeptic (>= 2 dB)', C.rmsDb - S.rmsDb >= 2, { claim: C.rmsDb, skeptic: S.rmsDb });
    const mis = log.filter((x) => x.voiced > 8).filter((x) => { const own = x.who === 'claim' ? C : S; const oth = x.who === 'claim' ? S : C; return Math.abs(A.semis(x.f0, own.f0)) > Math.abs(A.semis(x.f0, oth.f0)) + 1; }).map((x) => x.i);
    chk('every line sounds like its own character (pitch nearer its own voice)', mis.length <= Math.floor(log.length / 8), { suspectLines: mis });
  }
  const asrBad = log.filter((x) => x.asr != null && x.asr < 0.75).map((x) => x.i); const asrN = log.filter((x) => x.asr != null).length;
  chk('every take says exactly its lines (ASR similarity >= 0.75; catches read-aloud instructions / skipped words)', asrN === 0 ? true : !asrBad.length, asrN ? { badTurns: asrBad, checked: asrN } : 'ASR unavailable');
  for (const [nm, X] of [['Skeptic', S], ['Claim Guy', C]]) if (X) chk(nm + ' not monotone (pitch variation >= 2.0 st within lines)', X.f0StdSt >= 2.0, X.f0StdSt);
  if (C) chk('Claim Guy energy varies (loudness std >= 3 dB)', C.rmsStdDb >= 3, C.rmsStdDb);
  const flagged = Object.values(usedBy).some((m) => FLAGGED.includes(m)); if (flagged) chk('no flagged (flatter) TTS model used', false, usedBy);
  const pass = checks.every((c) => c.ok);
  const report = { model: usedBy, flaggedModel: flagged, cast: { skeptic: { voice: CAST.skeptic.voice, style: CAST.skeptic.style, tempo: CAST.skeptic.tempo }, claim: { voice: CAST.claim.voice, style: CAST.claim.style, tempo: CAST.claim.tempo } }, duration: +(total / RATE).toFixed(2), summary: { skeptic: S, claim: C }, checks, pass, lines: log };
  fs.writeFileSync(OUT + '.voice-log.json', JSON.stringify(report, null, 1));
  console.log('VOICE', used, 'dur', report.duration, 's | skeptic', JSON.stringify(S), '| claim', JSON.stringify(C));
  checks.forEach((c) => console.log((c.ok ? '  PASS ' : '  FAIL ') + c.name + ' ' + JSON.stringify(c.val)));
  if (!pass && process.env.ALLOW_FLAT !== '1') { console.log('VOICE_QA_FAIL (not shipping this take)'); process.exit(5); }
  console.log('VOICE_QA_PASS');
})().catch((e) => { console.error('FATAL', red(e.stack || e)); process.exit(1); });
