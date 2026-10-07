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
  skeptic: { voice: E('VOICE_SKEPTIC', 'Algenib'), style: E('STYLE_SKEPTIC', 'Say in a dry, deadpan, sarcastic, unimpressed voice, crisp and clipped, with a smirk, letting each punchline land flat'), gainDb: Number(E('GAIN_SKEPTIC', '-19.5')), tempo: Number(E('SKEPTIC_TEMPO', '1.0')) },
  claim: { voice: E('VOICE_CLAIM', 'Puck'), style: E('STYLE_CLAIM', 'Say like an overconfident, loud, hyped-up influencer selling a miracle, fast and theatrical, totally sure of himself'), gainDb: Number(E('GAIN_CLAIM', '-13')), tempo: Number(E('CLAIM_TEMPO', '1.08')) },
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
  if (process.env.TTS_OFFLINE === '1') throw Object.assign(new Error(model + ' not called (TTS_OFFLINE=1: cached takes only)'), { quota: true });
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
// Take cleanup, before any splitting: Gemini 3.8 TTS takes were seen ending in a ~0.14 s DC-shifted, full-scale noise burst
// (it sounded like a loud "system error" beep in the Short and stretched the pause before it). Any voiced stretch that
// contains a burst (30 ms mean > 0.08; real speech stays < 0.04) is cut out together with the silence before it, then DC is
// removed (one-pole high-pass at 50 Hz). Returns { x, glitches: [{ t, dur }] }.
function cleanTake(x0) {
  const hop = Math.round(0.01 * RATE); const n = Math.floor(x0.length / hop); const x = Float32Array.from(x0); const glitches = [];
  const fr = []; for (let k = 0; k < n; k++) { let e = 0; for (let i = 0; i < hop; i++) e += x[k * hop + i] ** 2; fr.push(Math.sqrt(e / hop)); }
  const th = Math.max(0.006, A.median(fr.filter((v) => v > 0.006)) * 0.15 || 0.006);
  const bad = new Uint8Array(n); for (let k = 0; k + 3 <= n; k++) { let m = 0; for (let i = 0; i < 3 * hop; i++) m += x[k * hop + i]; if (Math.abs(m / (3 * hop)) > 0.08) for (let j = k; j < k + 3; j++) bad[j] = 1; }
  for (let k = 0; k < n; k++) {
    if (!bad[k]) continue; let a = k; while (a > 0 && fr[a - 1] > th) a--; let b = k; while (b < n && (fr[b] > th || bad[b])) b++;
    if ((b - a) * 0.01 > 0.6) { for (let j = a; j < b; j++) bad[j] = 0; continue; } // long stretch: real speech, leave it to ASR/QA
    glitches.push({ t: +(a * 0.01).toFixed(2), dur: +((b - a) * 0.01).toFixed(2) });
    for (let i = a * hop; i < Math.min(x.length, b * hop); i++) x[i] = 0; for (let j = a; j < b; j++) { bad[j] = 0; fr[j] = 0; } k = b;
  }
  // a cut burst at the very end leaves a long dead tail: trim trailing silence to 0.25 s
  let last = n - 1; while (last > 0 && fr[last] <= th) last--; const keep = Math.min(x.length, (last + 25) * hop);
  const y = x.subarray(0, keep); let px = 0; let py = 0; const a = Math.exp(-2 * Math.PI * 50 / RATE); for (let i = 0; i < y.length; i++) { const v = y[i]; py = a * (py + v - px); px = v; y[i] = py; }
  return { x: y, glitches };
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
    for (const q of gaps.filter((q) => q.c < first + (last - first) * 0.85).sort((p, r) => (r.b - r.a) - (p.b - p.a)).slice(0, 8)) { const hh = await transcribe(x.subarray(q.b * hop, Math.min(x.length, (q.b + 400) * hop))); if (hh == null) return null; if (opens(hh)) { console.log('  aligner: trimmed read-aloud preamble (' + ((q.b - first) / 100).toFixed(1) + ' s)'); first = q.b; found = true; break; } }
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
  out.push(x.subarray(n * hop)); const tot = out.reduce((a, b) => a + b.length, 0); const y = new Float32Array(tot); let o = 0; const cuts = [];
  out.forEach((b, k) => { y.set(b, o); if (k && b.byteOffset !== out[k - 1].byteOffset + out[k - 1].byteLength) cuts.push(o); o += b.length; });
  const f = Math.round(0.004 * RATE); cuts.forEach((c) => { for (let i = -f; i < f; i++) { const j = c + i; if (j >= 0 && j < y.length) y[j] *= Math.abs(i) / f; } }); return y; // fade each cut (no clicks)
}
// Character colour (ffmpeg): Claim Guy brighter + compressed (presence boost at 2.5 kHz, split-band de-esser: the band above
// 4.5 kHz is compressed 8:1, no air shelf; v3's treble shelf made his "s" harsh, ZCR ~0.8 at 0.9 FS. ffmpeg's deesser filter
// added DC at strong settings, hence the split band), Skeptic darker and warmer.
const EQ = { claim: E('EQ_CLAIM', 'highpass=f=150,equalizer=f=2500:t=q:w=1.0:g=4,asplit[a][b];[a]lowpass=f=4500:p=2,lowpass=f=4500:p=2[l];[b]highpass=f=4500:p=2,highpass=f=4500:p=2,acompressor=threshold=-34dB:ratio=8:attack=1:release=40[h];[l][h]amix=inputs=2:normalize=0,acompressor=threshold=-22dB:ratio=3:attack=4:release=80:makeup=2,highpass=f=80'),
  skeptic: E('EQ_SKEPTIC', 'highpass=f=55,bass=g=3:f=170,equalizer=f=3500:t=q:w=1.5:g=-2,lowpass=f=7000') };
