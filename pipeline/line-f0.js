// Per-line pitch measured on the FINAL audio (after mixing with music/SFX and muxing), to confirm the Claim Guy vs Skeptic
// contrast survives the mix:  node pipeline/line-f0.js <short.mp4> [voice-log.json]
// Line windows come from the voice log (voice time) + LEAD (the renderer starts the voice 0.3 s into the video).
'use strict';
const fs = require('fs'); const { execFileSync } = require('child_process'); const F = require('./audio-features');
const LEAD = 0.3; const RATE = 24000;
function decode(file) { // any media -> mono Float32 at RATE
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
  const x = new Float32Array(b.length >> 1); for (let i = 0; i < x.length; i++) x[i] = b.readInt16LE(i * 2) / 32768; return x;
}
function lineF0(mp4, voiceLog, lead = LEAD) {
  const log = JSON.parse(fs.readFileSync(voiceLog, 'utf8')); const x = decode(mp4);
  const lines = log.lines.map((l) => {
    const a = Math.max(0, Math.round((lead + l.start + 0.05) * RATE)); const b = Math.min(x.length, Math.round((lead + l.start + l.dur - 0.05) * RATE));
    const f = F.features(x.subarray(a, b), RATE);
    return { line: l.i, who: l.who, t: +(lead + l.start).toFixed(2), dur: l.dur, f0Mp4: f.f0, f0Voice: l.f0, voiced: f.voiced, text: l.text.slice(0, 48) };
  });
  const med = (who) => F.median(lines.filter((l) => l.who === who && l.f0Mp4).map((l) => l.f0Mp4));
  const claim = med('claim'); const skeptic = med('skeptic');
  const minClaim = Math.min(...lines.filter((l) => l.who === 'claim').map((l) => l.f0Mp4)); const maxSkeptic = Math.max(...lines.filter((l) => l.who === 'skeptic').map((l) => l.f0Mp4));
  return { lines, claimF0: claim, skepticF0: skeptic, gapSt: +F.semis(claim, skeptic).toFixed(1), worstPairGapSt: +F.semis(minClaim, maxSkeptic).toFixed(1) };
}
// finer: one window per script beat, from its first heard word to the next beat's (needs beats[i].wordAt from voice-cast)
function beatF0(mp4, pkgFile, lead = LEAD) {
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')); const bs = pkg.beats || []; if (!bs.every((b) => Array.isArray(b.wordAt) && b.wordAt.length)) return null;
  const x = decode(mp4); const who = (sp) => (sp === 'brain' ? 'claim' : 'skeptic'); // 'me' and the narrator are both read by the Skeptic voice
  return bs.map((b, i) => { const t0 = lead + b.wordAt[0]; const t1 = i + 1 < bs.length ? lead + bs[i + 1].wordAt[0] : Math.min(x.length / RATE, t0 + 1.6);
    const f = F.features(x.subarray(Math.round((t0 + 0.02) * RATE), Math.round((t1 - 0.05) * RATE)), RATE);
    return { beat: i, who: who(b.speaker), t: +t0.toFixed(2), f0Mp4: f.f0, voiced: f.voiced, text: (b.text || '').slice(0, 44) }; });
}
module.exports = { lineF0, beatF0 };
if (require.main === module) {
  const mp4 = process.argv[2]; const vl = process.argv[3] || mp4.replace(/\.mp4$/, '.voice-log.json');
  const r = lineF0(mp4, vl);
  r.lines.forEach((l) => console.log(`  ${l.who.padEnd(8)} @${String(l.t).padStart(6)}s ${String(l.dur).padStart(5)}s  f0 mp4 ${String(l.f0Mp4).padStart(4)} Hz (voice track ${l.f0Voice} Hz)  "${l.text}"`));
  console.log(`  median: Claim Guy ${r.claimF0} Hz, Skeptic ${r.skepticF0} Hz, gap ${r.gapSt} st (lowest claim line vs highest skeptic line ${r.worstPairGapSt} st)`);
  const pkg = process.argv[4] || mp4.replace(/\.mp4$/, '.pkg.json'); const bb = fs.existsSync(pkg) ? beatF0(mp4, pkg) : null;
  if (bb) { console.log('  per beat:'); bb.forEach((b) => console.log(`    ${b.who.padEnd(8)} @${String(b.t).padStart(6)}s  f0 ${String(b.f0Mp4).padStart(4)} Hz  "${b.text}"`)); }
  process.exit(r.worstPairGapSt >= 4 ? 0 : 6);
}
