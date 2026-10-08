#!/usr/bin/env node
// Receipts Story mode, headless: storyline -> story board (Gemini, www/js/story.js) -> voiced cast (one locked, expressive Gemini
// TTS voice per character + optional narrator) -> frame-exact 1080x1920 24 fps render with the app's own canvas renderer
// (www/js/storydraw.js) and story mixer (www/js/storyaudio.js) -> H.264/AAC MP4 -> QA -> contact sheet.
//   node pipeline/story-render.js --story "She finds a note..." [--tone warm] [--beats 6|8|12] [--platform reel|tiktok|carousel|x]
//        [--narrator on|off] [--music storybook|chill|lofi|none] [--stills] --out /path/prefix
//        [--retake maya,leo|all]   fresh TTS takes for these characters (ids or names; 'narrator' too), everyone else from cache
//        [--voice leo=Enceladus]   re-cast a character (or narrator=...) in the saved plan before voicing
//        [--plan file.plan.json]   start from this saved plan (copied to <out>.plan.json) instead of asking Gemini
//        [--takes dir]             take cache (default <out>.takes)
//        [--offline]               no TTS requests at all: cached takes, stand-in voices for anything missing (preview only)
// Writes <out>.plan.json, <out>.md, <out>.lines/*.wav, <out>.voice-log.json, <out>.mp4, <out>.qa.json, <out>.contact.png,
// <out>.captions.png (one frame per voiced line) [, <out>.stills/].
// Resumable: an existing <out>.plan.json is reused (captions re-synced to the spoken text, poses re-mapped, no Gemini call); raw TTS
// takes are cached in <out>.takes/ (a quota stop never wastes requests; a retake keeps the replaced take in <takes>/replaced/).
// Exit 0 ok | 4 TTS quota exhausted on every allowed model -> render QUEUED (story-queue/<name>.json), nothing silent is shipped |
//      5 voice QA failed (voices too similar / flat / bursts) | 6 final QA failed | 1 other error.
// env: GEMINI_API_KEY (required, never printed), TTS_MODELS / TTS_FLAGGED_MODELS / TTS_MAX_WAIT (pipeline/voice.env), ASR_PY.
'use strict';
const fs = require('fs'); const path = require('path'); const http = require('http'); const crypto = require('crypto'); const { execFileSync, spawn } = require('child_process');
const L = require('./story-lib'); const S = L.story; const A = require('../www/js/storyaudio.js'); const QA = require('./audio-qa'); const AF = require('./audio-features');
const args = process.argv.slice(2); const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; }; const flag = (k) => args.includes('--' + k);
const OUT = arg('out'); if (!OUT) { console.error('usage: story-render.js --story "..." --out <prefix> [--tone t] [--beats 8] [--platform reel] [--stills] [--retake maya,leo] [--voice leo=Enceladus] [--plan f] [--takes dir] [--offline]'); process.exit(2); }
const OFFLINE = flag('offline') || process.env.TTS_OFFLINE === '1';
const KEY = process.env.GEMINI_API_KEY; if (!KEY && !OFFLINE) { console.error('NO GEMINI_API_KEY (or run with --offline for a cached-take / stand-in preview)'); process.exit(2); }
const TAKES = arg('takes', OUT + '.takes'); const MUSIC = arg('music', 'storybook');
const RETAKE_ARG = String(arg('retake', '')).toLowerCase().split(',').map((x) => x.trim()).filter(Boolean); let RETAKE = new Set(); const retaken = new Set(); let standIns = 0;
const E = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
(() => { try { const env = fs.readFileSync(path.join(__dirname, 'voice.env'), 'utf8'); for (const ln of env.split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(ln.trim()); if (m && process.env[m[1]] === undefined && /^TTS_/.test(m[1])) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); } } catch (_) { /* defaults below */ } })();
const MODELS = E('TTS_MODELS', A.ALLOWED_MODELS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const FLAGGED = E('TTS_FLAGGED_MODELS', A.FLAGGED_MODELS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const ALLOWED = MODELS.filter((m) => !FLAGGED.includes(m)); // flattening models are refused for Story, no override
const MAX_WAIT = Number(E('TTS_MAX_WAIT', '900')); const RATE = A.RATE; const FPS = 24;
const QUEUE_DIR = E('STORY_QUEUE', '/workspace/receipts-pipeline/story-queue');
const red = (s) => (KEY ? String(s).split(KEY).join('REDACTED') : String(s)); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a.map(red)); const jw = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2));
fs.mkdirSync(path.dirname(OUT), { recursive: true });

