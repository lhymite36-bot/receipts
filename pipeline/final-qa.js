// Final check of a rendered Short before it can ship: node pipeline/final-qa.js <short.mp4>   (reads <short.mp4>.render-info.json)
//  - audio: no noise bursts / clicks / clipping, and no pure-tone beep outside the planned sound-effect windows (pipeline/audio-qa.js)
//  - captions: every script word in exactly one caption chunk, each word on screen >= 0.25 s, timing from measured word onsets
//  - mix: music bed >= 15 dB under the voice while it talks
// Exit 6 on failure; prints a JSON report.
'use strict';
const fs = require('fs'); const Q = require('./audio-qa');
const file = process.argv[2]; const info = JSON.parse(fs.readFileSync(file + '.render-info.json', 'utf8'));
const allow = (info.cues || []).map((c) => [c.t, c.t + 1.6]); // sound effects are at most ~1.4 s (trombone is longer but not tonal)
const aq = Q.scan(Q.decode(file), Q.RATE, { allow });
const cap = info.captions || {}; const lv = info.levels || {};
const checks = [
  { name: 'no noise bursts, clicks, clipping or stray beeps in the final audio', ok: aq.ok, val: aq.fails.length ? aq.fails : { sfxTones: aq.events.filter((e) => e.allowed).length } },
  { name: 'captions: every word in exactly one chunk, each shown >= 0.25 s', ok: cap.notInExactlyOneChunk === 0 && (cap.shortWords || []).length === 0, val: { words: cap.words, notInExactlyOneChunk: cap.notInExactlyOneChunk, shortWords: cap.shortWords } },
  { name: 'captions timed from measured word onsets (ASR), not estimated', ok: cap.measuredTiming === true, val: cap.measuredTiming },
  { name: 'music bed >= 15 dB under the voice while it talks', ok: lv.musicBelowVoiceDb == null || lv.musicBelowVoiceDb >= 15, val: lv },
];
const pass = checks.every((c) => c.ok);
fs.writeFileSync(file + '.final-qa.json', JSON.stringify({ pass, checks, audio: aq }, null, 1));
checks.forEach((c) => console.log((c.ok ? '  PASS ' : '  FAIL ') + c.name + ' ' + JSON.stringify(c.val).slice(0, 400)));
console.log(pass ? 'FINAL_QA_PASS' : 'FINAL_QA_FAIL'); process.exit(pass ? 0 : 6);
