/* Receipts "Story" mode audio: the expressive Gemini TTS cast (one locked voice per character + optional narrator, delivery per
   suspense beat), take cleanup (end-of-take noise bursts), splitting a per-character take into lines, objective voice QA
   (pitch / timbre per character, bursts, clipping, flat models refused) and the story mixer (music drops to hard silence on the
   silence beat, effects from the app's sfx, voice on top). Pure DSP parts also run in Node (pipeline/story-render.js). */
(function (root) {
  'use strict';
  const RATE = 24000;
  // Models allowed for Story voices, in order. Flattening models (lite / 3.1 preview) are refused, as in pipeline/voice.env.
  const ALLOWED_MODELS = ['gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts'];
  const FLAGGED_MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview'];
  const median = (a) => { if (!a.length) return 0; const s = [...a].sort((p, q) => p - q); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mean = (a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : 0);
  const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
  const semis = (a, b) => 12 * Math.log2(a / b);
  function frames(x, hop) { const fr = []; for (let s = 0; s + hop <= x.length; s += hop) { let e = 0; for (let i = 0; i < hop; i++) e += x[s + i] * x[s + i]; fr.push(Math.sqrt(e / hop)); } return fr; }
  // Gemini 3.8 TTS takes can end in a ~0.14 s DC-shifted full-scale noise burst (heard as a "system error" beep): cut any short
  // voiced stretch that contains a burst (30 ms |mean| > 0.08), trim the dead tail, remove DC (50 Hz high-pass).
  function cleanTake(x0, rate) {
    rate = rate || RATE; const hop = Math.round(0.01 * rate); const n = Math.floor(x0.length / hop); const x = Float32Array.from(x0); const glitches = [];
    const fr = frames(x, hop); const th = Math.max(0.006, median(fr.filter((v) => v > 0.006)) * 0.15 || 0.006);
    const bad = new Uint8Array(n); for (let k = 0; k + 3 <= n; k++) { let m = 0; for (let i = 0; i < 3 * hop; i++) m += x[k * hop + i]; if (Math.abs(m / (3 * hop)) > 0.08) for (let j = k; j < k + 3; j++) bad[j] = 1; }
    for (let k = 0; k < n; k++) { if (!bad[k]) continue; let a = k; while (a > 0 && fr[a - 1] > th) a--; let b = k; while (b < n && (fr[b] > th || bad[b])) b++; if ((b - a) * 0.01 > 0.6) { for (let j = a; j < b; j++) bad[j] = 0; continue; } glitches.push({ t: +(a * 0.01).toFixed(2), dur: +((b - a) * 0.01).toFixed(2) }); for (let i = a * hop; i < Math.min(x.length, b * hop); i++) x[i] = 0; for (let j = a; j < b; j++) { bad[j] = 0; fr[j] = 0; } k = b; }
    let last = n - 1; while (last > 0 && fr[last] <= th) last--; const y = x.subarray(0, Math.min(x.length, (last + 25) * hop));
    let px = 0; let py = 0; const a = Math.exp(-2 * Math.PI * 50 / rate); for (let i = 0; i < y.length; i++) { const v = y[i]; py = a * (py + v - px); px = v; y[i] = py; }
    return { x: y, glitches };
  }
  // split one take into n utterances at pauses (closest to the word-share estimate, preferring long pauses)
  function splitTake(x, n, wc, rate) {
    rate = rate || RATE; const hop = Math.round(0.01 * rate); const fr = frames(x, hop); const peak = Math.max(...fr, 1e-9); const th = Math.max(0.006, peak * 0.05); const voiced = fr.map((v) => v > th);
    const first = voiced.indexOf(true); const last = voiced.lastIndexOf(true); if (first < 0) return null;
    const seg = (a, b) => x.subarray(Math.max(0, (a - 3) * hop), Math.min(x.length, (b + 4) * hop));
    if (n === 1) return [seg(first, last + 1)];
    const gaps = []; let g = -1; for (let k = first; k <= last; k++) { if (!voiced[k] && g < 0) g = k; if (voiced[k] && g >= 0) { if (k - g >= 14) gaps.push({ a: g, b: k, len: k - g, c: (g + k) / 2 }); g = -1; } }
    if (gaps.length < n - 1) return null;
    const W = wc.reduce((p, q) => p + q, 0); let cum = 0; const cuts = []; let minA = first;
    for (let j = 0; j < n - 1; j++) { cum += wc[j]; const exp = first + (cum / W) * (last - first); const cand = gaps.filter((q) => q.a > minA + 15 && !cuts.includes(q)); if (!cand.length) return null; const best = cand.map((q) => ({ q, sc: Math.abs(q.c - exp) / 100 - Math.min(q.len, 120) / 100 * 0.9 })).sort((p, r) => p.sc - r.sc)[0].q; cuts.push(best); minA = best.b; }
    const segs = []; let st = first; cuts.forEach((c) => { segs.push([st, c.a]); st = c.b; }); segs.push([st, last + 1]);
    return segs.map(([a, b]) => seg(a, b));
  }
  function fftMag(re) { const n = re.length; const im = new Float64Array(n); const r = Float64Array.from(re); for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [r[i], r[j]] = [r[j], r[i]]; } } for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len; const wr = Math.cos(ang); const wi = Math.sin(ang); for (let i = 0; i < n; i += len) { let cr = 1; let ci = 0; for (let k = 0; k < len / 2; k++) { const ur = r[i + k]; const ui = im[i + k]; const vr = r[i + k + len / 2] * cr - im[i + k + len / 2] * ci; const vi = r[i + k + len / 2] * ci + im[i + k + len / 2] * cr; r[i + k] = ur + vr; im[i + k] = ui + vi; r[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } const m = new Float64Array(n / 2); for (let i = 0; i < n / 2; i++) m[i] = Math.hypot(r[i], im[i]); return m; }
  // pitch (autocorrelation F0), pitch variation (st), loudness, spectral centroid: same method as pipeline/audio-features.js
  function features(x, rate) {
    rate = rate || RATE; const fl = Math.round(0.04 * rate); const hop = Math.round(0.01 * rate); const f0s = []; const rms = []; const cents = [];
    const lo = Math.floor(rate / 420); const hi = Math.ceil(rate / 65); const N = 1024; const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    let peak = 0; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
    for (let s = 0; s + Math.max(fl, N) < x.length; s += hop) {
      let e = 0; for (let i = 0; i < fl; i++) e += x[s + i] ** 2; const r = Math.sqrt(e / fl); if (r < Math.max(0.01, peak * 0.06)) continue; rms.push(20 * Math.log10(r));
      let best = 0; let bk = 0; let e0 = 0; for (let i = 0; i < fl; i++) e0 += x[s + i] * x[s + i];
      for (let k = lo; k <= hi; k++) { let c = 0; let ek = 0; for (let i = 0; i < fl; i++) { c += x[s + i] * x[s + i + k]; ek += x[s + i + k] * x[s + i + k]; } const v = c / Math.sqrt(e0 * ek + 1e-12); if (v > best) { best = v; bk = k; } }
      if (best > 0.55 && bk) f0s.push(rate / bk);
      if ((s / hop) % 4 === 0) { const fr = new Float64Array(N); for (let i = 0; i < N; i++) fr[i] = x[s + i] * win[i]; const m = fftMag(fr); let num = 0; let den = 0; for (let i = 1; i < m.length; i++) { const f = i * rate / N; if (f > 8000) break; num += f * m[i]; den += m[i]; } if (den > 0) cents.push(num / den); }
    }
    const f0med = median(f0s); const st = f0s.filter((f) => f > f0med / 1.9 && f < f0med * 1.9).map((f) => 12 * Math.log2(f / (f0med || 1)));
    return { dur: +(x.length / rate).toFixed(2), f0: Math.round(f0med), f0StdSt: +std(st).toFixed(2), rmsDb: +mean(rms).toFixed(1), centroid: Math.round(mean(cents)), voiced: f0s.length };
  }
  // bursts (30 ms |mean| > 0.08) and clipping in a voice line or a mix
  function scan(x, rate) {
    rate = rate || RATE; const hop = Math.round(0.03 * rate); const out = { bursts: [], clipped: 0 }; let run = 0;
    for (let s = 0; s + hop <= x.length; s += hop) { let m = 0; for (let i = 0; i < hop; i++) m += x[s + i]; if (Math.abs(m / hop) > 0.08) out.bursts.push(+(s / rate).toFixed(2)); }
    for (let i = 0; i < x.length; i++) { if (Math.abs(x[i]) >= 0.999) { run++; if (run === 4) out.clipped++; } else run = 0; }
    return out;
  }
  function normalize(x, targetDb, peakCap) {
    let e = 0; let n = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.01) { e += x[i] * x[i]; n++; } const rms = Math.sqrt(e / Math.max(1, n)) || 1e-6;
    let g = Math.pow(10, targetDb / 20) / rms; let pk = 0; for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i])); if (pk * g > (peakCap || 0.85)) g = (peakCap || 0.85) / pk;
    const y = new Float32Array(x.length); const f = Math.min(x.length >> 1, Math.round(0.006 * RATE)); for (let i = 0; i < x.length; i++) y[i] = x[i] * g; for (let i = 0; i < f; i++) { y[i] *= i / f; y[y.length - 1 - i] *= i / f; } return y;
  }
  // Sibilance control for a voice line: 20 ms windows that are almost pure hiss (zero-crossing rate > 0.35) and loud are turned
  // down so their peak sits at thr (gain smoothed over neighbouring windows). Vowels are untouched. Keeps over-bright "s" sounds
  // under audio-qa's harsh-noise limit (ZCR > 0.5 at > 0.6 FS) without dulling the voice.
  function deEss(x, rate, o) {
    rate = rate || RATE; o = o || {}; const thr = o.thr || 0.42; const zth = o.zcr || 0.35; const hop = Math.round(0.01 * rate); const n = Math.ceil(x.length / hop); const g = new Float32Array(n + 2).fill(1); let hits = 0;
    for (let k = 0; k < n; k++) { const a = Math.max(1, k * hop - (hop >> 1)); const b = Math.min(x.length, a + 2 * hop); let zc = 0; let pk = 0; for (let i = a; i < b; i++) { if ((x[i] >= 0) !== (x[i - 1] >= 0)) zc++; pk = Math.max(pk, Math.abs(x[i])); } if (zc / Math.max(1, b - a) > zth && pk > thr) { g[k] = thr / pk; hits++; } }
    const gs = new Float32Array(n + 1); for (let k = 0; k <= n; k++) gs[k] = Math.min(g[k], k ? g[k - 1] : 1, g[k + 1] === undefined ? 1 : g[k + 1]);
    const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) { const q = i / hop; const k = Math.floor(q); const f = q - k; y[i] = x[i] * (gs[k] * (1 - f) + (gs[Math.min(n, k + 1)]) * f); }
    return { x: y, hits };
  }
  // QA over the cast: every character (and the narrator) distinct by measured pitch or timbre; nobody flat
  function castQa(lines, models, qo) {
    qo = qo || {};
    const by = {}; lines.forEach((l) => { if (!l.x || !l.x.length) return; (by[l.who] = by[l.who] || []).push(l); });
    const who = {}; for (const [k, ls] of Object.entries(by)) { const fs = ls.map((l) => Object.assign(features(l.x, RATE), { delivery: l.delivery })); const pitched = fs.filter((f) => f.voiced >= 8 && f.delivery !== 'whisper'); const use = pitched.length ? pitched : fs.filter((f) => f.voiced >= 4);
      who[k] = { voice: ls[0].voice, lines: ls.length, f0: Math.round(median(use.map((f) => f.f0))) || 0, centroid: Math.round(median(fs.map((f) => f.centroid))), f0StdSt: +median(use.map((f) => f.f0StdSt)).toFixed(2) }; }
    const names = Object.keys(who); const pairs = [];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) { const a = who[names[i]]; const b = who[names[j]]; const st = a.f0 && b.f0 ? Math.abs(semis(a.f0, b.f0)) : 0; const cg = Math.abs(a.centroid - b.centroid) / Math.max(1, Math.min(a.centroid, b.centroid)); pairs.push({ a: names[i], b: names[j], pitchGapSt: +st.toFixed(1), timbreGapPct: Math.round(cg * 100), ok: st >= 3 || cg >= 0.18 }); }
    const bursts = []; let clipped = 0; lines.forEach((l) => { if (!l.x) return; const s = scan(l.x, RATE); if (s.bursts.length) bursts.push({ who: l.who, panel: l.panel + 1, at: s.bursts }); clipped += s.clipped; });
    // flagged / lite models flatten the delivery: refused unless the user explicitly chose one ("lower expressiveness");
    // other non-flagged TTS models the key offers are accepted when the rest of the QA passes
    const flat = (models || []).filter((m) => FLAGGED_MODELS.includes(m) || /-lite-/i.test(m) || (qo.strict && !ALLOWED_MODELS.includes(m)));
    const monotone = Object.entries(who).filter(([k, v]) => v.f0 && v.f0StdSt < 1.2 && k !== 'narrator').map(([k]) => k);
    const checks = [
      { name: 'every voice differs from every other (pitch gap >= 3 st or timbre gap >= 18%)', ok: pairs.every((p) => p.ok), val: pairs },
      flat.length && qo.acceptFlagged ? { name: 'lower-expressiveness model chosen by you (' + flat.join(', ') + ')', ok: true, val: models, lowerExpressiveness: true } : { name: 'no flattening TTS model used (lite / 3.1 preview refused)', ok: !flat.length, val: models },
      { name: 'no noise bursts or clipping in the voice lines', ok: !bursts.length && !clipped, val: { bursts, clipped } },
      { name: 'characters are expressive (pitch varies >= 1.2 st within lines)', ok: !monotone.length, val: Object.fromEntries(Object.entries(who).map(([k, v]) => [k, v.f0StdSt])) },
    ];
    return { pass: checks.every((c) => c.ok), checks, who, pairs };
  }
  // per-panel speech length (for timing) and line placement in video time
  function placeLines(plan, lines, S) {
    S = S || (root && root.VTS && root.VTS.story) || (typeof require === 'function' ? require('./story.js') : null);
    const per = plan.panels.map(() => []); lines.forEach((l) => { if (per[l.panel]) per[l.panel].push(l); });
    const order = (a, b) => (a.who === 'narrator' ? -1 : 0) - (b.who === 'narrator' ? -1 : 0);
    const lineDur = per.map((ls) => (ls.length ? ls.reduce((s, l) => s + l.dur, 0) + 0.25 * (ls.length - 1) : 0));
    const tm = S.timing(plan, lineDur); const placed = [];
    per.forEach((ls, i) => { let t = tm.shots[i].start + S.LINE_LEAD; ls.sort(order).forEach((l) => { placed.push(Object.assign({}, l, { start: +t.toFixed(3) })); t += l.dur + 0.25; }); });
    return { tm, lines: placed, lineDur };
  }
  const SFX_FOR_CUE = { door: 'creak', cup: 'clink', ding: 'ding' };
  // Story soundtrack (48 kHz stereo Float32): music bed ducked under the voice, hard silence (no voice, no music, no effects)
  // through the silence beat, panel effects, softened like the main pipeline (4.5 kHz low-pass, 0.3 FS cap per effect).
  async function mix(plan, placed, tm, o) {
    o = o || {}; const AF = root.VTS.audiofx; const sr = 48000; const N = Math.ceil(tm.total * sr); const L = new Float32Array(N); const R = new Float32Array(N); const V = new Float32Array(N); const MU = o.stems ? new Float32Array(N) : null; const FX = o.stems ? new Float32Array(N) : null;
    placed.forEach((l) => { const i0 = Math.round(l.start * sr); const k = RATE / sr; const n = Math.floor(l.x.length / k); for (let j = 0; j < n; j++) { const p = j * k; const a = Math.floor(p); const v = (l.x[a] || 0) * (1 - (p - a)) + (l.x[a + 1] || 0) * (p - a); const i = i0 + j; if (i < N) V[i] += v * (o.voiceVol == null ? 1 : o.voiceVol); } });
    const act = new Float32Array(Math.ceil(N / 480)); { let v = 0; for (let k = 0; k < act.length; k++) { let e = 0; for (let i = k * 480; i < Math.min(N, k * 480 + 480); i++) e += V[i] * V[i]; const on = Math.sqrt(e / 480) > 0.01 ? 1 : 0; v = on > v ? v + (on - v) * 0.5 : v + (on - v) * 0.04; act[k] = v; } }
    const silence = tm.shots.filter((s) => s.silence).map((s) => [s.start, s.start + s.dur]);
    const inSil = (t) => silence.some(([a, b]) => t >= a && t < b);
    const silGain = (t) => { let g = 1; for (const [a, b] of silence) { const f = 0.03; if (t >= a - f && t < a) g = Math.min(g, (a - t) / f); else if (t >= a && t < b) g = 0; else if (t >= b && t < b + 0.12) g = Math.min(g, (t - b) / 0.12); } return g; };
    if (o.music !== 'none') {
      const m = AF.music(o.music || 'storybook', sr); const base = 0.32 * (o.musicVol == null ? 0.45 : o.musicVol); const duck = 1 - Math.pow(10, -12 / 20); const fin = 0.4 * sr; const fout = 0.7 * sr;
      for (let i = 0; i < N; i++) { let g = base * (1 - duck * act[Math.floor(i / 480)]) * silGain(i / sr); if (i < fin) g *= i / fin; if (i > N - fout) g *= (N - i) / fout; const k = i % m.loopLen; L[i] += m.L[k] * g; R[i] += m.R[k] * g; if (MU) MU[i] = (m.L[k] + m.R[k]) * 0.5 * g; }
    }
    const cues = [];
    plan.panels.forEach((pn, i) => { const s = tm.shots[i]; if (s.silence) return; if (pn.effect && pn.effect !== 'none') cues.push({ t: s.start + (s.snap ? 0.04 : Math.min(0.5, s.dur * 0.18)), id: pn.effect }); const shot = (plan.shots || [])[i]; const extra = shot && SFX_FOR_CUE[shot.audioCue]; if (extra && extra !== pn.effect) cues.push({ t: s.start + Math.min(0.9, s.dur * 0.4), id: extra, gain: 0.7 }); });
    const sv = o.sfxVol == null ? 0.6 : o.sfxVol;
    for (const c of cues) {
      if (inSil(c.t)) continue; const d = AF.SFX[c.id]; if (!d) continue; const smp = await AF.sample(c.id, sr); if (!smp) continue;
      const rate = smp.sr / sr; const n = Math.floor(smp.data.length / rate); const src = new Float32Array(n); const g = d.gain * sv * (c.gain || 1);
      for (let j = 0; j < n; j++) { const p = j * rate; const a = Math.floor(p); src[j] = ((smp.data[a] || 0) * (1 - (p - a)) + (smp.data[a + 1] || 0) * (p - a)) * g; }
      let y1 = 0; let y2 = 0; const al = Math.exp(-2 * Math.PI * 4500 / sr); for (let j = 0; j < n; j++) { y1 = (1 - al) * src[j] + al * y1; y2 = (1 - al) * y1 + al * y2; src[j] = y2; }
      let pk = 0; for (let j = 0; j < n; j++) pk = Math.max(pk, Math.abs(src[j])); if (pk > 0.3) for (let j = 0; j < n; j++) src[j] *= 0.3 / pk;
      const i0 = Math.floor(c.t * sr); for (let j = 0; j < n; j++) { const i = i0 + j; if (i >= N) break; const gg = (1 - 0.35 * act[Math.floor(i / 480)]) * silGain(i / sr); L[i] += src[j] * gg; R[i] += src[j] * gg; if (FX) FX[i] += src[j] * gg; }
    }
    const lim = (x) => { const a = Math.abs(x); return a <= 0.8 ? x : Math.sign(x) * (0.8 + 0.19 * Math.tanh((a - 0.8) / 0.19)); };
    for (let i = 0; i < N; i++) { const t = i / sr; const vg = inSil(t) ? 0 : 1; if (o.stems && !vg) V[i] = 0; L[i] = lim(L[i] + V[i] * vg); R[i] = lim(R[i] + V[i] * vg); }
    const out = { L, R, sr, cues: cues.map((c) => ({ t: +c.t.toFixed(2), id: c.id })), silence, music: o.music || 'storybook' };
    if (o.stems) out.stems = { voice: V, sfx: FX, music: MU };
    return out;
  }
  function toAudioBuffer(m) { const ac = root.VTS.render.audioCtx(); const b = ac.createBuffer(2, m.L.length, m.sr); b.copyToChannel(m.L, 0); b.copyToChannel(m.R, 1); return b; }
  function wavBytes(m) { const nc = 2; const n = m.L.length; const dv = new DataView(new ArrayBuffer(44 + n * nc * 2)); const ws = (o, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); }; ws(0, 'RIFF'); dv.setUint32(4, 36 + n * nc * 2, true); ws(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nc, true); dv.setUint32(24, m.sr, true); dv.setUint32(28, m.sr * nc * 2, true); dv.setUint16(32, nc * 2, true); dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, n * nc * 2, true); let o = 44; for (let i = 0; i < n; i++) { dv.setInt16(o, Math.max(-1, Math.min(1, m.L[i])) * 32767, true); dv.setInt16(o + 2, Math.max(-1, Math.min(1, m.R[i])) * 32767, true); o += 4; } return new Uint8Array(dv.buffer); }

  // ---------------- in-app cast (Gemini TTS through the app's client + key) ----------------
  function pcmToFloat(r) { const b = r.pcm; const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); const ch = r.channels || 1; const n = Math.floor(b.byteLength / 2 / ch); const x = new Float32Array(n); for (let i = 0; i < n; i++) { let v = 0; for (let c = 0; c < ch; c++) v += dv.getInt16((i * ch + c) * 2, true); x[i] = v / ch / 32768; } return { x, rate: r.rate || RATE }; }
  function resample(x, from, to) { if (from === to) return x; const k = from / to; const n = Math.floor(x.length / k); const y = new Float32Array(n); for (let j = 0; j < n; j++) { const p = j * k; const a = Math.floor(p); y[j] = (x[a] || 0) * (1 - (p - a)) + (x[a + 1] || 0) * (p - a); } return y; }
  const wcount = (t) => String(t).split(/\s+/).filter(Boolean).length;
  // ---- which voice models this key can use, and what went wrong (per model) ----
  const isFlaggedModel = (m) => FLAGGED_MODELS.includes(m) || /-lite-/i.test(m);
  const session = { fp: null, avail: null, dead: new Map(), working: '' };
  function keyFp() { const G = root.VTS.gemini; const k = G.host && G.host.getKey ? String(G.host.getKey() || '') : ''; return k ? G.hashText(k) : ''; }
  function resetSession() { const G = root.VTS.gemini; session.fp = null; session.avail = null; session.dead.clear(); session.working = ''; if (G.resetCooling) G.resetCooling(); }
  function syncKey() { const fp = keyFp(); if (fp !== session.fp) { resetSession(); session.fp = fp; return true; } return false; }
  function storyError(kind, perModel, extra) {
    const info = Object.assign({ kind, perModel: perModel || [] }, extra || {});
    info.retryAfter = Math.max(0, ...info.perModel.filter((c) => c.kind === 'rate').map((c) => c.retryAfter || 0));
    const ex = explain(info, {}); const e = new Error(ex.title + ' ' + ex.text); e.story = info; e.friendly = ex.title; return e;
  }
  async function discoverModels(force) {
    const G = root.VTS.gemini; syncKey(); if (session.avail && !force) return session.avail;
    let listed = null; let listErr = null;
    try { listed = await G.listTtsModels(); } catch (e) { listErr = G.classifyError(e); if (listErr.kind === 'key') throw storyError('key', [Object.assign(listErr, { model: 'models.list' })]); }
    session.avail = listed ? { listed: true, all: listed, allowed: ALLOWED_MODELS.filter((m) => listed.includes(m)), other: listed.filter((m) => !ALLOWED_MODELS.includes(m) && !isFlaggedModel(m)), flagged: listed.filter(isFlaggedModel) }
      : { listed: false, all: [], allowed: ALLOWED_MODELS.slice(), other: [], flagged: [], listErr };
    return session.avail;
  }
  // Allowed models first; then any other non-flagged TTS model the key offers (QA still has to pass); a flagged/lite model only
  // when the user chose it ("lower expressiveness").
  function planModels(avail, o) {
    if (o && o.useModel) return [o.useModel];
    const plan = avail.listed ? avail.allowed.concat(avail.other) : ALLOWED_MODELS.slice();
    if (!plan.length) throw storyError(avail.flagged.length ? 'onlyFlagged' : 'noTts', [], { flagged: avail.flagged, listed: avail.all });
    return plan;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const knobs = { minWait: 5, maxWait: 65, netWait: 4000 }; // seconds / ms; tests shorten them
  function dominant(errs) {
    const k = errs.map((c) => c.kind); if (!k.length) return 'other'; if (k.every((x) => x === k[0])) return k[0] === 'noFree' ? 'unavailable' : k[0];
    if (k.every((x) => x === 'unavailable' || x === 'noFree')) return 'unavailable';
    return ['rate', 'daily', 'busy', 'network', 'blocked', 'other'].find((x) => k.includes(x)) || 'unavailable';
  }
  async function ttsChain(text, opt, plan, ctx) {
    const G = root.VTS.gemini; const errs = []; const order = session.working && plan.includes(session.working) ? [session.working].concat(plan.filter((m) => m !== session.working)) : plan;
    for (const model of order) {
      const d = session.dead.get(model);
      if (d && (d.kind === 'unavailable' || d.kind === 'noFree' || Date.now() - d.at < 30 * 60 * 1000)) { errs.push(Object.assign({ model, skipped: true }, d)); continue; }
      for (let attempt = 0; attempt < 3; attempt++) {
        try { const r = await G.ttsOnce(model, text, opt); ctx.calls++; session.working = model; return r; } catch (e) {
          const c = G.classifyError(e); c.model = model;
          if (c.kind === 'key') throw storyError('key', [c]);
          if (c.kind === 'rate' && attempt < 2 && !(c.retryAfter > knobs.maxWait)) { const w = Math.min(knobs.maxWait, Math.max(knobs.minWait, Math.ceil(c.retryAfter || 20))); for (let t = w; t > 0; t--) { if (ctx.onStatus) ctx.onStatus(`Google's per-minute voice limit on ${model}: retrying in ${t} s…`); await sleep(1000); } continue; }
          if ((c.kind === 'network' || c.kind === 'busy') && attempt < 1) { await sleep(knobs.netWait); continue; }
          if (c.kind === 'daily' || c.kind === 'unavailable' || c.kind === 'noFree') session.dead.set(model, { kind: c.kind, msg: c.msg, at: Date.now(), retryAfter: c.retryAfter });
          errs.push(c); break;
        }
      }
    }
    throw storyError(dominant(errs), errs, { avail: session.avail });
  }
  const KIND_LABEL = { noFree: 'no free-tier quota for this model on this key', rate: 'per-minute rate limit', daily: 'daily quota used up', unavailable: 'model not available for this key', key: 'API key rejected', network: 'network error', busy: 'Google overloaded', blocked: 'blocked by safety filter', other: 'error' };
  // Human message for a Story voice failure (shown in the app; also used by tests). ctx.keyChangedRecently adds the shared-quota note.
  function explain(info, ctx) {
    ctx = ctx || {}; const pm = info.perModel || []; const models = (k) => [...new Set(pm.filter((c) => !k || c.kind === k).map((c) => c.model))].join(', ');
    const lines = pm.map((c) => `${c.model}: ${KIND_LABEL[c.kind] || c.kind}${c.skipped ? ' (earlier today)' : ''}${c.msg ? ' — ' + c.msg : ''}`);
    let title = 'Voice generation failed.'; let text = ''; let note = '';
    switch (info.kind) {
      case 'rate': title = 'Google\u2019s per-minute voice limit was hit.'; text = `On ${models('rate')}. This clears within a minute: the app retries automatically${info.retryAfter ? ' in ' + Math.ceil(info.retryAfter) + ' s' : ''}, or tap Try again now.`; break;
      case 'daily': title = 'Today\u2019s free voice quota is used up for this key.'; text = `On ${models('daily')}. Google resets it at about 05:30 IST (midnight Pacific). The voices are queued and will be generated automatically after that. No silent or flat version is made.`;
        if (ctx.keyChangedRecently) note = 'You changed the key recently: keys created in the same Google account (the same Google Cloud project) share one daily quota, so a second key from that account adds nothing. Make the new key with a different Google account at aistudio.google.com/apikey.';
        else note = 'Tip: a key from a different Google account has its own quota (keys from the same account share it).';
        if (info.avail && info.avail.flagged && info.avail.flagged.length) text += ` This key also offers ${info.avail.flagged.join(', ')} (separate quota, lower expressiveness): you can use it now instead.`; break;
      case 'unavailable': title = 'This key can\u2019t use the Story voice models.'; text = `Not available for this key: ${[...new Set(pm.filter((c) => c.kind === 'unavailable' || c.kind === 'noFree').map((c) => c.model))].join(', ')}. New AI Studio keys (AQ.\u2026) often can\u2019t use gemini-2.5-flash-preview-tts.${info.avail && info.avail.flagged && info.avail.flagged.length ? ' The key does offer ' + info.avail.flagged.join(', ') + ' (lower expressiveness).' : ''}`; break;
      case 'onlyFlagged': title = 'This key only offers a lower-expressiveness voice model.'; text = `Available: ${(info.flagged || []).join(', ')}. These read flatter than the Story models (${ALLOWED_MODELS.join(', ')}). You can use one anyway; the voice checks still run.`; break;
      case 'noTts': title = 'This key offers no Gemini voice (TTS) models.'; text = `Models listed for the key: ${(info.listed || []).slice(0, 6).join(', ') || 'none'}. Make a key at aistudio.google.com/apikey with a different Google account.`; break;
      case 'key': title = 'Gemini rejected this API key.'; text = 'Check the key in Settings (paste it again, or make a new one at aistudio.google.com/apikey).'; break;
      case 'network': title = 'Couldn\u2019t reach Google.'; text = 'Check the internet connection (or VPN / data saver) and tap Try again now.'; break;
      case 'busy': title = 'Google\u2019s voice models are overloaded right now.'; text = 'Wait a minute and tap Try again now.'; break;
      case 'blocked': title = 'Gemini blocked a line.'; text = 'Its safety filter refused one of the lines; edit the story and try again.'; break;
      default: text = 'See the details below.';
    }
    return { title, text, note, lines };
  }
  // returns { lines: [{panel, who, voice, text, delivery, x, dur, model}], models, glitches, calls, avail, acceptFlagged }
  async function castVoices(plan, o) {
    o = o || {}; const VTS = root.VTS; const G = VTS.gemini; const S = VTS.story; const all = S.voiceLines(plan); const groups = new Map();
    all.forEach((l) => { if (!groups.has(l.who)) groups.set(l.who, []); groups.get(l.who).push(l); });
    if (o.onStatus) o.onStatus('Checking which voice models this key can use…');
    const avail = await discoverModels(!!o.rediscover); const mplan = planModels(avail, o); const ctx = { calls: 0, onStatus: o.onStatus };
    const out = []; const models = []; const glitches = []; const cache = VTS.db && VTS.db.cache;
    const req = async (text, opt) => {
      const key = 'story-tts:' + G.hashText(JSON.stringify([opt.voice, opt.parts || text, opt.style || '', o.useModel || '']));
      const hit = cache ? await cache.get(key).catch(() => null) : null; if (hit && hit.x) { models.push(hit.model); return hit; }
      const r = await ttsChain(text, opt, mplan, ctx); const f = pcmToFloat(r); const val = { x: resample(f.x, f.rate, RATE), model: r.model };
      models.push(r.model); if (cache) await cache.set(key, val).catch(() => {}); return val;
    };
    for (const [who, ls] of groups) {
      if (o.onStatus) o.onStatus(`Voicing ${who === 'narrator' ? 'the narrator' : (plan.characters.find((c) => c.id === who) || {}).name} (${ls[0].voice})…`);
      let segs = null; let model = ''; const target = session.working || mplan[0]; const multiStyle = new Set(ls.map((l) => l.delivery)).size > 1;
      if (ls.length > 1 && (!multiStyle || G.ttsIsStructured(target))) { // one request per character: one part per line with its own delivery
        const parts = ls.map((l) => ({ text: l.text, style: S.styleFor(plan, who, l.delivery) }));
        const r = await req(ls.map((l) => l.text).join('\n\n'), { voice: ls[0].voice, parts, style: S.styleFor(plan, who, ls[0].delivery) + '. Read each paragraph separately, with a clear one-second pause between paragraphs' }); model = r.model;
        const ct = cleanTake(r.x, RATE); glitches.push(...ct.glitches.map((g) => Object.assign({ who }, g)));
        segs = splitTake(ct.x, ls.length, ls.map((l) => wcount(l.text)), RATE);
        if (segs && !segs.every((sg, k) => { const spw = sg.length / RATE / Math.max(1, wcount(ls[k].text)); return spw > 0.15 && spw < 1.3; })) segs = null;
      }
      if (!segs) { segs = []; for (const l of ls) { const r = await req(l.text, { voice: l.voice, style: S.styleFor(plan, who, l.delivery) }); model = r.model; const ct = cleanTake(r.x, RATE); glitches.push(...ct.glitches.map((g) => Object.assign({ who }, g))); segs.push(splitTake(ct.x, 1, [1], RATE)[0]); } }
      ls.forEach((l, k) => { const x = deEss(normalize(segs[k], who === 'narrator' ? -20 : l.delivery === 'whisper' ? -19 : -17, 0.85), RATE).x; out.push(Object.assign({}, l, { x, dur: x.length / RATE, model })); });
    }
    out.sort((a, b) => a.panel - b.panel || (a.who === 'narrator' ? -1 : 1));
    const used = [...new Set(models)];
    return { lines: out, models: used, glitches, calls: ctx.calls, avail, acceptFlagged: !!(o.useModel && isFlaggedModel(o.useModel)) };
  }
  // short voice preview for the cast picker (one TTS request, cached)
  async function previewVoice(plan, who, voice, o) {
    o = o || {}; const VTS = root.VTS; const S = VTS.story; const c = plan.characters.find((q) => q.id === who); const text = who === 'narrator' ? 'Once upon a quiet morning, something felt different.' : `Hi, I'm ${c ? c.name : 'here'}. Did you see that?`;
    const key = 'story-prev:' + voice + ':' + who + ':' + (o.useModel || ''); const cache = VTS.db && VTS.db.cache; let hit = cache ? await cache.get(key).catch(() => null) : null;
    if (!hit) { const avail = await discoverModels(false); const r = await ttsChain(text, { voice, style: S.styleFor(plan, who, 'light') }, planModels(avail, o), { calls: 0, onStatus: o.onStatus }); const f = pcmToFloat(r); hit = { x: resample(f.x, f.rate, RATE), model: r.model }; if (cache) await cache.set(key, hit).catch(() => {}); }
    const ac = VTS.render.audioCtx(); if (ac.state === 'suspended') await ac.resume(); const b = ac.createBuffer(1, hit.x.length, RATE); b.copyToChannel(hit.x, 0); const s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(); return s;
  }

  const api = { deEss, knobs, discoverModels, resetSession, syncKey, keyFp, explain, isFlaggedModel, planModels, RATE, ALLOWED_MODELS, FLAGGED_MODELS, cleanTake, splitTake, features, scan, normalize, castQa, placeLines, mix, toAudioBuffer, wavBytes, castVoices, previewVoice, pcmToFloat, resample, median, semis };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.VTS = root.VTS || {}; root.VTS.storyAudio = api; }
}(typeof window !== 'undefined' ? window : null));