function tempoGain(x, tempo, gainDb, tag, who) {
  let y = who === 'claim' ? compressSilence(x, 0.22, 0.12) : compressSilence(x, 0.6, 0.42);
  const af = [Math.abs(tempo - 1) > 0.005 ? 'atempo=' + tempo : '', EQ[who] || ''].filter(Boolean).join(',');
  if (af) { const a = `/tmp/vc-${process.pid}-${tag}-a.wav`; const b = `/tmp/vc-${process.pid}-${tag}-b.wav`; A.writeWav(a, y, RATE);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', a, '-af', af, '-ar', String(RATE), '-ac', '1', b]); y = A.readWav(b).x; fs.unlinkSync(a); fs.unlinkSync(b); }
  let e = 0; let n = 0; for (let i = 0; i < y.length; i++) { if (Math.abs(y[i]) > 0.01) { e += y[i] ** 2; n++; } } const rms = Math.sqrt(e / Math.max(1, n));
  const g = Math.pow(10, gainDb / 20) / (rms || 1); const out = new Float32Array(y.length); for (let i = 0; i < y.length; i++) { const v = y[i] * g; out[i] = Math.tanh(v * 1.1) / Math.tanh(1.1); }
  { const LIM = Number(E('VOICE_PEAK', '0.85')); let pk = 0; for (let i = 0; i < out.length; i++) pk = Math.max(pk, Math.abs(out[i])); if (pk > LIM) for (let i = 0; i < out.length; i++) out[i] *= LIM / pk; } // peak ceiling (symmetric, no DC)
  const f = Math.min(out.length >> 1, Math.round(0.006 * RATE)); for (let i = 0; i < f; i++) { out[i] *= i / f; out[out.length - 1 - i] *= i / f; } // no seam clicks
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
    const ct = cleanTake(await tts(model, c.voice, ttsPrompt(model, c.style, turns.map(turnText), true))); if (ct.glitches.length) console.log('  removed TTS glitch burst(s): ' + JSON.stringify(ct.glitches)); const x = ct.x; const segs = await alignSplit(x, turns.map(turnText));
    const ok = segs && segs.every((sg, k) => { const spw = (sg.length / RATE) / Math.max(1, words(turnText(turns[k]))); return spw > 0.15 && spw < 1.2; });
    if (ok) return { units: segs.map((sg, k) => ({ ls: turns[k], x: sg })), method: 'one request per character, aligned + split per turn', calls: 1, glitches: ct.glitches };
    console.log('  batch take did not split into ' + turns.length + ' turns; falling back to one request per turn');
  }
  const units = []; const glitches = []; for (const t of turns) { const ct = cleanTake(await tts(model, c.voice, ttsPrompt(model, c.style, turnText(t), false))); if (ct.glitches.length) { console.log('  removed TTS glitch burst(s): ' + JSON.stringify(ct.glitches)); glitches.push(...ct.glitches); } units.push({ ls: t, x: split(ct.x, 1, [1])[0] }); }
  return { units, method: 'one request per turn', calls: turns.length, glitches };
}
// Word timing for the captions: local faster-whisper (pipeline/word-times.py, no API quota) gives word onsets in the final
// voice track; the script words are matched to them in order (edit-distance alignment, fuzzy word match), onsets are
// snapped to the first voiced 10 ms frame, and unmatched words are interpolated. Saved into the pkg as beats[i].wordAt
// (seconds into the voice), which the renderer uses instead of its loudness-based estimate.
const ntok = (w) => toks(w).join('');
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
const like = (a, b) => !!a && !!b && (a === b || 1 - lev(a, b) / Math.max(a.length, b.length) >= 0.6 || (a.length >= 4 && b.startsWith(a.slice(0, 4)) && Math.abs(a.length - b.length) <= 3));
function wordTimes(all) {
  const py = E('ASR_PYTHON', fs.existsSync('/home/box/.venvs/asr/bin/python') ? '/home/box/.venvs/asr/bin/python' : 'python3');
  const tmp = `/tmp/vc-${process.pid}-words.wav`; A.writeWav(tmp, all, RATE); let heard;
  try { heard = JSON.parse(execFileSync(py, [path.join(__dirname, 'word-times.py'), tmp, E('ASR_LOCAL_MODEL', 'base.en')], { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }).toString()); } catch (e) { console.log('  word timing unavailable: ' + String(e.message).split('\n')[0].slice(0, 200)); return null; } finally { fs.rmSync(tmp, { force: true }); }
  // whisper sometimes merges "three-second" etc.: split heard tokens on hyphens/spaces, sharing the time span
  const H = []; heard.forEach((h) => { const parts = String(h.w).split(/[\s-]+/).filter((q) => ntok(q)); parts.forEach((q, k) => H.push({ w: ntok(q), s: h.s + (h.e - h.s) * k / parts.length, e: h.s + (h.e - h.s) * (k + 1) / parts.length })); });
  const Sx = []; pkg.beats.forEach((b, bi) => String(b.text || '').trim().split(/\s+/).filter(Boolean).forEach((w, wi) => Sx.push({ bi, wi, raw: w, w: ntok(w) })));
  const n = Sx.length; const m = H.length; const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1)); const B = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i++) { D[i][0] = i; B[i][0] = 1; } for (let j = 1; j <= m; j++) { D[0][j] = j; B[0][j] = 2; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) { const sub = D[i - 1][j - 1] + (like(Sx[i - 1].w, H[j - 1].w) ? 0 : 1.2); const del = D[i - 1][j] + 1; const ins = D[i][j - 1] + 1; if (sub <= del && sub <= ins) { D[i][j] = sub; B[i][j] = 0; } else if (del <= ins) { D[i][j] = del; B[i][j] = 1; } else { D[i][j] = ins; B[i][j] = 2; } }
  for (let i = n, j = m; i > 0 || j > 0;) { const k = B[i][j]; if (i > 0 && j > 0 && k === 0) { Sx[i - 1].h = H[j - 1]; Sx[i - 1].ok = like(Sx[i - 1].w, H[j - 1].w); i--; j--; } else if (i > 0 && (k === 1 || j === 0)) i--; else j--; }
  // snap onsets to the first voiced frame inside the heard word span
  const hop = Math.round(0.01 * RATE); const fr = []; for (let s = 0; s + hop <= all.length; s += hop) { let e = 0; for (let i = 0; i < hop; i++) e += all[s + i] ** 2; fr.push(Math.sqrt(e / hop)); }
  const th = Math.max(0.006, A.median(fr.filter((v) => v > 0.006)) * 0.2);
  Sx.forEach((x) => { if (!x.h) return; let k = Math.floor(x.h.s / 0.01); const kEnd = Math.max(k + 1, Math.floor(x.h.e / 0.01)); while (k < kEnd && fr[k] <= th) k++; x.t = k < kEnd ? k * 0.01 : x.h.s; });
  // interpolate words without a heard match; keep onsets increasing
  for (let i = 0; i < n; i++) if (Sx[i].t == null) { let a = i - 1; while (a >= 0 && Sx[a].t == null) a--; let b = i + 1; while (b < n && Sx[b].t == null) b++; const ta = a >= 0 ? Sx[a].t : 0.05; const tb = b < n ? Sx[b].t : all.length / RATE - 0.3; Sx[i].t = ta + (tb - ta) * (i - a) / (b - a); Sx[i].interp = true; }
  for (let i = 1; i < n; i++) if (Sx[i].t < Sx[i - 1].t + 0.06) Sx[i].t = Sx[i - 1].t + 0.06;
  pkg.beats.forEach((b, bi) => { const ws = Sx.filter((x) => x.bi === bi); if (ws.length) b.wordAt = ws.map((x) => +x.t.toFixed(3)); else delete b.wordAt; });
  const missing = Sx.filter((x) => x.w && !x.ok).map((x) => x.raw); const extra = H.filter((h) => !Sx.some((x) => x.h === h)).map((h) => h.w);
  return { words: n, matched: n - missing.length, missing, extra, heard: heard.map((h) => h.w).join(' ') };
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
  // artifacts in the finished voice track (beeps, bursts, clicks, clipping): pipeline/audio-qa.js
  const aq = require('./audio-qa').scan(all, RATE); const glitchesRemoved = Object.fromEntries(Object.entries(casts).map(([w, c]) => [w, c.glitches || []]));
  // caption word timing
  let wt = null; if (process.env.WORD_TIMES !== '0') { wt = wordTimes(all); if (wt) { fs.writeFileSync(OUT + '.pkg.json', JSON.stringify(p0.pkg ? Object.assign(p0, { pkg }) : pkg, null, 1)); console.log(`  word timing: ${wt.matched}/${wt.words} script words heard in order` + (wt.missing.length ? ' | not heard: ' + wt.missing.join(' ') : '')); } }
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
  chk('no beeps, noise bursts, clicks or clipping in the voice track (audio-qa)', aq.ok, aq.fails.length ? aq.fails : { glitchBurstsRemovedFromTakes: glitchesRemoved });
  if (process.env.WORD_TIMES !== '0') chk('voice says the script word for word (local ASR, >= 92% of words heard in order); caption timing from heard word onsets', wt && wt.matched / wt.words >= 0.92, wt ? { matched: wt.matched + '/' + wt.words, notHeard: wt.missing, extraHeard: wt.extra } : 'local ASR unavailable (pipeline/word-times.py needs faster-whisper)');
  const flagged = Object.values(usedBy).some((m) => FLAGGED.includes(m)); if (flagged) chk('no flagged (flatter) TTS model used', false, usedBy);
  const pass = checks.every((c) => c.ok);
  const report = { model: usedBy, flaggedModel: flagged, cast: { skeptic: { voice: CAST.skeptic.voice, style: CAST.skeptic.style, tempo: CAST.skeptic.tempo }, claim: { voice: CAST.claim.voice, style: CAST.claim.style, tempo: CAST.claim.tempo } }, duration: +(total / RATE).toFixed(2), audioQa: aq, glitchesRemoved, wordTiming: wt, summary: { skeptic: S, claim: C }, checks, pass, lines: log };
  fs.writeFileSync(OUT + '.voice-log.json', JSON.stringify(report, null, 1));
  console.log('VOICE', used, 'dur', report.duration, 's | skeptic', JSON.stringify(S), '| claim', JSON.stringify(C));
  checks.forEach((c) => console.log((c.ok ? '  PASS ' : '  FAIL ') + c.name + ' ' + JSON.stringify(c.val)));
  if (!pass && process.env.ALLOW_FLAT !== '1') { console.log('VOICE_QA_FAIL (not shipping this take)'); process.exit(5); }
  console.log('VOICE_QA_PASS');
})().catch((e) => { console.error('FATAL', red(e.stack || e)); process.exit(1); });
