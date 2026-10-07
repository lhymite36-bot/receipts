// Objective voice features for the Receipts voice QA (no dependencies): pitch (autocorrelation F0), pitch variability in
// semitones, loudness (RMS dB) and its variability, spectral centroid (timbre brightness), speaking rate.
'use strict';
const fs = require('fs');
function readWav(file) { // 16-bit PCM WAV -> { rate, x: Float32Array (mono) }
  const b = fs.readFileSync(file); let o = 12; let fmt = null; let data = null;
  while (o + 8 <= b.length) { const id = b.toString('ascii', o, o + 4); const n = b.readUInt32LE(o + 4); if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) }; if (id === 'data') { data = b.subarray(o + 8, o + 8 + n); break; } o += 8 + n + (n & 1); }
  if (!fmt || !data || fmt.bits !== 16) throw new Error('need 16-bit PCM wav: ' + file);
  const N = Math.floor(data.length / 2 / fmt.ch); const x = new Float32Array(N);
  for (let i = 0; i < N; i++) { let v = 0; for (let c = 0; c < fmt.ch; c++) v += data.readInt16LE((i * fmt.ch + c) * 2); x[i] = v / fmt.ch / 32768; }
  return { rate: fmt.rate, x };
}
function writeWav(file, x, rate) {
  const b = Buffer.alloc(44 + x.length * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, b);
}
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((p, q) => p - q); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => a.length ? a.reduce((p, q) => p + q, 0) / a.length : 0;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
function fftMag(re) { // radix-2, in place on copies
  const n = re.length; const im = new Float64Array(n); const r = Float64Array.from(re);
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [r[i], r[j]] = [r[j], r[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len; const wr = Math.cos(ang); const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1; let ci = 0; for (let k = 0; k < len / 2; k++) { const ur = r[i + k]; const ui = im[i + k]; const vr = r[i + k + len / 2] * cr - im[i + k + len / 2] * ci; const vi = r[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
      r[i + k] = ur + vr; im[i + k] = ui + vi; r[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
  const m = new Float64Array(n / 2); for (let i = 0; i < n / 2; i++) m[i] = Math.hypot(r[i], im[i]); return m;
}
// features of one utterance
function features(x, rate, words) {
  const fl = Math.round(0.04 * rate); const hop = Math.round(0.01 * rate); const f0s = []; const rms = []; const cents = [];
  const lo = Math.floor(rate / 420); const hi = Math.ceil(rate / 65); const N = 1024; const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  let peak = 0; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  for (let s = 0; s + Math.max(fl, N) < x.length; s += hop) {
    let e = 0; for (let i = 0; i < fl; i++) e += x[s + i] ** 2; const r = Math.sqrt(e / fl); if (r < Math.max(0.01, peak * 0.06)) continue; rms.push(20 * Math.log10(r));
    // F0: normalised autocorrelation
    let best = 0; let bk = 0; let e0 = 0; for (let i = 0; i < fl; i++) e0 += x[s + i] * x[s + i];
    for (let k = lo; k <= hi; k++) { let c = 0; let ek = 0; for (let i = 0; i < fl; i++) { c += x[s + i] * x[s + i + k]; ek += x[s + i + k] * x[s + i + k]; } const v = c / Math.sqrt(e0 * ek + 1e-12); if (v > best) { best = v; bk = k; } }
    if (best > 0.55 && bk) f0s.push(rate / bk);
    if ((s / hop) % 4 === 0) { const fr = new Float64Array(N); for (let i = 0; i < N; i++) fr[i] = x[s + i] * win[i]; const m = fftMag(fr); let num = 0; let den = 0; for (let i = 1; i < m.length; i++) { const f = i * rate / N; if (f > 8000) break; num += f * m[i]; den += m[i]; } if (den > 0) cents.push(num / den); }
  }
  const f0med = median(f0s); const st = f0s.filter((f) => f > f0med / 1.9 && f < f0med * 1.9).map((f) => 12 * Math.log2(f / (f0med || 1)));
  const dur = x.length / rate;
  return { dur: +dur.toFixed(2), f0: Math.round(f0med), f0StdSt: +std(st).toFixed(2), rmsDb: +mean(rms).toFixed(1), rmsStdDb: +std(rms).toFixed(1), centroid: Math.round(mean(cents)), wps: words ? +(words / Math.max(0.2, dur)).toFixed(2) : 0, voiced: f0s.length };
}
const semis = (a, b) => 12 * Math.log2(a / b);
module.exports = { readWav, writeWav, features, median, mean, std, semis };
