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

  // ---------------- pose library (no T-pose; ACTION / BOARD NOTES -> pose; props on the hand) ----------------
  const H = require('./story-harness'); const V = H.load();
  const two = { characters: [{ id: 'maya', name: 'Maya' }, { id: 'leo', name: 'Leo' }] };
  const pose = (action, boardNotes, sc, extra) => S.poseFor(two, Object.assign({ action, boardNotes, stage: Object.assign({ chars: [Object.assign({ id: 'maya', pose: 'stand', facing: 'front' }, sc)], focus: 'maya', clue: { object: 'none' } }, extra || {}) }), Object.assign({ id: 'maya', pose: 'stand', facing: 'front' }, sc));
  const cases = [
    ['Maya lifts her ceramic coffee mug from the counter.', 'Maya smiling, holding cup. Leo in background far right.', {}, 'cup', 'cup'],
    ['Maya unfolds the note, her smile dropping.', '', {}, 'reading', 'note'],
    ['Maya freezes completely, breath held.', 'Knuckles white on the cup. Absolute silence.', { pose: 'freeze' }, 'grip-cup', 'cup'],
    ['A long shadow creeps across the floor toward Maya.', "Maya's back is tense.", { facing: 'back', pose: 'freeze' }, 'back', null],
    ['Maya whips around to face whatever is there.', '', { pose: 'turn' }, 'startled', null],
    ['Maya waves at Leo across the room.', '', {}, 'wave', null], ['Maya shrugs.', '', {}, 'shrug', null], ['Maya stands with hands on her hips.', '', {}, 'hips', null],
    ['Maya points at the door.', '', {}, 'point', null], ['Maya presses a hand to her chest.', '', {}, 'hand-chest', null], ['Maya checks her phone.', '', {}, 'phone', 'phone'],
    ['Camera pushes in on the note.', 'Focus entirely on the cup lid.', { pose: 'freeze' }, 'tense', null], ['Maya waits.', '', { pose: 'stand' }, 'idle', null], ['Leo grins.', '', { pose: 'whatever' }, 'idle', null],
  ];
  const got = cases.map(([a, b, sc, want, holds]) => { const r = pose(a, b, sc); return { a, want, holds, got: r.arms, gotHolds: r.holds }; });
  ok('poses: ACTION / BOARD NOTES map to the pose library (cup, reading, grip, from behind, startled, wave, shrug, hips, point, hand to chest, phone; default idle)', got.every((g) => g.got === g.want && (g.holds === null ? !g.gotHolds : g.gotHolds === g.holds)), got.filter((g) => g.got !== g.want || (g.holds || null) !== (g.gotHolds || null)));
  ok('poses: a sentence about Leo does not pose Maya', pose('Leo waves hello.', '', {}).arms === 'idle');
  ok('poses: every figure of a validated plan gets a library pose', P.every((pn) => (pn.stage.chars || []).every((c) => S.ARM_POSES.includes(c.arms))));
  const PA = V.storyDraw.POSE_ARMS; const isT = (q) => { const dx = Math.abs(q[1][0] - 16); const dy = Math.abs(q[1][1] - 18); return dx > 70 && dy < 0.45 * dx; };
  ok('poses: the library has every requested pose and none is a T-pose (both arms straight out)', ['idle', 'hips', 'cup', 'reading', 'point', 'shrug', 'startled', 'hand-chest', 'wave', 'back'].every((k) => PA[k]) && S.ARM_POSES.every((k) => PA[k] && !(isT(PA[k].f) && isT(PA[k].a || PA[k].f))), Object.keys(PA));
  ok('poses: default is relaxed arms down (hands below the hips, close to the body)', PA.idle.f[1][1] > 110 && Math.abs(PA.idle.f[1][0]) < 50);
  // draw the fixture plan with a sample-1 style staging (freeze / hold / cup clue) at many times: no T-pose, held props on the hand
  const stage = JSON.parse(JSON.stringify(plan)); const lead = stage.characters[0];
  stage.panels.forEach((pn, i) => { const c = (pn.stage.chars || []).find((q) => q.id === lead.id); if (!c) return; if (i % 3 === 0) { c.pose = 'freeze'; pn.boardNotes = `${lead.name} grips the cup with both hands.`; pn.stage.clue = { object: 'cup', state: 'partial', x: 'center', label: '' }; } else if (i % 3 === 1) { c.pose = 'hold'; pn.action = `${lead.name} lifts her coffee cup.`; } else { c.pose = 'freeze'; } });
  S.mapPoses(stage); const tm3 = S.timing(stage); const r3 = new V.storyDraw.StoryRenderer(H.canvas()).setup(stage, { timing: tm3 });
  let pIss = []; let heldN = 0; let floating = 0; const armsSeen = new Set();
  for (let f = 0; f < Math.ceil(tm3.endCard.start * 24); f += 3) { const L = r3.draw(f / 24); pIss = pIss.concat(V.storyDraw.poseCheck(L)); (L.figures || []).forEach((g) => { armsSeen.add(g.arms); if (g.held) heldN++; }); if (L.clue && !['hand', 'counter', 'table', 'floor'].includes(L.clue.on)) floating++; }
  ok('poses: no T-pose and every held prop on its hand anchor, every 3rd frame of the whole story', !pIss.length && heldN > 0, { issues: pIss.slice(0, 3), heldN, arms: [...armsSeen] });
  ok('props: a clue the character holds is drawn at the hand; others rest on a counter / table / floor', !floating);
  // ---------------- audio: de-esser, music bed vs its own reference ----------------
  const QA = require('../pipeline/audio-qa.js');
  const hiss = new Float32Array(R * 1.2); for (let i = 0; i < hiss.length; i++) { const tt = i / R; const sib = tt > 0.5 && tt < 0.62; hiss[i] = 0.25 * Math.sin(2 * Math.PI * 180 * tt) * (sib ? 0.2 : 1) + (sib ? (i % 2 ? 0.8 : -0.8) * (0.7 + 0.3 * Math.random()) : 0); }
  const harshBefore = QA.scan(hiss, R).events.filter((e) => e.kind === 'harsh').length; const de = A.deEss(hiss, R); const harshAfter = QA.scan(de.x, R).events.filter((e) => e.kind === 'harsh').length;
  ok('de-esser removes a harsh "s" (audio-qa harsh event) without touching the vowel', harshBefore > 0 && harshAfter === 0 && Math.abs(de.x[Math.round(0.2 * R)] - hiss[Math.round(0.2 * R)]) < 1e-6, { harshBefore, harshAfter });
  const AFX = V.audiofx; const bed = (style) => { const m = AFX.music(style, R); const n = R * 12; const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.2 * (m.L[i % m.loopLen] + m.R[i % m.loopLen]) * 0.5; return x; };
  for (const style of ['storybook', 'chill']) {
    const x = bed(style); const MA = QA.musicAware(AFX.musicPitches(style), R); const raw0 = QA.scan(x, R); const ms = MA.musicStem(QA.scan(x, R));
    const beep = Float32Array.from(x); for (let i = Math.round(5 * R); i < Math.round(5.4 * R); i++) beep[i] += 0.3 * Math.sin(2 * Math.PI * 1109 * i / R); // C#6: not a note of either bed
    const msBeep = MA.musicStem(QA.scan(beep, R)); const mix = MA.finalMix(QA.scan(beep, R), ms.tones);
    ok(`music (${style}): the bed's sustained notes no longer fail (they are its own notes), an off-bed beep still does`, ms.ok && !msBeep.ok && !mix.ok && mix.fails.every((e) => Math.abs(e.t - 5) < 0.5), { plainScanFails: raw0.fails.length, bedTones: ms.tones.length, offBed: msBeep.offBed.map((e) => e.hz), mixFails: mix.fails.map((e) => [e.kind, e.t, e.hz]) });
  }
  // ---------------- audio polish (story-sample-1 held back: clipped "What", effect over a line, 656 Hz "tone", pitch-only distinctness) ----------------
  { // splitTake keeps a soft onset (a quiet "Wh" 60 ms before the loud vowel) and never cuts into it
    const soft = (sec) => { const x = new Float32Array(Math.round(R * sec)); for (let i = 0; i < x.length; i++) x[i] = 0.004 * Math.sin(2 * Math.PI * 2500 * i / R) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 37 * i / R)); return x; };
    const take2 = Float32Array.from([...tone(220, 0.8, 2), ...new Float32Array(R * 0.6), ...soft(0.06), ...tone(220, 0.6, 2), ...new Float32Array(R * 0.3)]);
    const sg = A.splitTake(take2, 2, [2, 4], R); const e1 = sg && A.edges(sg[1], R);
    ok('splitTake keeps a soft word onset before the loud vowel (lead >= 30 ms of quiet, starts below -30 dB, includes the 60 ms onset)', sg && e1.leadMs >= 30 && e1.headDb <= -30 && sg[1].length / R >= 0.6 + 0.06 + 0.03, sg && { e1, len: sg[1].length / R });
    const hdr = Float32Array.from([...new Float32Array(22).map((_, i) => (i % 2 ? -0.7 : 0.6)), ...new Float32Array(R * 0.2), ...tone(200, 0.8, 2), ...new Float32Array(R * 0.2)]); const ct2 = A.cleanTake(hdr, R);
    ok('cleanTake removes an isolated tick at the start of a take (WAV header bytes read as audio)', ct2.glitches.some((g) => g.kind === 'tick' && g.t === 0) && Math.max(...ct2.x.subarray(0, 100).map(Math.abs)) < 1e-6, ct2.glitches);
  }
  { // a voice harmonic is voice; a beep (in the take or from an effect) still fails
    const n = R * 2; const v = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / R; const f0 = 320 * Math.pow(2, 0.6 * Math.sin(2 * Math.PI * 3 * t) / 12); ph += 2 * Math.PI * f0 / R; const on = t > 0.4 && t < 1.6 ? 1 : 0; v[i] = on * (0.05 * Math.sin(ph) + 0.30 * Math.sin(2 * ph) + 0.04 * Math.sin(3 * ph) + 0.02 * Math.sin(4 * ph)); }
    const win = [[0.4, 1.6]]; const run = (voice, mixed) => QA.voiceAware(voice, win, R).classify(QA.scan(mixed, R, {}), mixed);
    const plain = run(v, v); const beepAdd = (x, hz) => x.map((s, i) => (i > 0.8 * R && i < 1.2 * R ? s + 0.35 * Math.sin(2 * Math.PI * hz * i / R) : s));
    const inTake = beepAdd(v, 640); const fromFx = beepAdd(v, 640);
    const rTake = run(inTake, inTake); const rFx = run(v, fromFx);
    ok('beep check: a strong 2nd harmonic that moves with the voice\'s pitch is voice, not a beep', plain.events.some((e) => e.kind === 'tone') && plain.ok, plain.events.filter((e) => e.kind === 'tone').map((e) => [e.hz, e.voiceCheck]));
    ok('beep check: a fixed 640 Hz beep under the same voice still fails, inside the take or from an effect', !rTake.ok && !rFx.ok, { take: rTake.fails.map((e) => [e.hz, e.voiceCheck]), fx: rFx.fails.map((e) => [e.hz, e.voiceCheck]) });
  }
  { // distinctness: same pitch, same brightness -> only a different speaker by timbre (speaker-embedding cosine) passes
    const a = { who: 'maya', voice: 'Erinome', panel: 0, x: tone(310, 1.2, 2.5), delivery: 'light' }; const b = { who: 'leo', voice: 'Enceladus', panel: 1, x: tone(315, 1.2, 2.5), delivery: 'light' };
    const q1 = A.castQa([a, b], ['gemini-3.8-flash-tts'], { strict: true, edges: false }); const q2 = A.castQa([a, b], ['gemini-3.8-flash-tts'], { strict: true, edges: false, speaker: { pairs: [{ a: 'maya', b: 'leo', cos: 0.1 }] } }); const q3 = A.castQa([a, b], ['gemini-3.8-flash-tts'], { strict: true, edges: false, speaker: { pairs: [{ a: 'maya', b: 'leo', cos: 0.6 }] } });
    ok('voice distinctness: same pitch passes only as a different speaker by timbre (cos 0.10 passes, cos 0.60 or no embedding fails)', !q1.checks[0].ok && q2.checks[0].ok && q2.pairs[0].by === 'timbre' && !q3.checks[0].ok, [q1.pairs[0], q2.pairs[0], q3.pairs[0]]);
  }
  { // mixer: an effect cued on a spoken line moves into the gap after it; nothing of it sounds under the line
    const VA = V.storyAudio; const plan2 = { panels: [{ effect: 'gulp' }, { effect: 'none' }], shots: [] }; const tm4 = { shots: [{ start: 0, dur: 3, silence: false, snap: false }, { start: 3, dur: 3, silence: false, snap: false }], total: 7.5, body: 6 };
    const line = { panel: 0, who: 'maya', start: 0.35, x: tone(300, 1.2, 2), dur: 1.2 }; const m4 = await VA.mix(plan2, [line], tm4, { music: 'none', stems: true });
    const c4 = m4.cues[0]; let fxIn = 0; for (let i = Math.round((0.35 - 0.1) * 48000); i < Math.round(1.55 * 48000); i++) fxIn = Math.max(fxIn, Math.abs(m4.stems.sfx[i]));
    ok('mixer: an effect cued on a spoken line is moved off it (into the gap after the line) and nothing of it plays under the line', c4 && c4.from === 0.5 && c4.t >= 1.55 && fxIn < 1e-4, { cue: c4, fxIn });
  }
  console.log(`story-engine: ${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
