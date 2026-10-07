// Artifact detector for voice tracks and final Shorts audio (no dependencies):
//   burst  : DC-shifted / clipped noise burst (30 ms window mean > 0.08; real speech stays < 0.04). Gemini 3.8 TTS takes were
//            seen ending in a ~0.14 s full-scale burst, which sounded like a loud "system error" beep in the Short.
//   tone   : pure tone (>= 55% of the energy within +-2 FFT bins of one peak, steady pitch) for >= 150 ms at a loud level
//   click  : isolated impulse in quiet audio (sample jump > 0.2, the 10 ms before and after it both quieter than -34 dBFS;
//            clicks inside loud speech are masked, and plosives/sibilants stay loud after the jump)
//   clip   : > 0.05% of samples at full scale
// Usage: node pipeline/audio-qa.js <audio or video file> [--allow t0-t1,...] [--json]   (exit 6 when artifacts are found)
// --allow lists windows (seconds) with intentional sound effects; tones inside them are reported, not failed.
'use strict';
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const A = require('./audio-features');
const RATE = 24000;
function decode(file) {
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
  const x = new Float32Array(raw.length >> 1); for (let i = 0; i < x.length; i++) x[i] = raw.readInt16LE(i * 2) / 32768; return x;
}
function fftMag(seg) { const N = seg.length; const fr = new Float64Array(N); for (let i = 0; i < N; i++) fr[i] = seg[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))); return A._fftMag ? A._fftMag(fr) : dft(fr); }
function dft(re) { // radix-2 FFT magnitude
  const n = re.length; const im = new Float64Array(n); const r = Float64Array.from(re);
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const t = r[i]; r[i] = r[j]; r[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len; const wr = Math.cos(ang); const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1; let ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k; const b = a + len / 2; const vr = r[b] * cr - im[b] * ci; const vi = r[b] * ci + im[b] * cr; r[b] = r[a] - vr; im[b] = im[a] - vi; r[a] += vr; im[a] += vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
  const m = new Float64Array(n / 2); for (let i = 0; i < n / 2; i++) m[i] = r[i] * r[i] + im[i] * im[i]; return m;
}
function scan(x, rate, opts) {
  rate = rate || RATE; opts = opts || {}; const allow = opts.allow || []; const ev = [];
  const inAllow = (t) => allow.some(([a, b]) => t >= a - 0.05 && t <= b + 0.05);
  // loudness reference: median RMS of active 50 ms frames
  const h50 = Math.round(0.05 * rate); const act = []; for (let s = 0; s + h50 <= x.length; s += h50) { let e = 0; for (let i = 0; i < h50; i++) e += x[s + i] ** 2; const r = Math.sqrt(e / h50); if (r > 0.01) act.push(r); }
  const ref = A.median(act) || 0.05;
  // bursts / DC steps
  const h30 = Math.round(0.03 * rate); const h10 = Math.round(0.01 * rate); let open = null;
  for (let s = 0; s + h30 <= x.length; s += h10) { let m = 0; for (let i = 0; i < h30; i++) m += x[s + i]; m /= h30; const bad = Math.abs(m) > 0.08; const t = s / rate;
    if (bad && !open) open = { kind: 'burst', t: +t.toFixed(2), dur: 0, dc: Math.abs(m) }; else if (bad) open.dc = Math.max(open.dc, Math.abs(m)); else if (open) { open.dur = +(t + 0.03 - open.t).toFixed(2); open.dc = +open.dc.toFixed(3); ev.push(open); open = null; } }
  if (open) { open.dur = +(x.length / rate - open.t).toFixed(2); open.dc = +open.dc.toFixed(3); ev.push(open); }
  // pure tones
  const N = 2048; const hop = Math.round(0.025 * rate); let run = null; const flush = () => { if (run && run.n * 0.025 >= 0.15) { const t = run.t; ev.push({ kind: 'tone', t: +t.toFixed(2), dur: +(run.n * 0.025 + 0.06).toFixed(2), hz: Math.round(run.hz), db: +(20 * Math.log10(run.rms)).toFixed(1), relDb: +(20 * Math.log10(run.rms / ref)).toFixed(1), allowed: inAllow(t) }); } run = null; };
  for (let s = 0; s + N <= x.length; s += hop) {
    let e = 0; for (let i = 0; i < N; i++) e += x[s + i] ** 2; const rms = Math.sqrt(e / N);
    if (rms < Math.max(0.004, ref * 0.2)) { flush(); continue; } // only loud tones are a problem
    const m = dft(Array.prototype.slice.call(x.subarray(s, s + N)).map((v, i) => v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)))));
    let k = 3; for (let i = 4; i < m.length; i++) if (m[i] > m[k]) k = i; let tot = 0; for (let i = 3; i < m.length; i++) tot += m[i]; let pk = 0; for (let i = Math.max(3, k - 2); i <= k + 2; i++) pk += m[i];
    const hz = k * rate / N; const tonal = pk / (tot || 1);
    if (tonal > 0.55 && hz > 120) { if (run && Math.abs(hz - run.hz) / run.hz < 0.03) { run.n++; run.rms = Math.max(run.rms, rms); } else { flush(); run = { t: s / rate, n: 1, hz, rms }; } } else flush();
  }
  flush();
  // clicks
  let lastClick = -1;
  // an isolated impulse: big sample jump with quiet audio both before it and after it (sibilants and speech onsets stay loud after)
  const h2 = Math.round(0.002 * rate); const lrms = (a, b) => { let e = 0; for (let j = a; j < b; j++) e += x[j] ** 2; return Math.sqrt(e / Math.max(1, b - a)); };
  for (let i = h10 + 1; i < x.length - h10 - h2; i++) { const d = Math.abs(x[i] - x[i - 1]); if (d < 0.2) continue; const pre = lrms(i - h10, i - 1); const post = lrms(i + h2, i + h2 + h10); if (pre < 0.02 && post < 0.02 && d > 8 * Math.max(pre, post) && i / rate - lastClick > 0.05) { ev.push({ kind: 'click', t: +(i / rate).toFixed(3), jump: +d.toFixed(2) }); lastClick = i / rate; } }
  // clipping
  let clip = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.995) clip++; if (clip / x.length > 0.0005) ev.push({ kind: 'clip', pct: +(clip / x.length * 100).toFixed(3) });
  ev.sort((a, b) => (a.t || 0) - (b.t || 0));
  const fails = ev.filter((e) => !(e.kind === 'tone' && e.allowed));
  return { ok: !fails.length, refDb: +(20 * Math.log10(ref)).toFixed(1), events: ev, fails };
}
module.exports = { scan, decode, RATE };
if (require.main === module) {
  const args = process.argv.slice(2); const file = args.find((a) => !a.startsWith('--') && !/^[\d.,-]+$/.test(a));
  const ai = args.indexOf('--allow'); const allow = ai >= 0 && args[ai + 1] ? args[ai + 1].split(',').filter(Boolean).map((p) => p.split('-').map(Number)) : [];
  const r = scan(decode(file), RATE, { allow });
  if (args.includes('--json')) console.log(JSON.stringify(r)); else { console.log((r.ok ? 'AUDIO_QA_PASS ' : 'AUDIO_QA_FAIL ') + path.basename(file) + ' (ref ' + r.refDb + ' dB)'); r.events.forEach((e) => console.log('  ' + (e.allowed ? 'sfx ' : r.fails.includes(e) ? 'BAD ' : '    ') + JSON.stringify(e))); }
  process.exit(r.ok ? 0 : 6);
}
