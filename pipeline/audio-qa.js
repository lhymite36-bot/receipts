// Artifact detector for voice tracks and final Shorts audio (no dependencies):
//   burst  : DC-shifted / clipped noise burst (30 ms window mean > 0.08; real speech stays < 0.04). Gemini 3.8 TTS takes were
//            seen ending in a ~0.14 s full-scale burst, which sounded like a loud "system error" beep in the Short.
//   tone   : pure tone (>= 55% of the energy within +-2 FFT bins of one peak, steady pitch) for >= 150 ms at a loud level
//   click  : isolated impulse in quiet audio (sample jump > 0.2, the 10 ms before and after it both quieter than -34 dBFS;
//            clicks inside loud speech are masked, and plosives/sibilants stay loud after the jump)
//   harsh  : loud hiss (20 ms zero-crossing rate > 0.5 and peak > 0.6 FS), e.g. an over-bright "s" or a harsh stamp effect
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
  // harsh noise: 20 ms windows that are almost pure hiss (zero-crossing rate > 0.5) and loud (peak > 0.6 FS): an over-bright "s"
  // or a harsh effect
  const h20 = Math.round(0.02 * rate); let hopen = null;
  for (let s0 = 0; s0 + h20 <= x.length; s0 += h20) { let zc = 0; let pk = 0; for (let i = s0 + 1; i < s0 + h20; i++) { if ((x[i] >= 0) !== (x[i - 1] >= 0)) zc++; pk = Math.max(pk, Math.abs(x[i])); } const z = zc / h20; const bad = z > 0.5 && pk > 0.6; const t = s0 / rate;
    if (bad && !hopen) hopen = { kind: 'harsh', t: +t.toFixed(2), dur: 0, zcr: +z.toFixed(2), peak: +pk.toFixed(2), allowed: inAllow(t) }; else if (bad) { hopen.zcr = Math.max(hopen.zcr, +z.toFixed(2)); hopen.peak = Math.max(hopen.peak, +pk.toFixed(2)); } else if (hopen) { hopen.dur = +(t - hopen.t).toFixed(2); ev.push(hopen); hopen = null; } }
  if (hopen) ev.push(hopen);
  // clipping
  let clip = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.995) clip++; if (clip / x.length > 0.0005) ev.push({ kind: 'clip', pct: +(clip / x.length * 100).toFixed(3) });
  ev.sort((a, b) => (a.t || 0) - (b.t || 0));
  const fails = ev.filter((e) => !(e.kind === 'tone' && e.allowed));  // harsh noise fails even inside an effect window
  return { ok: !fails.length, refDb: +(20 * Math.log10(ref)).toFixed(1), events: ev, fails };
}
// Music-aware classification for Story renders. pcs = pitch classes the bed plays (audiofx.musicPitches(style)).
//  bedNote(hz): a sustained tone is one of the bed's notes (nearest semitones, within one FFT bin or 3%)
//  musicStem(scanOfMusicStem): the bed tested against its own reference -> { ok, tones, offBed } (tones must be bed notes; any
//            burst / click / harsh / clip in the bed fails)
//  finalMix(scanOfMix, musicTones): a tone in the final mix passes only inside an effect window or when the same note (time
//            overlap, hz within 2 bins or 3%) is in the music stem; everything else keeps failing. Mutates + returns the scan.
function musicAware(pcs, rate) {
  rate = rate || RATE; const bin = rate / 2048;
  const bedNote = (hz) => { if (!(hz > 0)) return false; const mi = 69 + 12 * Math.log2(hz / 440); for (let m = Math.round(mi) - 2; m <= Math.round(mi) + 2; m++) { if (!pcs.includes(((m % 12) + 12) % 12)) continue; const f = 440 * Math.pow(2, (m - 69) / 12); if (Math.abs(f - hz) <= Math.max(bin, f * 0.03)) return true; } return false; };
  const musicStem = (ms) => { const tones = ms.events.filter((e) => e.kind === 'tone'); tones.forEach((e) => { e.bedNote = bedNote(e.hz); }); const offBed = ms.events.filter((e) => (e.kind === 'tone' ? !e.bedNote : true)); return { ok: !offBed.length, tones, offBed }; };
  const finalMix = (sc, mtones) => { sc.events.forEach((e) => { if (e.kind === 'tone' && !e.allowed) { const hit = (mtones || []).find((m) => m.bedNote && m.t < e.t + e.dur + 0.1 && m.t + m.dur > e.t - 0.1 && Math.abs(m.hz - e.hz) <= Math.max(2 * bin, e.hz * 0.03)); if (hit) e.music = true; } }); sc.fails = sc.events.filter((e) => !(e.kind === 'tone' && (e.allowed || e.music))); sc.ok = !sc.fails.length; return sc; };
  return { bedNote, musicStem, finalMix };
}
// Voice-harmonic classification for Story renders. A strong vowel can put most of its energy into one harmonic for 150+ ms
// (e.g. the 2nd harmonic of Maya's "Le-o" at 2 x 328 Hz = 656 Hz), which the pure-tone detector reports as a "tone". Such an event
// is voice, not a beep, when ALL of these hold over the event:
//   - it lies inside a voiced line window;
//   - the voice stem is voiced in >= 80% of the frames (autocorrelation F0, 40 ms frames);
//   - the tone's frequency sits on one integer harmonic k of that F0 (|hz / f0 - k| <= 1.5% of k; measured voice harmonics stay within 1%) in >= 80% of the frames, i.e.
//     it moves with the voice's own pitch (a fixed beep under a moving voice drifts off the harmonic);
//   - the peak is in the voice stem itself (voice-stem level at that frequency within 6 dB of the scanned signal's), so a beep
//     from an effect or the music that happens to coincide still fails.
// voiceAware(voiceStem, lineWindows, rate).classify(scan, x) marks e.voice = { k, f0 } and recomputes scan.fails / scan.ok.
function voiceAware(voice, wins, rate) {
  rate = rate || RATE; const N = 2048; const bin = rate / N;
  const inLine = (a, b) => (wins || []).some(([p0, p1]) => a >= p0 - 0.02 && b <= p1 + 0.02);
  // F0 of the voice stem around time c. With removeHz, a sinusoid at that frequency is least-squares fitted and subtracted first,
  // so a beep cannot drag the pitch estimate onto itself (a real harmonic removed this way leaves the other harmonics, same F0).
  const f0At = (c, removeHz) => { const fl = Math.round(0.04 * rate); const lo = Math.floor(rate / 700); const hi = Math.ceil(rate / 65); const s = Math.max(0, Math.round(c * rate - fl / 2)); if (s + fl + hi >= voice.length) return 0;
    const L2 = fl + hi + 2; let y = Float64Array.from(voice.subarray(s, s + L2));
    if (removeHz) { const w = 2 * Math.PI * removeHz / rate; let a = 0; let b = 0; let ca = 0; let cb = 0; for (let i = 0; i < L2; i++) { const cs = Math.cos(w * i); const sn = Math.sin(w * i); a += y[i] * cs; b += y[i] * sn; ca += cs * cs; cb += sn * sn; } a /= ca; b /= cb; y = y.map((v, i) => v - a * Math.cos(w * i) - b * Math.sin(w * i)); }
    let e0 = 0; for (let i = 0; i < fl; i++) e0 += y[i] ** 2; if (Math.sqrt(e0 / fl) < 0.003) return 0; const r = new Float64Array(hi + 2);
    for (let k = lo - 1; k <= hi + 1; k++) { let c2 = 0; let ek = 0; for (let i = 0; i < fl; i++) { c2 += y[i] * y[i + k]; ek += y[i + k] ** 2; } r[k] = c2 / Math.sqrt(e0 * ek + 1e-12); }
    let bk = 0; let best = 0; for (let k = lo; k <= hi; k++) if (r[k] > best && r[k] >= r[k - 1] && r[k] >= r[k + 1]) { best = r[k]; bk = k; }
    // prefer the shortest period that is nearly as periodic (avoids octave-down picks)
    for (let k = lo; k < bk; k++) if (r[k] > 0.9 * best && r[k] >= r[k - 1] && r[k] >= r[k + 1] && Math.abs(bk / k - Math.round(bk / k)) < 0.08) { bk = k; best = r[k]; break; }
    if (best < 0.5 || !bk) return 0; const d = r[bk - 1] - 2 * r[bk] + r[bk + 1]; const off = d ? 0.5 * (r[bk - 1] - r[bk + 1]) / d : 0; return rate / (bk + off); };
  const peakAt = (x, c, hz0) => { const s = Math.max(0, Math.round(c * rate - N / 2)); if (s + N > x.length) return null; const m = dft(Array.prototype.slice.call(x.subarray(s, s + N)).map((v, i) => v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)))));
    const k0 = Math.round(hz0 / bin); let k = k0; for (let j = k0 - 3; j <= k0 + 3; j++) if (m[j] > m[k]) k = j; const a = Math.log(m[k - 1] + 1e-20); const b = Math.log(m[k] + 1e-20); const g = Math.log(m[k + 1] + 1e-20); const d = a - 2 * b + g; const off = d ? 0.5 * (a - g) / d : 0;
    return { hz: (k + off) * bin, pow: m[k] }; };
  function classify(sc, x) {
    sc.events.forEach((e) => {
      if (e.kind !== 'tone' || e.allowed || e.music) return; const a = e.t; const b = e.t + e.dur; if (!inLine(a, b)) return;
      const fr = []; for (let c = a + N / rate / 2; c <= b - N / rate / 2 + 1e-6; c += 0.025) fr.push(c); if (!fr.length) fr.push((a + b) / 2);
      let voiced = 0; let onK = 0; let fromVoice = 0; const ks = []; const f0s = []; const devs = [];
      for (const c of fr) { const px = peakAt(x, c, e.hz); const pv = peakAt(voice, c, e.hz); if (!px || !pv) continue; const f0 = f0At(c, px.hz); if (f0) { voiced++; f0s.push(f0); const k = Math.round(px.hz / f0); ks.push(k); devs.push(+(px.hz / f0 / Math.max(1, k) - 1).toFixed(4)); if (k >= 1 && k <= 12 && Math.abs(px.hz / f0 - k) <= 0.015 * k) onK++; } if (pv.pow >= px.pow * Math.pow(10, -6 / 10)) fromVoice++; }
      const n = fr.length; const kMode = ks.sort((p, q) => ks.filter((v) => v === q).length - ks.filter((v) => v === p).length)[0];
      const isVoice = voiced >= 0.8 * n && onK >= 0.8 * n && fromVoice >= 0.8 * n && ks.filter((v) => v === kMode).length >= 0.8 * n;
      e.voiceCheck = { frames: n, voiced, onHarmonic: onK, fromVoice, k: kMode, f0: f0s.length ? Math.round(A.median(f0s)) : 0, maxDev: devs.length ? Math.max(...devs.map(Math.abs)) : null };
      if (isVoice) e.voice = { k: kMode, f0: e.voiceCheck.f0 };
    });
    sc.fails = sc.events.filter((e) => !(e.kind === 'tone' && (e.allowed || e.music || e.voice))); sc.ok = !sc.fails.length; return sc;
  }
  return { classify, f0At };
}
module.exports = { scan, decode, musicAware, voiceAware, RATE };
if (require.main === module) {
  const args = process.argv.slice(2); const file = args.find((a) => !a.startsWith('--') && !/^[\d.,-]+$/.test(a));
  const ai = args.indexOf('--allow'); const allow = ai >= 0 && args[ai + 1] ? args[ai + 1].split(',').filter(Boolean).map((p) => p.split('-').map(Number)) : [];
  const r = scan(decode(file), RATE, { allow });
  if (args.includes('--json')) console.log(JSON.stringify(r)); else { console.log((r.ok ? 'AUDIO_QA_PASS ' : 'AUDIO_QA_FAIL ') + path.basename(file) + ' (ref ' + r.refDb + ' dB)'); r.events.forEach((e) => console.log('  ' + (e.allowed ? 'sfx ' : r.fails.includes(e) ? 'BAD ' : '    ') + JSON.stringify(e))); }
  process.exit(r.ok ? 0 : 6);
}
