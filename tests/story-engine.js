// Offline checks for the Story engine (www/js/story.js) + story audio DSP (www/js/storyaudio.js): validate/repair rules on a
// saved Gemini plan and on a deliberately broken one. No network.  node tests/story-engine.js [plan.json]
'use strict';
const S = require('../www/js/story.js'); const A = require('../www/js/storyaudio.js'); const fs = require('fs'); const path = require('path');
const FIX = process.argv[2] || path.join(__dirname, 'fixtures', 'story-plan.json');
let pass = 0; let fail = 0; const ok = (name, c, v) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + name + (c || v === undefined ? '' : '  ' + JSON.stringify(v))); };
(async () => {
  const raw = JSON.parse(fs.readFileSync(FIX, 'utf8')); const input = raw.input || { storyline: 'She finds a note on her coffee cup that says "Don\'t turn around"', beats: 8, tone: 'warm' };
  // broken copy: new character mid-story, location jump without transition, accent in a quiet panel, spoiler caption, peak with dialogue
  const bad = JSON.parse(JSON.stringify(raw)); const n = bad.panels.length;
  bad.panels[3].dialogue = { speaker: 'Stranger', line: 'Hello there' }; bad.panels[2].location = 'park'; bad.panels[2].shot = 'close-up';
  bad.panels[1].accentAllowed = true; bad.panels[1].tension = 1; bad.panels[n - 2].dialogue = { speaker: (raw.characters[0] || {}).name || 'x', line: 'Should I turn?' };
  bad.panels[0].mood = 'peak'; bad.panels[0].tension = 5;
  const { plan, report } = await S.generate(input, async () => JSON.stringify(bad), { tries: 1 });
  const P = plan.panels; const tm = S.timing(plan); const ids = plan.characters.map((c) => c.id);
  ok('11 sections in order in the markdown', (S.toMarkdown(plan).match(/^## \d+\. /gm) || []).map((h) => Number(h.slice(3, -2))).join(',') === '1,2,3,4,5,6,7,8,9,10,11', S.toMarkdown(plan).match(/^## .*/gm));
  ok('no new characters mid-story (dialogue + stage only from the lock)', P.every((pn) => (!pn.dialogue || ids.includes(pn.dialogue.speaker)) && (!pn.reply || ids.includes(pn.reply.speaker)) && (pn.stage.chars || []).every((c) => ids.includes(c.id))));
  ok('location change only with a wide transition shot', P.every((pn, i) => !i || pn.location === P[i - 1].location || (pn.transitionShot && pn.shot === 'wide')));
  ok('accent only on tension >= 3 or the snap', P.every((pn, i) => !pn.accentAllowed || pn.tension >= 3 || i === P.length - 1));
  ok('panel 1 is uneasy normal', P[0].mood === 'uneasy normal' && P[0].tension <= 2, P[0].mood);
  ok('peak withhold is the second-to-last beat with NONE dialogue', P[n - 2].mood === 'peak' && !P[n - 2].dialogue && !P[n - 2].narration);
  const sil = P.filter((pn) => pn.silence); ok('one silence beat before the snap, no voice and no effect on it', sil.length === 1 && P.indexOf(sil[0]) < n - 1 && !sil[0].dialogue && !sil[0].narration && sil[0].effect === 'none');
  ok('snap is the last beat, cut faster than every shot before', P[n - 1].mood === 'snap' && tm.shots.slice(0, -1).every((s) => s.dur > tm.shots[n - 1].dur));
  ok('peak held an extra 0.5 s', Math.abs(tm.shots[n - 2].peakHold - 0.5) < 1e-6);
  ok('total 24-32 s incl. 1.5 s end card', tm.total >= 24 && tm.total <= 32 && tm.endCard.dur === 1.5, tm.total);
  const sp = (plan.spoilerWords || []).map((w) => w.toLowerCase());
  ok('no spoiler in captions / social caption', P.slice(0, -1).every((pn) => !sp.some((w) => (pn.caption || '').toLowerCase().includes(w))) && !sp.some((w) => (plan.social.caption || '').toLowerCase().includes(w)), sp);
  ok('every locked character has a distinct voice and speaks', new Set(plan.characters.map((c) => c.voice)).size === plan.characters.length && plan.characters.every((c) => S.voiceLines(plan).some((l) => l.who === c.id)));
  ok('narrator voice differs from the cast', !plan.narrator.use || !plan.characters.some((c) => c.voice === plan.narrator.voice));
  ok('4+ suspense devices', (plan.suspensePlan.devices || []).length >= 4);
  ok('captions < 12 words, dialogue <= 10 words', P.every((pn) => (pn.caption || '').split(/\s+/).filter(Boolean).length < 12 && (!pn.dialogue || pn.dialogue.line.split(/\s+/).length <= 10)));
  ok('repairs were reported', report.fixed.length > 0 && Array.isArray(plan.report.fixed));
  // timing stretches shots to fit voiced lines
  const tm2 = S.timing(plan, P.map((_, i) => (i === 1 ? 3.6 : 0))); ok('shot stretched to fit a 3.6 s voiced line', tm2.shots[1].dur >= 3.6 + S.LINE_LEAD + S.LINE_TAIL - 1e-6 || tm2.total >= 31.9, tm2.shots[1].dur);
  // audio DSP
  const R = A.RATE; const tone = (f0, sec, vib) => { const x = new Float32Array(R * sec); let ph = 0; for (let i = 0; i < x.length; i++) { const f = f0 * Math.pow(2, (vib || 0) * Math.sin(2 * Math.PI * 1.5 * i / R) / 12); ph += 2 * Math.PI * f / R; x[i] = 0.3 * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph)) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * i / R) ** 2); } return x; };
  const f1 = A.features(tone(120, 1.2, 2)); const f2 = A.features(tone(220, 1.2, 2));
  ok('pitch features measure f0 (120 / 220 Hz)', Math.abs(f1.f0 - 120) < 6 && Math.abs(f2.f0 - 220) < 10, [f1.f0, f2.f0]);
  const burst = Float32Array.from([...tone(150, 1, 2), ...new Float32Array(R * 0.3), ...new Float32Array(R * 0.14).map(() => 0.6 + 0.3 * Math.random()), ...new Float32Array(R * 0.2)]); const cl = A.cleanTake(burst);
  ok('cleanTake removes an end-of-take noise burst', cl.glitches.length >= 1 && A.scan(cl.x).bursts.length === 0, cl.glitches);
  const gap = new Float32Array(R * 0.5); const take = Float32Array.from([...tone(150, 0.8, 2), ...gap, ...tone(150, 1.4, 2), ...gap, ...tone(150, 0.6, 2)]);
  const segs = A.splitTake(take, 3, [2, 4, 1]); ok('splitTake finds 3 lines at the pauses', segs && segs.length === 3 && Math.abs(segs[1].length / R - 1.47) < 0.15, segs && segs.map((s) => (s.length / R).toFixed(2)));
  const q = A.castQa([{ who: 'a', voice: 'X', panel: 0, x: tone(120, 1.2, 2.5), delivery: 'light' }, { who: 'b', voice: 'Y', panel: 1, x: tone(125, 1.2, 2.5), delivery: 'light' }], ['gemini-3.8-flash-lite-tts']);
  ok('cast QA refuses near-identical voices and a flat model', !q.checks[0].ok && !q.checks[1].ok);
  console.log(`story-engine: ${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