// ---------- Gemini TTS (direct, cached takes, honest quota handling) ----------
const structured = (m) => { const v = /gemini-(\d+(?:\.\d+)?)/.exec(m); return v && parseFloat(v[1]) >= 3.5; };
async function ttsLive(model, voice, parts) {
  const body = { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } };
  for (let a = 1; ; a++) {
    let r; try { r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000) }); } catch (e) { if (a <= 2) { log(`  ${model} request failed (${red(e.message).slice(0, 80)}), retry ${a}`); continue; } throw Object.assign(new Error(model + ' network: ' + red(e.message)), { soft: true }); }
    const j = await r.json().catch(() => ({}));
    if (r.ok) { const d = (((j.candidates || [])[0] || {}).content || {}).parts; const au = d && d.map((x) => x.inlineData).find(Boolean); if (!au) throw Object.assign(new Error(model + ' returned no audio'), { soft: true });
      const buf = Buffer.from(au.data, 'base64'); const x = new Float32Array(buf.length >> 1); for (let i = 0; i < x.length; i++) x[i] = buf.readInt16LE(i * 2) / 32768; return x; }
    const msg = red(JSON.stringify(j.error || j)); const det = ((j.error || {}).details || []);
    const rd = det.map((d) => d.retryDelay).find(Boolean); const w = /retry in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s/.exec(msg);
    const secs = rd ? parseFloat(rd) : w ? Number(w[1] || 0) * 3600 + Number(w[2] || 0) * 60 + Number(w[3]) : 30;
    const daily = det.some((d) => (d.violations || []).some((v) => /PerDay/i.test(v.quotaId || ''))) && !det.some((d) => (d.violations || []).some((v) => /PerMinute/i.test(v.quotaId || '')));
    if (r.status === 429 && secs <= MAX_WAIT && a <= 5 && !daily) { log(`  ${model} 429, waiting ${Math.ceil(secs)} s for the quota window`); await sleep((secs + 2) * 1000); continue; }
    if ((r.status === 500 || r.status === 503) && a <= 3) { log(`  ${model} ${r.status}, retry ${a}`); await sleep(a * 15000); continue; }
    if (r.status === 400 && parts.some((p) => p.speech_metadata) && /speech_metadata|unknown name|invalid json/i.test(msg)) { parts = parts.map((p) => ({ text: (p.speech_metadata ? p.speech_metadata.style + ': ' : '') + p.text })); body.contents[0].parts = parts; continue; }
    throw Object.assign(new Error(`${model} HTTP ${r.status} ${msg.slice(0, 240)}`), { status: r.status, quota: r.status === 429, retryIn: secs });
  }
}
let requests = 0;
async function tts(model, voice, parts, o) {
  o = o || {};
  const h = crypto.createHash('sha1').update(model + '|' + voice + '|' + JSON.stringify(parts)).digest('hex').slice(0, 16); const f = TAKES + '/' + h + '.pcm';
  if (fs.existsSync(f) && !(o.fresh && !OFFLINE)) { const b = fs.readFileSync(f); const x = new Float32Array(b.length >> 1); for (let i = 0; i < x.length; i++) x[i] = b.readInt16LE(i * 2) / 32768; log('  cached take ' + h); return x; }
  if (OFFLINE) { if (o.lines) { standIns++; log(`  stand-in voice for ${voice} (offline, no cached take ${h})`); return standIn(o.lines, voice); } throw Object.assign(new Error('offline (cached takes only)'), { quota: true }); }
  requests++; const x = await ttsLive(model, voice, parts); const b = Buffer.alloc(x.length * 2); for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), i * 2);
  fs.mkdirSync(TAKES, { recursive: true });
  if (fs.existsSync(f)) { const old = path.join(TAKES, 'replaced'); fs.mkdirSync(old, { recursive: true }); fs.renameSync(f, path.join(old, h + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.pcm')); log('  fresh take ' + h + ' (previous take kept in ' + old + ')'); }
  fs.writeFileSync(f, b); return x;
}
// Offline stand-in voice (no API): one pitched, formant-coloured syllable per vowel group with a rising/falling contour so the
// mixer, timing, captions and QA can all run. Pitch follows the cast voice's band, so characters stay distinct. Preview only.
function standIn(lines, voice) {
  const v = S.VOICES[voice] || ['f', 'mid']; const f0 = { f: { high: 290, mid: 235, low: 195 }, m: { high: 165, mid: 135, low: 108 } }[v[0]][v[1]] || 200;
  const parts = []; const gap = (sec) => parts.push(new Float32Array(Math.round(sec * RATE)));
  lines.forEach((text, li) => { if (li) gap(1.0); String(text).split(/\s+/).filter(Boolean).forEach((w, wi) => { if (wi) gap(0.07); const syl = Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) || []).length);
    for (let k = 0; k < syl; k++) { const n = Math.round(0.17 * RATE); const x = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const u = i / n; const f = f0 * Math.pow(2, (3 * Math.sin(Math.PI * (u + wi * 0.37 + k * 0.5))) / 12); ph += 2 * Math.PI * f / RATE; const env = Math.sin(Math.PI * u) ** 0.6; x[i] = 0.28 * env * (Math.sin(ph) + 0.55 * Math.sin(2 * ph) + 0.3 * Math.sin(3 * ph) + 0.12 * Math.sin(5 * ph)); } parts.push(x); gap(0.03); } }); });
  const all = new Float32Array(parts.reduce((n, q) => n + q.length, 0)); let o2 = 0; parts.forEach((q) => { all.set(q, o2); o2 += q.length; }); all.standIn = true; return all;
}
const exhausted = new Set();
async function ttsAny(voice, mk, o) { // tries the allowed models in order; throws {quota:true} only when every allowed model is out
  let last = null;
  if (OFFLINE) { // cached take from any allowed model first (a take may have been made on the fallback model), then a stand-in
    for (const m of ALLOWED) { try { return { x: await tts(m, voice, mk(m), Object.assign({}, o, { lines: null })), model: m }; } catch (e) { if (!e.quota) throw e; } }
    return { x: await tts(ALLOWED[0], voice, mk(ALLOWED[0]), o), model: ALLOWED[0] + ' (stand-in)' };
  }
  for (const m of ALLOWED) { if (exhausted.has(m)) continue; try { return { x: await tts(m, voice, mk(m), o), model: m }; } catch (e) { last = e; if (e.quota) { exhausted.add(m); log(`  ${m}: quota exhausted (${red(e.message).slice(0, 120)})`); continue; } if (e.soft || e.status >= 500) continue; throw e; } }
  throw Object.assign(new Error('TTS quota exhausted on every allowed model: ' + ALLOWED.join(', ') + (last ? ' (' + red(last.message).slice(0, 160) + ')' : '')), { quota: true });
}
// ---------- local ASR (faster-whisper; no API quota) to verify each split line says the right words ----------
const ASR_PY = E('ASR_PY', '/home/box/.venvs/asr/bin/python');
const toks = (t) => String(t).toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);
function heardPerSegment(segs) {
  if (!fs.existsSync(ASR_PY)) return null; const gap = new Float32Array(Math.round(0.9 * RATE)); const parts = []; const spans = []; let t = 0;
  segs.forEach((s) => { spans.push([t, t + s.length / RATE]); parts.push(s, gap); t += (s.length + gap.length) / RATE; });
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; parts.forEach((p) => { all.set(p, o); o += p.length; });
  const tmp = `/tmp/story-asr-${process.pid}.wav`; AF.writeWav(tmp, all, RATE);
  try { const w = JSON.parse(execFileSync(ASR_PY, [path.join(__dirname, 'word-times.py'), tmp, E('ASR_LOCAL_MODEL', 'base.en')], { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }).toString()); fs.unlinkSync(tmp); return spans.map(([a, b]) => w.filter((q) => (q.s + q.e) / 2 >= a - 0.05 && (q.s + q.e) / 2 < b + 0.3).map((q) => q.w).join(' ')); } catch (e) { log('  local ASR unavailable: ' + String(e.message).slice(0, 100)); return null; }
}
const sim = (heard, want) => { const h = toks(heard); const w = toks(want); if (!w.length) return 1; let i = 0; let hit = 0; for (const t of w) { const k = h.indexOf(t, i); if (k >= 0) { hit++; i = k + 1; } } return hit / w.length; };

// ---------- 1) plan ----------
// a saved plan brought up to date (captions = spoken text, poses mapped) + --voice re-casts; written back when anything changed
function applyVoices(p) {
  const out = []; String(arg('voice', '')).split(',').map((x) => x.trim()).filter(Boolean).forEach((pair) => {
    const [w, v0] = pair.split('='); const v = Object.keys(S.VOICES).find((n) => n.toLowerCase() === String(v0 || '').trim().toLowerCase()); const who = String(w || '').trim().toLowerCase();
    if (!v) { console.error(`--voice ${pair}: unknown voice (one of ${Object.keys(S.VOICES).join(', ')})`); process.exit(2); }
    if (who === 'narrator') { if (p.narrator.voice !== v) { out.push(`narrator ${p.narrator.voice} -> ${v}`); p.narrator.voice = v; p.narrator.why = 'cast by you'; } return; }
    const c = (p.characters || []).find((q) => q.id === who || q.name.toLowerCase() === who); if (!c) { console.error(`--voice ${pair}: no character "${w}" (have ${(p.characters || []).map((q) => q.id).join(', ')})`); process.exit(2); }
    if (c.voice !== v) { out.push(`${c.id} ${c.voice} -> ${v}`); c.voice = v; c.voiceWhy = 'cast by you'; }
  });
  return out;
}
async function plan() {
  const saved = fs.existsSync(OUT + '.plan.json') ? OUT + '.plan.json' : arg('plan') && fs.existsSync(arg('plan')) ? arg('plan') : null;
  if (saved) {
    log('PLAN reuse ' + saved); const p = JSON.parse(fs.readFileSync(saved, 'utf8'));
    const fx = S.refresh(p); fx.forEach((f) => log('  ' + f)); const vc = applyVoices(p); vc.forEach((f) => log('  voice ' + f));
    if (fx.length || vc.length || saved !== OUT + '.plan.json') { jw(OUT + '.plan.json', p); fs.writeFileSync(OUT + '.md', S.toMarkdown(p)); }
    return p;
  }
  const input = { storyline: arg('story', ''), tone: arg('tone', ''), beats: Number(arg('beats', '8')), platform: arg('platform', 'reel'), narrator: arg('narrator', 'on') !== 'off', part1: flag('part1') };
  if (!input.storyline) throw new Error('--story is required (or an existing <out>.plan.json)');
  log('PLAN ' + JSON.stringify(input));
  const r = await L.planStory(input, (s) => log('  ' + s)); const p = r.plan;
  if (!input.narrator && p.narrator) p.narrator.use = false;
  log(`  attempts ${r.report.attempts.length}, fixed ${r.report.fixed.length}, warnings ${r.report.warnings.length}, forced ${r.report.forcedFrom.length}`);
  applyVoices(p); jw(OUT + '.plan.json', p); fs.writeFileSync(OUT + '.md', S.toMarkdown(p)); return p;
}
// ---------- 2) cast ----------
async function castOne(p, who, ls, models, glitches, verify) {
  const voice = ls[0].voice; let segs = null; let model = ''; const fresh = RETAKE.has(who) && !OFFLINE; let stood = false;
  if (fresh) log(`  ${who}: fresh take requested (--retake)`);
  const target = ALLOWED.find((m) => !exhausted.has(m)) || ALLOWED[0];
  // one request per character when the model takes a style per line (3.5+); older models get one request per line when deliveries differ
  if (ls.length > 1 && (structured(target) || new Set(ls.map((l) => l.delivery)).size === 1)) {
    const r = await ttsAny(voice, (m) => (structured(m) ? ls.map((l) => ({ text: l.text, speech_metadata: { style: S.styleFor(p, who, l.delivery) } })) : [{ text: S.styleFor(p, who, ls[0].delivery) + '. Read each paragraph separately, with a clear one-second pause between paragraphs:\n\n' + ls.map((l) => l.text).join('\n\n') }]), { fresh, lines: ls.map((l) => l.text) });
    model = r.model; stood = stood || !!r.x.standIn; const ct = A.cleanTake(r.x, RATE); glitches.push(...ct.glitches.map((g) => Object.assign({ who }, g)));
    segs = A.splitTake(ct.x, ls.length, ls.map((l) => toks(l.text).length), RATE);
    if (segs && !stood) { const heard = heardPerSegment(segs); if (heard) { const sc = heard.map((h, k) => sim(h, ls[k].text)); verify.push({ who, take: 'batch', scores: sc.map((v) => +v.toFixed(2)), heard }); if (sc.some((v) => v < 0.6)) { log(`  ${who}: batch split does not match the lines (${sc.map((v) => v.toFixed(2)).join(', ')}), one request per line`); segs = null; } } }
    else if (!segs) log(`  ${who}: could not split the batch take at pauses, one request per line`);
  }
  if (!segs) {
    segs = [];
    for (const l of ls) { const st = S.styleFor(p, who, l.delivery); const r = await ttsAny(voice, (m) => (structured(m) ? [{ text: l.text, speech_metadata: { style: st } }] : [{ text: st + ': ' + l.text }]), { fresh, lines: [l.text] }); model = r.model; stood = stood || !!r.x.standIn; const ct = A.cleanTake(r.x, RATE); glitches.push(...ct.glitches.map((g) => Object.assign({ who }, g))); segs.push(A.splitTake(ct.x, 1, [1], RATE)[0]); }
    const heard = stood ? null : heardPerSegment(segs); if (heard) verify.push({ who, take: 'per-line', scores: heard.map((h, k) => +sim(h, ls[k].text).toFixed(2)), heard });
  }
  models.add(model); if (fresh) retaken.add(who);
  // level, then sibilance control (an over-bright "s" tripped audio-qa's harsh-noise check in story-sample-1)
  return ls.map((l, k) => { const n = A.normalize(segs[k], who === 'narrator' ? -20 : l.delivery === 'whisper' ? -19 : -17, 0.85); const d = A.deEss(n, RATE); return Object.assign({}, l, { x: d.x, deEssed: d.hits, dur: d.x.length / RATE, model, standIn: stood }); });
}
function queueAndExit(p, e) {
  fs.mkdirSync(QUEUE_DIR, { recursive: true }); const name = path.basename(OUT); const qf = path.join(QUEUE_DIR, name + '.json');
  const left = [...RETAKE].filter((w) => !retaken.has(w));
  const cmd = `cd ${path.join(__dirname, '..')} && node pipeline/story-render.js --out ${OUT}${flag('stills') ? ' --stills' : ''}${MUSIC !== 'storybook' ? ' --music ' + MUSIC : ''}${left.length ? ' --retake ' + left.join(',') : ''}${arg('takes') ? ' --takes ' + TAKES : ''}`;
  jw(qf, { queuedAt: new Date().toISOString(), out: OUT, storyline: p.input && p.input.storyline, reason: red(e.message), models: ALLOWED, resets: 'Gemini TTS free tier: 10 requests/day per model, resets 05:30 IST', rerun: cmd, takesCached: fs.existsSync(TAKES) ? fs.readdirSync(TAKES).filter((f) => f.endsWith('.pcm')).length : 0, retakenSoFar: [...retaken] });
  log('TTS_QUOTA ' + red(e.message)); log('QUEUED ' + qf + ' (no silent or flat version is rendered). Re-run: ' + cmd); process.exit(4);
}
async function cast(p) {
  const all = S.voiceLines(p); const groups = new Map(); all.forEach((l) => { if (!groups.has(l.who)) groups.set(l.who, []); groups.get(l.who).push(l); });
  log('CAST ' + [...groups].map(([w, ls]) => `${w}=${ls[0].voice} (${ls.length} line${ls.length > 1 ? 's' : ''})`).join(', ') + ' | models ' + ALLOWED.join(' > ') + ' | refused ' + FLAGGED.join(', '));
  let lines = []; const models = new Set(); const glitches = []; const verify = [];
  try { for (const [who, ls] of groups) lines.push(...await castOne(p, who, ls, models, glitches, verify)); } catch (e) { if (e.quota) queueAndExit(p, e); throw e; }
  let qa = A.castQa(lines, [...models], { strict: true });
  if (!qa.checks[0].ok) { // one automatic re-cast: the quieter-role character in the closest pair gets a contrasting voice
    const worst = qa.pairs.filter((q) => !q.ok).sort((a, b) => a.pitchGapSt - b.pitchGapSt)[0]; const used = new Set([...(p.characters || []).map((c) => c.voice), p.narrator && p.narrator.voice]);
    const who = [worst.a, worst.b].sort((a, b) => lines.filter((l) => l.who === a).length - lines.filter((l) => l.who === b).length)[0]; const other = qa.who[who === worst.a ? worst.b : worst.a];
    const c = (p.characters || []).find((q) => q.id === who); const gender = c ? (S.VOICES[c.voice] || [])[0] : null;
    const cand = Object.entries(S.VOICES).filter(([v, d]) => !used.has(v) && (!gender || d[0] === gender) && (other.f0 > 160 ? d[1] === 'low' : d[1] === 'high'));
    if (cand.length) { const nv = cand[0][0]; log(`  voices ${worst.a}/${worst.b} too close (${worst.pitchGapSt} st, ${worst.timbreGapPct}%): re-casting ${who} as ${nv}`); if (who === 'narrator') p.narrator.voice = nv; else c.voice = nv; c && (c.voiceWhy = (c.voiceWhy || '') + ' (re-cast for contrast)');
      try { const ls = S.voiceLines(p).filter((l) => l.who === who); lines = lines.filter((l) => l.who !== who).concat(await castOne(p, who, ls, models, glitches, verify)); } catch (e) { if (e.quota) queueAndExit(p, e); throw e; }
      jw(OUT + '.plan.json', p); fs.writeFileSync(OUT + '.md', S.toMarkdown(p)); qa = A.castQa(lines, [...models], { strict: true }); }
  }
  fs.mkdirSync(OUT + '.lines', { recursive: true }); lines.forEach((l, k) => AF.writeWav(`${OUT}.lines/${String(k + 1).padStart(2, '0')}-p${l.panel + 1}-${l.who}.wav`, l.x, RATE));
  const log2 = { pass: qa.pass, offline: OFFLINE, standIns, retake: [...RETAKE], retaken: [...retaken], models: [...models], refused: FLAGGED, requests, glitchesRemoved: glitches, asr: verify, who: qa.who, pairs: qa.pairs, checks: qa.checks.map((c) => ({ name: c.name, ok: c.ok, val: c.val })), lines: lines.map((l) => ({ panel: l.panel + 1, who: l.who, voice: l.voice, delivery: l.delivery, text: l.text, dur: +l.dur.toFixed(2), model: l.model, standIn: !!l.standIn, deEssedWindows: l.deEssed || 0, style: S.styleFor(p, l.who, l.delivery) })) };
  jw(OUT + '.voice-log.json', log2);
  qa.checks.forEach((c) => log(`  ${c.ok ? 'PASS' : 'FAIL'} ${c.name}`)); Object.entries(qa.who).forEach(([w, v]) => log(`    ${w}: ${v.voice} f0 ${v.f0} Hz, centroid ${v.centroid} Hz, pitch var ${v.f0StdSt} st`));
  if (!qa.pass && OFFLINE) log('  (offline preview: voice QA result recorded, not blocking)');
  else if (!qa.pass && process.env.ALLOW_FLAT !== '1') { log('VOICE_QA FAIL (not rendering a flat / same-voice version; see ' + OUT + '.voice-log.json)'); process.exit(5); }
  return lines;
}
// ---------- 3) render (headless Chrome, the app's own renderer + mixer, frame-exact) ----------
async function render(p, lines) {
  const puppeteer = require('puppeteer-core'); const WWW = path.join(__dirname, '..', 'www');
  const { tm, lines: placed } = A.placeLines(p, lines, S);
  const srv = http.createServer((req, res) => { let q = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (q === '/') q = '/index.html'; const f = path.join(WWW, q); if (!f.startsWith(WWW) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } const ty = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(f)] || 'application/octet-stream'; res.writeHead(200, { 'content-type': ty }); fs.createReadStream(f).pipe(res); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto('http://127.0.0.1:' + srv.address().port + '/'); await page.waitForFunction(() => window.VTS && window.VTS.storyDraw && window.VTS.storyAudio && window.VTS.audiofx);
    const enc = (x) => { const b = Buffer.alloc(x.length * 2); for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), i * 2); return b.toString('base64'); };
    const info = await page.evaluate(async (plan, tm, pl, music) => {
      try { await document.fonts.load('900 100px Montserrat'); await document.fonts.load('700 40px Montserrat'); } catch (_) { /* */ }
      const dec = (b) => { const s = atob(b); const x = new Float32Array(s.length >> 1); for (let i = 0; i < x.length; i++) { let v = s.charCodeAt(2 * i) | (s.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; x[i] = v / 32768; } return x; };
      const lines = pl.map((l) => Object.assign({}, l, { x: dec(l.b64), b64: undefined }));
      const c = document.createElement('canvas'); c.width = 1080; c.height = 1920; const r = new window.VTS.storyDraw.StoryRenderer(c).setup(plan, { timing: tm, lines });
      window.__r = r; window.__c = c; window.__ov = []; window.__cap = []; window.__pose = []; window.__stat = { capFrames: 0, poses: {}, held: {} };
      window.__lines = lines.map((l) => ({ panel: l.panel, who: l.who, start: l.start, dur: l.dur, text: l.text }));
      const m = await window.VTS.storyAudio.mix(plan, lines, tm, { music, stems: true }); const wav = window.VTS.storyAudio.wavBytes(m);
      const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
      // stems for QA at 24 kHz mono: voice + effects (scanned strictly) and the music bed (checked against its own notes)
      const half = (x, y) => { const n = x.length >> 1; const u = new Uint8Array(n * 2); const dv = new DataView(u.buffer); for (let i = 0; i < n; i++) { const v = 0.5 * (x[2 * i] + x[2 * i + 1] + (y ? y[2 * i] + y[2 * i + 1] : 0)); dv.setInt16(2 * i, Math.round(Math.max(-1, Math.min(1, v)) * 32767), true); } return b64(u); };
      return { wav: b64(wav), cues: m.cues, silence: m.silence, total: tm.total, stemVoiceFx: half(m.stems.voice, m.stems.sfx), stemMusic: m.stems.music ? half(m.stems.music) : null, bedPcs: music !== 'none' ? window.VTS.audiofx.musicPitches(music) : [] };
    }, p, tm, placed.map((l) => Object.assign({}, l, { x: undefined, b64: enc(l.x) })), MUSIC);
    fs.writeFileSync(OUT + '.mix.wav', Buffer.from(info.wav, 'base64'));
    const dec16 = (b) => { const buf = Buffer.from(b, 'base64'); const x = new Float32Array(buf.length >> 1); for (let i = 0; i < x.length; i++) x[i] = buf.readInt16LE(i * 2) / 32768; return x; };
    const stems = { voiceFx: dec16(info.stemVoiceFx), music: info.stemMusic ? dec16(info.stemMusic) : null, bedPcs: info.bedPcs };
    const NF = Math.ceil(info.total * FPS); log(`RENDER ${NF} frames @ ${FPS} fps (${info.total.toFixed(2)} s), cues ${info.cues.map((c) => c.id + '@' + c.t).join(' ')}, silence ${JSON.stringify(info.silence)}`);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-i', OUT + '.mix.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p', '-color_range', 'tv', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', info.total.toFixed(3), '-movflags', '+faststart', OUT + '.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((res, rej) => ff.on('close', (code) => (code === 0 ? res() : rej(new Error('ffmpeg exit ' + code)))));
    const overlaps = []; const B = 24;
    for (let f0 = 0; f0 < NF; f0 += B) {
      const batch = await page.evaluate((f0, n, NF, FPS) => { const D = window.VTS.storyDraw; const st = window.__stat; const out = []; for (let f = f0; f < Math.min(NF, f0 + n); f++) { const L2 = window.__r.draw(f / FPS); const ov = D.overlaps(L2); if (ov.length) window.__ov.push({ f, ov });
          const cc = D.captionCheck(L2, window.__lines); if (cc.length && window.__cap.length < 200) window.__cap.push(...cc); if (window.__lines.some((l) => L2.t >= l.start + 0.05 && L2.t <= l.start + l.dur - 0.05)) st.capFrames++;
          const pc = D.poseCheck(L2); if (pc.length && window.__pose.length < 200) window.__pose.push(...pc); (L2.figures || []).forEach((g) => { st.poses[g.id + ':' + g.arms] = (st.poses[g.id + ':' + g.arms] || 0) + 1; if (g.held) st.held[g.id + ':' + g.held.kind] = (st.held[g.id + ':' + g.held.kind] || 0) + 1; }); out.push(window.__c.toDataURL('image/jpeg', 0.93).split(',')[1]); } return out; }, f0, B, NF, FPS);
      for (const b of batch) { if (!ff.stdin.write(Buffer.from(b, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r)); }
      if (f0 % (B * 5) === 0) process.stdout.write(`  frame ${f0}/${NF}\r`);
    }
    ff.stdin.end(); await done; overlaps.push(...await page.evaluate(() => window.__ov)); const chk = await page.evaluate(() => ({ cap: window.__cap, pose: window.__pose, stat: window.__stat }));
    let stills = [];
    if (flag('stills')) { fs.mkdirSync(OUT + '.stills', { recursive: true }); stills = await page.evaluate((n) => { const o = []; for (let i = 0; i < n; i++) { window.__r.drawPanel(i); o.push(window.__c.toDataURL('image/png').split(',')[1]); } return o; }, p.panels.length); stills.forEach((b, i) => fs.writeFileSync(`${OUT}.stills/panel-${String(i + 1).padStart(2, '0')}.png`, Buffer.from(b, 'base64'))); }
    log(`  rendered ${OUT}.mp4${stills.length ? ', ' + stills.length + ' stills' : ''}${errs.length ? ' | page errors: ' + errs.slice(0, 3).join(' / ') : ''}`);
    return { tm, placed, cues: info.cues, silence: info.silence, overlaps, errs, capIssues: chk.cap, poseIssues: chk.pose, stat: chk.stat, stems };
  } finally { await browser.close(); srv.close(); }
}
// ---------- 4) QA on the final MP4 ----------
function finalQa(p, r, voiceLog) {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,pix_fmt,codec_type:format=duration', '-of', 'json', OUT + '.mp4']).toString());
  const v = probe.streams.find((s) => s.codec_type === 'video'); const au = probe.streams.find((s) => s.codec_type === 'audio'); const dur = Number(probe.format.duration);
  const x = QA.decode(OUT + '.mp4'); const allow = r.cues.map((c) => [c.t, c.t + 1.2]);
  // audio-qa per stem: the voice + effects stem is scanned strictly (bursts, beeps, clicks, harsh, clipping; tones only inside
  // effect windows); the music bed is tested against its own reference (a sustained tone must be one of the bed's notes; any
  // burst / click / hiss / clipping fails); in the final mix a sustained tone passes only inside an effect window or when the
  // same note is in the music stem at that moment. A beep from a voice take or an effect therefore still fails.
  const vfx = QA.scan(r.stems.voiceFx, QA.RATE, { allow });
  const MA = QA.musicAware(r.stems.bedPcs || [], QA.RATE);
  const mscan = r.stems.music ? QA.scan(r.stems.music, QA.RATE, {}) : { ok: true, events: [], fails: [] };
  const mres = MA.musicStem(mscan); const mtones = mres.tones; const mfails = mres.offBed;
  const scan = MA.finalMix(QA.scan(x, QA.RATE, { allow }), mtones);
  const musicOn = MUSIC !== 'none' && r.stems.music ? (() => { const m = r.stems.music; const db = (a, b) => { const i0 = Math.floor(a * QA.RATE); const i1 = Math.min(m.length, Math.floor(b * QA.RATE)); let e = 0; for (let i = i0; i < i1; i++) e += m[i] * m[i]; return 20 * Math.log10(Math.sqrt(e / Math.max(1, i1 - i0)) + 1e-9); }; const outSil = r.tm.shots.filter((q) => !q.silence).map((q) => db(q.start + 0.1, q.start + q.dur - 0.1)); return { styleBed: MUSIC, perShotDb: outSil.map((v) => +v.toFixed(1)), silenceBeatDb: r.silence.map(([a, b]) => +db(a + 0.06, b - 0.06).toFixed(1)) }; })() : null;
  const rmsDb = (a, b) => { const i0 = Math.floor(a * QA.RATE); const i1 = Math.floor(b * QA.RATE); let e = 0; for (let i = i0; i < i1; i++) e += x[i] * x[i]; return 20 * Math.log10(Math.sqrt(e / Math.max(1, i1 - i0)) + 1e-9); };
  const sil = r.silence.map(([a, b]) => ({ from: +a.toFixed(2), to: +b.toFixed(2), rmsDb: +rmsDb(a + 0.06, b - 0.06).toFixed(1) }));
  // every character still sounds different in the final mix (measured on the MP4 at each line's position)
  const seg = (l) => x.subarray(Math.floor((l.start + 0.02) * QA.RATE), Math.floor((l.start + l.dur - 0.02) * QA.RATE));
  const mp4Lines = r.placed.map((l) => Object.assign({}, l, { x: Float32Array.from(seg(l)) })); const mq = A.castQa(mp4Lines, voiceLog.models, { strict: true });
  const music = (() => { const iv = r.placed.map((l) => [l.start, l.start + l.dur]); const gaps = []; r.tm.shots.forEach((s) => { if (s.silence) return; const a = s.start + 0.1; const b = s.start + s.dur - 0.1; if (!iv.some(([p0, p1]) => p0 < b && p1 > a)) gaps.push(rmsDb(a, b)); }); const vo = r.placed.map((l) => rmsDb(l.start + 0.05, l.start + l.dur - 0.05)); return { voiceDb: +(AF.mean(vo)).toFixed(1), musicOnlyDb: gaps.length ? +(AF.mean(gaps)).toFixed(1) : null }; })();
  const checks = [
    ['1080x1920 H.264 yuv420p, 24 fps, AAC audio', v && v.codec_name === 'h264' && v.width === 1080 && v.height === 1920 && v.pix_fmt === 'yuv420p' && v.r_frame_rate === '24/1' && au && au.codec_name === 'aac', { v: v && [v.codec_name, v.width, v.height, v.pix_fmt, v.r_frame_rate], a: au && au.codec_name }],
    ['total 24-32 s (incl. 1.5 s end card)', dur >= 24 && dur <= 32.2, +dur.toFixed(2)],
    ['true hard silence on the silence beat (no voice, no music; < -55 dBFS)', sil.length > 0 && sil.every((s) => s.rmsDb < -55), sil],
    ['voice + effects stem: no bursts / beeps / clicks / harsh noise / clipping (audio-qa; tones only in effect windows)', vfx.ok, vfx.fails.slice(0, 6)],
    ['music bed stem vs its own reference: sustained tones are the bed\'s notes, no bursts / clicks / hiss / clipping', !mfails.length, { tones: mtones.length, offBed: mfails.slice(0, 6) }],
    ['final mix: no bursts / beeps / clicks / harsh noise / clipping (tones only in effect windows or matching the music stem)', scan.ok, scan.fails.slice(0, 6)],
    ...(musicOn ? [['music plays under the story (every non-silent shot > -56 dBFS in the music stem, ducked under voices) and drops out on the silence beat (< -80 dBFS)', musicOn.perShotDb.every((v) => v > -56) && musicOn.silenceBeatDb.every((v) => v < -80), musicOn]] : []),
    ['captions = spoken text: while each line is voiced, the burned-in text is exactly that line, nothing else (every frame; plan captions in sync)', !r.capIssues.length && !S.captionMismatches(p).length && r.stat.capFrames > 0, { frameIssues: r.capIssues.slice(0, 5), planMismatches: S.captionMismatches(p), framesChecked: r.stat.capFrames }],
    ['poses: no T-pose, every held prop on its hand anchor (every frame)', !r.poseIssues.length, { issues: r.poseIssues.slice(0, 5), poses: r.stat.poses, held: r.stat.held }],
    ['each character keeps a distinct voice in the final mix (pitch >= 3 st or timbre >= 18%)', mq.checks[0].ok, { who: mq.who, pairs: mq.pairs }],
    ['voice QA passed before render (distinct, expressive, allowed models, no bursts)', !!voiceLog.pass, voiceLog.models],
    ['captions/dialogue never over faces, hook inside the safe area (all frames)', r.overlaps.length === 0, r.overlaps.slice(0, 5)],
    ['music sits under the voice (voice louder than music-only stretches by >= 8 dB)', music.musicOnlyDb == null || music.voiceDb - music.musicOnlyDb >= 8, music],
    ['renderer ran without page errors', !r.errs.length, r.errs.slice(0, 3)],
  ].map(([name, ok, val]) => ({ name, ok: !!ok, val }));
  const out = { pass: checks.every((c) => c.ok), preview: OFFLINE || undefined, checks, duration: +dur.toFixed(2), sfx: r.cues, silence: sil, events: scan.events, voiceFxEvents: vfx.events, musicEvents: mscan.events };
  jw(OUT + '.qa.json', out); checks.forEach((c) => log(`  ${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.ok ? '' : '  ' + JSON.stringify(c.val).slice(0, 300)}`));
  return out;
}
// ---------- 5) contact sheet (one frame per panel + the end card, from the MP4) ----------
function contactSheet(r) {
  const times = r.tm.shots.map((s) => s.start + Math.min(s.dur - 0.05, Math.max(0.6, s.dur * 0.72))).concat([r.tm.endCard.start + 0.9]);
  const dir = OUT + '.sheet'; fs.mkdirSync(dir, { recursive: true });
  times.forEach((t, i) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', OUT + '.mp4', '-frames:v', '1', '-vf', 'scale=360:640', `${dir}/f${String(i).padStart(2, '0')}.png`]));
  const cols = Math.min(5, times.length); const rows = Math.ceil(times.length / cols);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', `${dir}/f%02d.png`, '-vf', `tile=${cols}x${rows}:padding=6:margin=6:color=white`, '-frames:v', '1', OUT + '.contact.png']);
  fs.rmSync(dir, { recursive: true, force: true }); return OUT + '.contact.png';
}
// one frame from the middle of every voiced line: the burned-in text must read exactly what is being said
function captionSheet(r) {
  if (!r.placed.length) return null; const dir = OUT + '.capsheet'; fs.mkdirSync(dir, { recursive: true });
  r.placed.forEach((l, i) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', (l.start + l.dur / 2).toFixed(3), '-i', OUT + '.mp4', '-frames:v', '1', '-vf', 'scale=360:640', `${dir}/f${String(i).padStart(2, '0')}.png`]));
  const cols = Math.min(4, r.placed.length); const rows = Math.ceil(r.placed.length / cols);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', `${dir}/f%02d.png`, '-vf', `tile=${cols}x${rows}:padding=6:margin=6:color=white`, '-frames:v', '1', OUT + '.captions.png']);
  fs.rmSync(dir, { recursive: true, force: true }); return OUT + '.captions.png';
}
(async () => {
  const p = await plan();
  RETAKE = new Set(RETAKE_ARG.flatMap((w) => { if (w === 'all') return (p.characters || []).map((c) => c.id).concat(['narrator']); if (w === 'narrator') return ['narrator']; const c = (p.characters || []).find((q) => q.id === w || q.name.toLowerCase() === w); if (!c) { console.error(`--retake ${w}: no such character (have ${(p.characters || []).map((q) => q.id).join(', ')}, narrator)`); process.exit(2); } return [c.id]; }));
  if (RETAKE.size) log(`RETAKE ${[...RETAKE].join(', ')}${OFFLINE ? ' (ignored: --offline makes no TTS requests)' : ' (fresh TTS takes; everyone else from the cache)'}`);
  if (OFFLINE) log('OFFLINE preview: no TTS requests; cached takes, stand-in voices for anything missing'); log(`  "${(p.social || {}).seriesTitle}" | ${p.panels.length} panels | cast ${p.characters.map((c) => c.name + ':' + c.voice).join(', ')}${p.narrator && p.narrator.use ? ' | narrator ' + p.narrator.voice : ''}`);
  const lines = await cast(p);
  const r = await render(p, lines);
  const vlog = JSON.parse(fs.readFileSync(OUT + '.voice-log.json', 'utf8'));
  log('FINAL_QA'); const q = finalQa(p, r, vlog); const sheet = contactSheet(r); const capSheet = captionSheet(r);
  jw(OUT + '.render-info.json', { out: OUT + '.mp4', total: r.tm.total, shots: r.tm.shots.map((s) => ({ panel: s.panel, start: +s.start.toFixed(2), dur: +s.dur.toFixed(2), silence: s.silence, snap: s.snap, peakHold: s.peakHold })), endCard: r.tm.endCard, lines: r.placed.map((l) => ({ panel: l.panel + 1, who: l.who, voice: l.voice, start: l.start, dur: +l.dur.toFixed(2), text: l.text, standIn: !!l.standIn })), captions: p.panels.map((pn) => pn.caption || ''), poses: p.panels.map((pn) => (pn.stage.chars || []).map((c) => c.id + ':' + (c.arms || 'idle') + (c.holds ? '+' + c.holds : ''))), music: MUSIC, sfx: r.cues, ttsRequests: requests, standIns, retaken: [...retaken], offline: OFFLINE, contactSheet: sheet, captionSheet: capSheet });
  fs.rmSync(OUT + '.mix.wav', { force: true });
  log(`${q.pass ? 'DONE' : 'QA_FAIL'}${OFFLINE ? ' (offline preview)' : ''} ${OUT}.mp4 (${q.duration} s) | ${OUT}.md | ${sheet} | ${capSheet} | TTS requests this run: ${requests}${standIns ? ', stand-in voices: ' + standIns : ''}${retaken.size ? ', fresh takes: ' + [...retaken].join(', ') : ''}`);
  process.exit(q.pass ? 0 : 6);
})().catch((e) => { console.error('ERROR ' + red(e && e.stack || e)); process.exit(1); });
