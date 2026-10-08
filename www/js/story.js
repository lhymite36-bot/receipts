/* Receipts "Story" mode engine: storyline -> suspense-first stick-figure story plan (11 sections, spec order), validated and
   repaired against the spec's constraints, plus shot timing, voice casting, still-image prompts and Markdown/JSON export.
   No DOM: runs in the app (window.VTS.story) and in Node (module.exports) for pipeline/story-render.js. */
(function (root) {
  'use strict';
  // ---------------- vocabulary from the spec ----------------
  const LOCATIONS = ['bedroom', 'kitchen', 'bathroom mirror', 'living room', 'coffee shop', 'classroom', 'office', 'bus stop', 'park bench', 'grocery aisle', 'gym', 'restaurant booth', 'rooftop', 'hallway', 'car', 'library', 'subway', 'stairwell', 'elevator', 'party kitchen', 'waiting room', 'beach'];
  const FEATURES = ['closing door', 'face-down phone', 'unseen corner', 'timer', 'reflection', 'empty chair', 'arriving bus', 'hand entering frame'];
  const DEVICES = ['withheld fact', 'reaction before cause', 'wide then medium then close-up', 'time pressure', 'false calm', 'off-panel cue', 'interrupted action', 'silence beat', 'match cut', 'cliffhanger hold'];
  const SHOTS = ['wide', 'medium', 'close-up', 'insert', 'over-shoulder'];
  const MOVES = ['hold', 'slow push-in', 'slight pan', 'snap cut'];
  const EFFECTS = ['tick', 'ding', 'hush', 'creak', 'gulp', 'none'];
  const SPINE = ['hook', 'pressure', 'tighten', 'withhold', 'snap'];
  const AUDIO_CUES = ['room tone', 'cup', 'door', 'ding', 'hard silence'];
  const TRANSITIONS = ['cut', 'match cut', 'dip to accent'];
  const MOODS = ['uneasy normal', 'false calm', 'rising', 'tense', 'peak', 'snap'];
  const PLATFORMS = { reel: '9:16 Reel', tiktok: 'TikTok', carousel: 'carousel', x: 'X comic' };
  const TONES = ['warm', 'cozy mystery', 'sweet', 'funny', 'heartfelt', 'edgy'];
  // drawable vocabulary for the renderer (the engine picks from these; anything else is mapped to the closest)
  const HAIR = ['none', 'short', 'long', 'bun', 'ponytail', 'curly', 'spiky', 'bob', 'cap', 'beanie'];
  const ITEMS = ['scarf', 'glasses', 'cap', 'bag', 'headphones', 'bow', 'tie', 'watch', 'backpack', 'apron', 'necklace', 'flower', 'badge', 'umbrella', 'book', 'none'];
  const POSES = ['stand', 'sit', 'walk', 'reach', 'turn', 'hold', 'point', 'freeze', 'cheer', 'lean', 'hide'];
  // Arm pose library the renderer draws (www/js/storydraw.js POSE_ARMS). Every figure gets one, mapped from the panel's ACTION and
  // BOARD NOTES (poseFor). The default is 'idle' (arms relaxed down); there is no arms-straight-out (T) pose anywhere.
  const ARM_POSES = ['idle', 'tense', 'hips', 'cup', 'grip-cup', 'reading', 'phone', 'point', 'shrug', 'startled', 'hand-chest', 'wave', 'cheer', 'reach', 'hide', 'sit', 'back'];
  const HOLDABLE = { cup: 'cup', mug: 'cup', coffee: 'cup', latte: 'cup', tea: 'cup', note: 'note', paper: 'note', message: 'note', card: 'note', letter: 'letter', envelope: 'letter', phone: 'phone', book: 'book', photo: 'photo', picture: 'photo', ticket: 'ticket' };
  const EYES = ['neutral', 'wide', 'happy', 'worried', 'side', 'closed', 'sparkle'];
  const SYMBOLS = ['none', 'sweat', 'heart', 'question', 'sparkle', 'exclaim'];
  const CLUES = ['none', 'note', 'cup', 'phone', 'gift', 'letter', 'key', 'book', 'cake', 'flowers', 'photo', 'door', 'sign', 'balloon', 'ticket', 'ring', 'bag', 'umbrella', 'plant', 'kitten', 'puppy', 'banner', 'box', 'lamp', 'clock'];
  const MOTIONS = ['none', 'head-turn', 'reach', 'door', 'phone-light', 'step', 'lean', 'look-up', 'jump', 'hand-enter', 'blink'];
  const DELIVERY = { light: 'light, warm and easy, a tiny hint of curiosity', curious: 'curious and a little puzzled, unhurried', nervous: 'a little nervous, slightly hesitant, quick breaths', whisper: 'whispered, hushed and tense, slow, close to the mic', tense: 'tense and quiet, holding back, careful', bright: 'quick, bright and delighted, a happy rush of relief', warm: 'warm and tender, smiling' };
  // The 30 Gemini prebuilt voices with what casting needs: gender, pitch band, energy.
  const VOICES = {
    Zephyr: ['f', 'high', 'high', 'bright'], Kore: ['f', 'mid', 'mid', 'firm'], Leda: ['f', 'high', 'high', 'youthful'], Aoede: ['f', 'mid', 'mid', 'breezy'], Callirrhoe: ['f', 'mid', 'low', 'easy-going'],
    Autonoe: ['f', 'high', 'high', 'bright'], Despina: ['f', 'mid', 'low', 'smooth'], Erinome: ['f', 'mid', 'mid', 'clear'], Laomedeia: ['f', 'high', 'high', 'upbeat'], Achernar: ['f', 'high', 'low', 'soft'],
    Gacrux: ['f', 'low', 'low', 'mature'], Pulcherrima: ['f', 'mid', 'high', 'forward'], Vindemiatrix: ['f', 'mid', 'low', 'gentle'], Sulafat: ['f', 'mid', 'low', 'warm'],
    Puck: ['m', 'high', 'high', 'upbeat'], Charon: ['m', 'low', 'low', 'informative'], Fenrir: ['m', 'mid', 'high', 'excitable'], Orus: ['m', 'low', 'mid', 'firm'], Enceladus: ['m', 'low', 'low', 'breathy'],
    Iapetus: ['m', 'mid', 'mid', 'clear'], Umbriel: ['m', 'mid', 'low', 'easy-going'], Algieba: ['m', 'low', 'low', 'smooth'], Algenib: ['m', 'low', 'low', 'gravelly'], Rasalgethi: ['m', 'mid', 'mid', 'informative'],
    Alnilam: ['m', 'low', 'mid', 'firm'], Schedar: ['m', 'mid', 'low', 'even'], Achird: ['m', 'mid', 'mid', 'friendly'], Zubenelgenubi: ['m', 'mid', 'mid', 'casual'], Sadachbia: ['m', 'mid', 'high', 'lively'], Sadaltager: ['m', 'mid', 'mid', 'knowledgeable'],
  };
  const NICE_PALETTES = [
    { dominant: ['peach', '#FFB4A2'], support: ['teal', '#2A9D8F'], accent: ['sunflower', '#FFD23F'] },
    { dominant: ['sky', '#8ECAE6'], support: ['coral', '#F28482'], accent: ['lemon', '#FFE066'] },
    { dominant: ['mint', '#9EE6CF'], support: ['plum', '#7B5EA7'], accent: ['tangerine', '#FF8C42'] },
    { dominant: ['lavender', '#C3B1E1'], support: ['sea green', '#3BB273'], accent: ['hot pink', '#FF4D8D'] },
  ];

  // ---------------- the prompt (the user's spec, verbatim rules + JSON contract) ----------------
  const SPEC = `You are the story engine, storyboard lead, and video director for a social-media cartoon app. A user gives only a storyline. You turn it into a pretty, colorful stick-figure story whose main job is suspense: the viewer should need the next shot before they have it. Then you board it like a professional and plan the actual video.

STYLE LOCK
- Stick figures only: circle heads, dot or oval eyes, simple line bodies, tiny mitt hands, bold even outlines.
- Faces stay simple. Prettiness comes from color, staging, and shape, not realistic features.
- Flat, friendly color. No muddy browns, no gray-only scenes, no grim realism.
- Color script for every story: 1 dominant, 1 support, 1 accent. The accent appears only when tension spikes or the snap lands.
- Backgrounds are designed and readable. Lighting is color, not heavy shade.
- Emotion comes from pose, eye shape, and small symbols: sweat, heart, question, sparkle, exclamation.
- Nice on purpose. Suspense is delay, curiosity, and a withheld fact. Not horror, not graphic harm.

If an input is missing, choose and say so. Default: warm, pretty, suspense-first, 8 beats, 9:16 Reel, 24-32 seconds.

1. ASSUMPTIONS: tone, length, platform, and the smallest stake you invented if the storyline was vague. Name the question the video refuses to answer until the snap.
2. COLOR SCRIPT: dominant, support, accent. The accent is a suspense tool: it marks the clue, the almost, or the reveal. Quiet panels stay in dominant and support only.
3. CHARACTER LOCK (2-4): name, role, silhouette; hair or none; clothing colors from the palette; one signature item; personality in one line; stress tell (tap, glance, grip, phone check). Lock looks for every shot. The tell gets bigger as suspense rises.
4. LOCATION LOCK: real places only: ${LOCATIONS.join(', ')}. For each place: name, 3 visual anchors, time of day, palette note, suspense feature: ${FEATURES.join(', ')}.
5. SUSPENSE PLAN (required before any panel): the question being withheld; what the audience knows that a character does not, or the reverse; four or more devices and the beat each one lands on. Devices: ${DEVICES.join(', ')}. Rule: panel 1 is uneasy normal. Middle beats escalate one notch each. The beat before the last is the peak withhold. The last beat is the snap, or a colder withhold if this is part 1.
6. STORY SPINE: hook, pressure, tighten, withhold, snap. Dialogue is short. The strongest suspense beat has no dialogue.
7. PROFESSIONAL STORYBOARD: one action per panel. Readable with the sound off. Consistent screen direction. Eyelines point at the clue or at the empty place where the clue should be. Repeat a composition to make it feel wrong. Change it only when the story turns. Leave breathing room. Pretty means balanced color and a frame that can post alone. Per panel: location; SHOT (wide / medium / close-up / insert / over-shoulder); FRAMING (placement, crop, eyeline, what is hidden by the crop); COLOR (palette use; say if the accent is allowed in this frame); SUSPENSE BEAT (device, or release); ACTION (one physical beat); DIALOGUE (Name: "line" or NONE); EFFECT (tick, ding, hush, creak, gulp, or none); CAPTION (under 12 words, or none; never spoil the snap); DURATION (how long to hold); CAMERA MOVE (hold / slow push-in / slight pan / snap cut); BOARD NOTES (pose, tell, props, anchors, symbol, continuity); HOLD (the fact the viewer still does not have). Then: thumbnail row, one line per panel; rhythm note (which beats are false calm, which is the silence, which is the snap); pause points (panel numbers where a Reel must wait).
9. VIDEO GENERATION: each panel is a shot. Total 24-32 seconds. 9:16, 24 fps, small motion so stick figures do not warp. Suspense is edited, not just drawn. Per shot: START FRAME (still from this panel); END FRAME (still from the next panel, or a held pose on the last shot); DURATION (longer on the withhold, shorter on the snap); MOVE (slow push-in on clues, hold on silence, cut on the snap); ACTION IN MOTION (one thing only: head turn, reach, door, phone light); DO NOT MOVE (face design, clothing colors, signature items, anchors); SUSPENSE TIMING (the moment the withheld fact almost appears); AUDIO CUE (room tone, cup, door, ding, or hard silence); ON-SCREEN TEXT (lower third, never over faces, never a spoiler); TRANSITION (cut, match cut, or a short dip to the accent color only at the snap). Assembly rules: drop the music on the silence beat; hold the peak withhold an extra half second; cut the snap faster than the shots before it; end card 1.5 seconds: series title on the accent color; export 1080x1920, H.264, captions burned in, safe margins.
10. SOCIAL PACKAGING: series title, under 6 words; panel 1 hook text, max 8 words; cliffhanger line if this is part 1; end card line; 5 hashtags; post caption, under 2 sentences, no spoiler; one-sentence art direction.

CONSTRAINTS
- Do not add characters mid-story.
- Do not change location without a transition shot.
- Do not answer the withheld question early.
- Keep motion small.
- Stay nice and safe for general social audiences unless the user asks for an edgier tone.`;

  const VOICE_LIST = Object.entries(VOICES).map(([n, v]) => `${n} (${v[0] === 'f' ? 'female' : 'male'}, ${v[1]} pitch, ${v[3]}, ${v[2]} energy)`).join('; ');
  const SHAPE = `Return ONE JSON object (no markdown) with exactly these keys, in this order, and every panel field filled:
{
 "assumptions": {"tone": "", "length": 8, "platform": "9:16 Reel", "inventedStake": "", "chosen": ["which inputs were missing and what you chose"], "withheldQuestion": ""},
 "colorScript": {"dominant": {"name": "", "hex": "#RRGGBB"}, "support": {"name": "", "hex": "#RRGGBB"}, "accent": {"name": "", "hex": "#RRGGBB"}, "note": "how the accent works as a suspense tool"},
 "characters": [{"id": "short-lowercase-id", "name": "", "role": "", "silhouette": "", "hair": "one of ${HAIR.join('|')}", "hairColor": "#RRGGBB", "top": "#RRGGBB (from the palette)", "bottom": "#RRGGBB (from the palette)", "clothing": "words", "signatureItem": "words", "item": "one of ${ITEMS.join('|')}", "personality": "one line", "stressTell": "tap|glance|grip|phone check", "voiceHint": {"gender": "female|male", "age": "child|teen|young adult|adult|older", "energy": "calm|medium|high"}, "voice": "one voice name from the voice list", "voiceWhy": "why this voice fits role, personality, age and energy"}],
 "narrator": {"use": true, "voice": "voice name, different from every character", "why": ""},
 "locations": [{"id": "one of the real places, lowercase", "name": "", "anchors": ["", "", ""], "timeOfDay": "morning|day|golden hour|evening|night", "palette": "", "suspenseFeature": "one of the suspense features"}],
 "suspensePlan": {"withheldQuestion": "", "knowledgeGap": "what the audience knows that a character does not, or the reverse", "devices": [{"device": "one of the devices", "beat": 2, "how": ""}]},
 "spine": {"hook": "", "pressure": "", "tighten": "", "withhold": "", "snap": ""},
 "spoilerWords": ["3-8 lowercase words that name the ANSWER to the withheld question (who/what it is); never words from the storyline, the setting or the setup"],
 "panels": [{"n": 1, "location": "location id", "shot": "wide|medium|close-up|insert|over-shoulder", "framing": "", "color": "palette use + whether the accent is allowed", "accentAllowed": false, "suspenseBeat": "device name, or release", "mood": "uneasy normal|false calm|rising|tense|peak|snap", "tension": 1, "spine": "hook|pressure|tighten|withhold|snap", "action": "one physical beat", "dialogue": {"speaker": "character id", "line": "max 8 words"} or null, "reply": null (snap panel only: optional {"speaker": "another character id", "line": "max 6 words"}), "delivery": "light|curious|nervous|whisper|tense|bright|warm", "narration": "max 10 words for the narrator, or empty", "effect": "tick|ding|hush|creak|gulp|none", "caption": "under 12 words, or empty; when the panel has narration the caption IS the narration, word for word; when a character speaks and there is no narration, leave it empty (the spoken line is burned in as the caption)", "duration": 3.0, "cameraMove": "hold|slow push-in|slight pan|snap cut", "boardNotes": "pose (arms: relaxed down, hands on hips, holding the cup, reading, pointing, shrug, startled, hand to chest, waving, seen from behind), tell, props, anchors, symbol, continuity", "hold": "the fact the viewer still does not have", "transitionShot": false,
   "stage": {"chars": [{"id": "character id", "x": "left|center|right", "facing": "left|right|front|back", "far": false, "pose": "${POSES.join('|')}", "eyes": "${EYES.join('|')}", "symbol": "${SYMBOLS.join('|')}"}], "focus": "character id or clue", "clue": {"object": "${CLUES.join('|')}", "label": "max 3 words written on it, or empty", "state": "hidden|partial|revealed", "x": "left|center|right"}, "anchorProps": ["which location anchors are visible"], "motion": "${MOTIONS.join('|')}"}}],
 "thumbnails": ["one line per panel"],
 "rhythm": {"falseCalm": [1], "silence": 6, "snap": 8, "note": ""},
 "pausePoints": [4],
 "shots": [{"n": 1, "panel": 1, "startFrame": "", "endFrame": "", "duration": 3.0, "move": "", "actionInMotion": "one thing only", "doNotMove": "face design, clothing colors, signature items, anchors", "suspenseTiming": "", "audioCue": "room tone|cup|door|ding|hard silence", "onScreenText": "lower third text or none", "transition": "cut|match cut|dip to accent"}],
 "assembly": ["the five assembly rules, applied to this story"],
 "social": {"seriesTitle": "under 6 words", "hookText": "max 8 words", "cliffhanger": "", "endCardLine": "", "hashtags": ["#a", "#b", "#c", "#d", "#e"], "caption": "under 2 sentences, no spoiler", "artDirection": "one sentence"}
}
Voice list (pick a distinct voice per character that fits gender, age, energy and personality, and keep it locked; the narrator is warm and different from every character): ${VOICE_LIST}.
Rules for the JSON: panels.length equals the requested beats; characters appear only from the character lock (no one new mid-story, no extra people in "stage"); every locked character speaks at least one short line somewhere (each has a locked voice; the strongest suspense beat stays silent; the snap panel may carry an optional "reply": {"speaker","line"} by a second character); every locked character is already on screen in panel 1 or 2 (small, far, facing away or half hidden is fine: set "far": true or "facing": "back"), so the snap never introduces a new person; "tension" is 1-5 and rises one notch per middle beat (a false-calm beat may dip); the second-to-last panel is mood "peak" (the peak withhold), has dialogue null and narration empty, and is the silence beat (rhythm.silence); the last panel is mood "snap" with spine "snap", and its duration is shorter than every earlier panel; accentAllowed is true only on tension spikes (tension >= 3) and the snap; panel 1 is mood "uneasy normal"; a panel whose location differs from the previous one must have transitionShot true and shot "wide"; dialogue lines max 8 words, at most one line per panel; captions never contain a spoiler word before the snap; a voiced panel's caption is exactly its spoken text (caption = narration, or empty when only a character speaks); narration only on hook/caption-style panels, never on the silence beat; total duration of all panels 22.5-30.5 seconds (a 1.5 s end card is added for 24-32 s); the delivery of the withhold is "whisper" or "tense" and the snap is "bright".`;

  function buildPrompt(input) {
    const beats = [6, 8, 12].includes(Number(input.beats)) ? Number(input.beats) : 8;
    const missing = [];
    if (!input.tone) missing.push('tone (default: warm, pretty, suspense-first)');
    if (!input.beats) missing.push('length (default: 8 beats)');
    if (!input.platform) missing.push('platform (default: 9:16 Reel)');
    const user = `STORYLINE: ${String(input.storyline || '').trim()}
TONE: ${input.tone || 'not given (choose: warm, pretty, suspense-first)'}
LENGTH: ${beats} beats${input.beats ? '' : ' (default)'}
PLATFORM: ${PLATFORMS[input.platform] || input.platform || '9:16 Reel (default)'}
PART: ${input.part1 ? 'part 1 of a series (the last beat may be a colder withhold + cliffhanger line)' : 'standalone (the last beat is the snap)'}
${missing.length ? 'Missing inputs you must choose and say so in assumptions.chosen: ' + missing.join('; ') + '.' : ''}
${input.feedback ? '\nYOUR PREVIOUS ANSWER BROKE THESE RULES - fix every one and return the full corrected JSON:\n- ' + input.feedback.join('\n- ') + (input.previous ? '\nPrevious JSON:\n' + JSON.stringify(input.previous).slice(0, 24000) : '') : ''}`;
    return { system: SPEC + '\n\n' + SHAPE, user, beats };
  }

  // ---------------- helpers ----------------
  const str = (v) => (v == null ? '' : String(v)).trim();
  const words = (s) => str(s).split(/\s+/).filter(Boolean);
  const lc = (s) => str(s).toLowerCase();
  const num = (v, d) => { const m = /-?\d+(?:\.\d+)?/.exec(String(v == null ? '' : v)); return m ? Number(m[0]) : d; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function closest(v, list, dflt) {
    const s = lc(v).replace(/[_-]+/g, ' '); if (!s) return dflt;
    const hit = list.find((x) => lc(x) === s) || list.find((x) => s.includes(lc(x))) || list.find((x) => lc(x).includes(s));
    if (hit) return hit;
    const syn = { cafe: 'coffee shop', café: 'coffee shop', coffee: 'coffee shop', diner: 'restaurant booth', restaurant: 'restaurant booth', bathroom: 'bathroom mirror', mirror: 'bathroom mirror', lounge: 'living room', 'living': 'living room', school: 'classroom', desk: 'office', work: 'office', bus: 'bus stop', park: 'park bench', bench: 'park bench', supermarket: 'grocery aisle', store: 'grocery aisle', shop: 'grocery aisle', corridor: 'hallway', train: 'subway', metro: 'subway', stairs: 'stairwell', lift: 'elevator', party: 'party kitchen', clinic: 'waiting room', doctor: 'waiting room', seaside: 'beach', roof: 'rooftop', taxi: 'car', bed: 'bedroom' };
    for (const [k, t] of Object.entries(syn)) if (s.includes(k) && list.includes(t)) return t;
    return dflt;
  }
  function hexOk(h) { return /^#[0-9a-f]{6}$/i.test(str(h)); }
  function hsl(hex) {
    const n = parseInt(hex.slice(1), 16); const r = (n >> 16) / 255; const g = ((n >> 8) & 255) / 255; const b = (n & 255) / 255;
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const l = (mx + mn) / 2; const d = mx - mn; const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return { h, s, l };
  }
  // muddy brown (orange hue, low lightness / saturation) or gray-only colours are not allowed
  function friendlyColor(hex) { if (!hexOk(hex)) return false; const c = hsl(hex); if (c.s < 0.28) return false; if (c.h >= 15 && c.h <= 50 && c.l < 0.45) return false; if (c.l < 0.22 || c.l > 0.93) return false; return true; }
  function sentences(s) { return str(s).split(/(?<=[.!?])\s+/).filter((x) => /\w/.test(x)).length; }

  // ---------------- validation + repair ----------------
  // Returns { plan, errors (hard: need a re-ask), fixed (auto-repairs applied), warnings }.
  function validate(raw, input) {
    const want = [6, 8, 12].includes(Number(input && input.beats)) ? Number(input.beats) : 8;
    const errors = []; const fixed = []; const warnings = [];
    const p = JSON.parse(JSON.stringify(raw || {}));
    p.assumptions = p.assumptions || {}; p.colorScript = p.colorScript || {}; p.suspensePlan = p.suspensePlan || {}; p.spine = p.spine || {}; p.social = p.social || {}; p.rhythm = p.rhythm || {};
    p.assumptions.length = want; if (!p.assumptions.platform) p.assumptions.platform = PLATFORMS[input && input.platform] || '9:16 Reel';
    if (!p.assumptions.tone) p.assumptions.tone = (input && input.tone) || 'warm, pretty, suspense-first';
    if (!str(p.assumptions.withheldQuestion)) { if (str(p.suspensePlan.withheldQuestion)) { p.assumptions.withheldQuestion = p.suspensePlan.withheldQuestion; fixed.push('assumptions: withheld question copied from the suspense plan'); } else errors.push('assumptions.withheldQuestion is missing: name the question the video refuses to answer until the snap'); }
    if (!str(p.suspensePlan.withheldQuestion)) p.suspensePlan.withheldQuestion = p.assumptions.withheldQuestion;
    // colour script: 3 friendly colours
    const cs = p.colorScript; const pal = NICE_PALETTES[Math.abs(hashStr(str(input && input.storyline))) % NICE_PALETTES.length];
    for (const k of ['dominant', 'support', 'accent']) {
      if (typeof cs[k] === 'string') cs[k] = { name: cs[k], hex: cs[k] };
      cs[k] = cs[k] || {};
      if (!friendlyColor(cs[k].hex)) { const was = cs[k].hex; cs[k] = { name: pal[k][0], hex: pal[k][1] }; fixed.push(`color script: ${k} ${was || '(none)'} is muddy/gray/invalid, replaced with ${pal[k][0]} ${pal[k][1]}`); }
    }
    if (lc(cs.dominant.hex) === lc(cs.accent.hex) || lc(cs.support.hex) === lc(cs.accent.hex)) { cs.accent = { name: pal.accent[0], hex: pal.accent[1] }; fixed.push('color script: accent must differ from dominant/support'); }
    // characters 2-4, locked looks
    let chars = Array.isArray(p.characters) ? p.characters : [];
    if (chars.length < 2) errors.push('character lock needs 2-4 characters (got ' + chars.length + ')');
    if (chars.length > 4) { chars = chars.slice(0, 4); fixed.push('character lock trimmed to 4'); }
    const ids = new Set();
    chars.forEach((c, i) => {
      c.name = str(c.name) || 'Character ' + (i + 1);
      c.id = lc(c.id || c.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'c' + (i + 1);
      while (ids.has(c.id)) c.id += '2'; ids.add(c.id);
      c.hair = closest(c.hair, HAIR, 'short'); c.item = closest(c.item || c.signatureItem, ITEMS, 'none');
      // locked clothing: on-palette, friendly, never the accent (the accent is only for tension/snap), and readable against
      // the dominant-coloured walls (a top in the dominant colour is deepened so the body never melts into the wall)
      const isAccent = (h) => { const a = hsl(cs.accent.hex); const b = hsl(h); const dh = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h)); return dh < 22 && Math.abs(a.s - b.s) < 0.35 && Math.abs(a.l - b.l) < 0.25; };
      const near = (h, q) => { const a = hsl(q); const b = hsl(h); const dh = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h)); return dh < 28 && Math.abs(a.s - b.s) < 0.45; };
      const onPal = (h) => hexOk(h) && friendlyColor(h) && !isAccent(h) && (near(h, cs.dominant.hex) || near(h, cs.support.hex));
      const options = [cs.support.hex, deepen(cs.dominant.hex), shade(cs.support.hex, 0.3), shade(cs.support.hex, -0.35)];
      if (!onPal(c.top)) { const was = c.top; c.top = options[i % options.length]; if (lc(was) !== lc(c.top)) fixed.push(`character ${c.name}: top ${was || "(none)"} -> ${c.top} (on-palette, friendly, not the accent)`); }
      if (near(c.top, cs.dominant.hex) && Math.abs(hsl(c.top).l - Math.min(0.93, hsl(cs.dominant.hex).l + 0.1)) < 0.18) { c.top = deepen(cs.dominant.hex); fixed.push(`character ${c.name}: top deepened so it reads against the dominant walls`); }
      { const taken = chars.slice(0, i).map((q) => lc(q.top)); if (taken.includes(lc(c.top))) { const alt = options.find((o2) => !taken.includes(lc(o2))); fixed.push(`character ${c.name}: top changed to ${alt} so the locked looks differ`); c.top = alt; } }
      if (!hexOk(c.bottom) || isAccent(c.bottom) || !(friendlyColor(c.bottom) || hsl(c.bottom).l < 0.3)) c.bottom = i % 2 ? '#3D3B6E' : '#2B4C7E';
      if (!hexOk(c.hairColor) || !friendlyHair(c.hairColor) || isAccent(c.hairColor)) { const was = c.hairColor; c.hairColor = ['#2B2D42', '#3D2C8D', '#1B3A4B', '#5C2A9D'][i % 4]; if (was && isAccent(was)) fixed.push(`character ${c.name}: hair colour cannot be the accent`); }
      c.stressTell = closest(c.stressTell, ['tap', 'glance', 'grip', 'phone check'], ['glance', 'tap', 'grip', 'phone check'][i % 4]);
      c.voiceHint = c.voiceHint || {};
    });
    p.characters = chars;
    // locations: only real places from the list
    let locs = Array.isArray(p.locations) ? p.locations : [];
    locs.forEach((l) => { const id = closest(l.id || l.name, LOCATIONS, null); if (!id) { errors.push(`location "${l.name || l.id}" is not one of the real places`); return; } if (id !== l.id) { if (l.id) fixed.push(`location "${l.id}" mapped to "${id}"`); } l.id = id; l.name = str(l.name) || id;
      l.anchors = (Array.isArray(l.anchors) ? l.anchors : []).map(str).filter(Boolean).slice(0, 3); while (l.anchors.length < 3) { l.anchors.push(defaultAnchors(id)[l.anchors.length]); fixed.push(`location ${id}: anchor added`); }
      l.suspenseFeature = closest(l.suspenseFeature, FEATURES, 'unseen corner'); l.timeOfDay = closest(l.timeOfDay, ['morning', 'day', 'golden hour', 'evening', 'night'], 'morning'); });
    locs = locs.filter((l) => LOCATIONS.includes(l.id));
    p.locations = locs;
    // panels
    let panels = Array.isArray(p.panels) ? p.panels : [];
    if (panels.length !== want) { if (panels.length > want) { panels = panels.slice(0, want); errors.push(`panels: expected ${want}, got more (write exactly ${want})`); } else errors.push(`panels: expected ${want}, got ${panels.length}`); }
    const n = panels.length;
    const charIds = new Set(chars.map((c) => c.id)); const byName = new Map(chars.map((c) => [lc(c.name), c.id]));
    const resolve = (who) => { const s = lc(who); if (charIds.has(s)) return s; if (byName.has(s)) return byName.get(s); const c = chars.find((q) => s && (s.includes(lc(q.name)) || s.includes(q.id))); return c ? c.id : null; };
    const known = ' ' + lc(input && input.storyline).replace(/[^a-z0-9' ]+/g, ' ') + ' ' + LOCATIONS.join(' ') + ' ';
    const spoilers = (Array.isArray(p.spoilerWords) ? p.spoilerWords : []).map(lc).filter((w) => w.length > 2 && !known.includes(' ' + w + ' ') && !known.includes(' ' + w + 's ')); p.spoilerWords = spoilers;
    const hasSpoiler = (s) => { const t = ' ' + lc(s).replace(/[^a-z0-9' ]+/g, ' ') + ' '; return spoilers.find((w) => t.includes(' ' + w + ' ') || (w.includes(' ') && t.includes(w))); };
    panels.forEach((pn, i) => {
      pn.n = i + 1; const last = i === n - 1; const peak = i === n - 2;
      pn.location = closest(pn.location, LOCATIONS, (locs[0] && locs[0].id) || 'coffee shop');
      if (!locs.find((l) => l.id === pn.location)) { locs.push({ id: pn.location, name: pn.location, anchors: defaultAnchors(pn.location), timeOfDay: 'day', palette: 'dominant walls, support furniture', suspenseFeature: 'unseen corner' }); fixed.push(`location lock: added "${pn.location}" used by panel ${i + 1}`); }
      pn.shot = closest(pn.shot, SHOTS, 'medium'); pn.cameraMove = closest(pn.cameraMove, MOVES, 'hold'); pn.effect = closest(pn.effect, EFFECTS, 'none');
      pn.spine = closest(pn.spine, SPINE, i === 0 ? 'hook' : last ? 'snap' : peak ? 'withhold' : i < n / 2 ? 'pressure' : 'tighten');
      pn.mood = closest(pn.mood, MOODS, 'rising'); pn.tension = clamp(Math.round(num(pn.tension, 2)), 1, 5);
      pn.duration = clamp(num(pn.duration, 3), 1.2, 6);
      // dialogue: at most one short line by a locked character
      if (typeof pn.dialogue === 'string') { const m = /^\s*([^:]{1,24}):\s*"?(.*?)"?\s*$/.exec(pn.dialogue); pn.dialogue = /^none$/i.test(str(pn.dialogue)) || !m ? null : { speaker: m[1], line: m[2] }; }
      if (pn.dialogue && (!str(pn.dialogue.line) || /^none$/i.test(str(pn.dialogue.line)))) pn.dialogue = null;
      if (pn.dialogue) { const id = resolve(pn.dialogue.speaker); if (!id) errors.push(`panel ${i + 1}: dialogue speaker "${pn.dialogue.speaker}" is not in the character lock (no new characters mid-story)`); else pn.dialogue.speaker = id;
        pn.dialogue.line = str(pn.dialogue.line).replace(/^["“]|["”]$/g, ''); if (words(pn.dialogue.line).length > 10) errors.push(`panel ${i + 1}: dialogue "${pn.dialogue.line}" is longer than 8 words`); }
      if (pn.reply && typeof pn.reply === 'object' && str(pn.reply.line) && !/^none$/i.test(str(pn.reply.line))) { const id = resolve(pn.reply.speaker); if (!id || i !== n - 1 || (pn.dialogue && id === pn.dialogue.speaker)) { pn.reply = null; } else { pn.reply = { speaker: id, line: words(str(pn.reply.line).replace(/^["“]|["”]$/g, '')).slice(0, 8).join(' ') }; } } else pn.reply = null;
      pn.narration = /^none$/i.test(str(pn.narration)) ? '' : str(pn.narration);
      if (words(pn.narration).length > 12) errors.push(`panel ${i + 1}: narration longer than 10 words`);
      pn.caption = /^none$/i.test(str(pn.caption)) ? '' : str(pn.caption).replace(/^["“]|["”]$/g, '');
      if (words(pn.caption).length >= 12) { pn.caption = words(pn.caption).slice(0, 11).join(' ').replace(/[,;:]$/, '') + '…'; fixed.push(`panel ${i + 1}: caption shortened to under 12 words`); }
      pn.delivery = DELIVERY[lc(pn.delivery)] ? lc(pn.delivery) : 'light';
      // stage: only locked characters
      pn.stage = pn.stage || {}; const st = pn.stage;
      st.chars = (Array.isArray(st.chars) ? st.chars : []).map((c) => Object.assign({}, c, { id: resolve(c.id || c.name) })).filter((c, k, a) => { if (!c.id) { errors.push(`panel ${i + 1}: stage has a character that is not in the character lock`); return false; } return a.findIndex((q) => q.id === c.id) === k; });
      st.chars.forEach((c, k) => { c.x = closest(c.x, ['left', 'center', 'right'], st.chars.length === 1 ? 'center' : ['left', 'right', 'center'][k % 3]); c.facing = closest(c.facing, ['left', 'right', 'front', 'back'], 'front'); c.far = !!c.far; c.pose = closest(c.pose, POSES, 'stand'); c.eyes = closest(c.eyes, EYES, 'neutral'); c.symbol = closest(c.symbol, SYMBOLS, 'none'); });
      if (pn.dialogue && pn.dialogue.speaker && !st.chars.find((c) => c.id === pn.dialogue.speaker) && pn.shot !== 'insert') { st.chars.push({ id: pn.dialogue.speaker, x: st.chars.length ? 'right' : 'center', facing: 'front', pose: 'stand', eyes: 'neutral', symbol: 'none' }); fixed.push(`panel ${i + 1}: speaker added to the frame`); }
      if (pn.reply && pn.reply.speaker && !st.chars.find((c) => c.id === pn.reply.speaker)) { st.chars.push({ id: pn.reply.speaker, x: st.chars.some((c) => c.x === 'left') ? 'right' : 'left', facing: st.chars.some((c) => c.x === 'left') ? 'left' : 'right', pose: 'cheer', eyes: 'happy', symbol: 'none' }); fixed.push(`panel ${i + 1}: reply speaker added to the frame`); }
      st.chars.forEach((c) => { if (c.far && [pn.dialogue, pn.reply].some((d) => d && d.speaker === c.id)) c.far = false; });
      if (!st.chars.length && pn.shot !== 'insert' && chars[0]) { st.chars.push({ id: chars[0].id, x: 'center', facing: 'front', pose: 'stand', eyes: 'neutral', symbol: 'none' }); fixed.push(`panel ${i + 1}: empty frame got the lead character`); }
      st.clue = st.clue || {}; st.clue.object = closest(st.clue.object, CLUES, 'none'); st.clue.state = closest(st.clue.state, ['hidden', 'partial', 'revealed'], 'partial'); st.clue.x = closest(st.clue.x, ['left', 'center', 'right'], 'center'); st.clue.label = words(st.clue.label).slice(0, 3).join(' ');
      st.motion = closest(st.motion, MOTIONS, 'none'); st.focus = resolve(st.focus) || (lc(st.focus) === 'clue' ? 'clue' : (st.chars[0] && st.chars[0].id) || 'clue');
      if (!last && st.clue.state === 'revealed') { st.clue.state = 'partial'; fixed.push(`panel ${i + 1}: clue cannot be fully revealed before the snap`); }
      if (!last && hasSpoiler(st.clue.label)) { st.clue.label = ''; fixed.push(`panel ${i + 1}: clue label removed (it spoiled the snap)`); }
      // no spoilers before the snap
      if (!last) {
        const sc = hasSpoiler(pn.caption); if (sc) { fixed.push(`panel ${i + 1}: caption "${pn.caption}" spoiled the snap ("${sc}") - removed`); pn.caption = ''; }
        if (pn.dialogue) { const sd = hasSpoiler(pn.dialogue.line); if (sd) errors.push(`panel ${i + 1}: dialogue gives away the answer ("${sd}") before the snap`); }
        const sn = hasSpoiler(pn.narration); if (sn) { fixed.push(`panel ${i + 1}: narration spoiled the snap - removed`); pn.narration = ''; }
      }
    });
    if (n) {
      // every locked character is established in panel 1 or 2 (no new person at the snap)
      chars.forEach((c) => { const seen = panels.slice(0, Math.min(2, n)).some((pn) => pn.stage.chars.some((q) => q.id === c.id)); if (!seen && panels[0].shot !== 'insert') { panels[0].stage.chars.push({ id: c.id, x: panels[0].stage.chars.some((q) => q.x === 'right') ? 'left' : 'right', facing: 'back', pose: 'stand', eyes: 'neutral', symbol: 'none', far: true }); panels[0].boardNotes = (str(panels[0].boardNotes) + ` ${c.name} is already there, far back and facing away (no new characters later).`).trim(); fixed.push(`panel 1: ${c.name} established in the background (no new characters mid-story)`); } else if (!seen) { const k = n > 1 ? 1 : 0; panels[k].stage.chars.push({ id: c.id, x: 'right', facing: 'back', pose: 'stand', eyes: 'neutral', symbol: 'none', far: true }); fixed.push(`panel ${k + 1}: ${c.name} established in the background`); } });
      // panel 1 uneasy normal
      if (panels[0].mood !== 'uneasy normal') { panels[0].mood = 'uneasy normal'; fixed.push('panel 1 set to "uneasy normal"'); }
      panels[0].tension = Math.min(panels[0].tension, 2);
      // peak withhold = second-to-last; snap = last
      panels.forEach((pn, i) => { if (i < n - 2 && pn.mood === 'peak') { pn.mood = 'tense'; fixed.push(`panel ${i + 1}: only the beat before the last can be the peak withhold`); } if (i < n - 1 && pn.mood === 'snap') { pn.mood = 'tense'; fixed.push(`panel ${i + 1}: only the last beat is the snap`); } });
      if (n >= 2) { const pk = panels[n - 2]; if (pk.mood !== 'peak') { pk.mood = 'peak'; fixed.push(`panel ${n - 1} set as the peak withhold`); } pk.spine = 'withhold'; pk.tension = 5; }
      const sn = panels[n - 1]; if (sn.mood !== 'snap') { sn.mood = 'snap'; fixed.push(`panel ${n} set as the snap`); } sn.spine = 'snap'; sn.tension = 5;
      // middle beats escalate one notch each (a false calm may dip)
      for (let i = 1; i < n - 2; i++) { const pn = panels[i]; const prev = panels[i - 1]; const dip = pn.mood === 'false calm' || lc(pn.suspenseBeat).includes('false calm'); if (!dip && pn.tension < prev.tension) { pn.tension = prev.tension; fixed.push(`panel ${i + 1}: tension raised to keep escalating`); } if (pn.tension > 4) pn.tension = 4; }
      // strongest suspense beat has no dialogue (and no narration): the silence beat
      const pk = panels[n - 2];
      if (pk && (pk.dialogue || pk.narration)) { if (pk.dialogue) { pk.boardNotes = (str(pk.boardNotes) + ' (line moved off: the peak withhold has NONE dialogue)').trim(); } pk.dialogue = null; pk.narration = ''; fixed.push(`panel ${n - 1}: dialogue removed - the strongest suspense beat has NONE dialogue`); }
      let sil = Math.round(num(p.rhythm.silence, n - 1)); if (!(sil >= 1 && sil <= n - 1) || panels[sil - 1].dialogue || panels[sil - 1].narration) { if (sil !== n - 1) fixed.push('rhythm: the silence beat is the peak withhold (panel ' + (n - 1) + ')'); sil = n - 1; }
      p.rhythm.silence = sil; p.rhythm.snap = n; panels.forEach((pn, i) => { pn.silence = i === sil - 1; if (pn.silence) { pn.effect = 'none'; pn.dialogue = null; pn.narration = ''; if (pn.cameraMove === 'snap cut') pn.cameraMove = 'hold'; } });
      if (!Array.isArray(p.rhythm.falseCalm)) p.rhythm.falseCalm = panels.filter((x) => x.mood === 'false calm' || x.mood === 'uneasy normal').map((x) => x.n);
      // panel 1 establishes everyone (wide) and the snap shows the reveal with everyone in it (wide) so nobody is cropped out
      [0, n - 1].forEach((i) => { const pn = panels[i]; if (pn && pn.shot !== 'wide' && (pn.stage.chars || []).length >= 2) { pn.shot = 'wide'; fixed.push(`panel ${i + 1}: wide shot so every character on stage is in frame`); } });
      // every locked character speaks (each has a locked voice)
      (p.characters || []).forEach((c) => { if (!panels.some((pn) => (pn.dialogue && pn.dialogue.speaker === c.id) || (pn.reply && pn.reply.speaker === c.id))) errors.push(`character ${c.name} never speaks: give ${c.name} one short line (the silence beat stays silent)`); });
      // lines on the withhold beats (tension 4+) are whispered or tense
      panels.forEach((pn, i) => { if (i < n - 2 && pn.tension >= 4 && pn.dialogue && !['whisper', 'tense'].includes(pn.delivery)) { pn.delivery = 'whisper'; fixed.push(`panel ${i + 1}: withhold line whispered`); } });
      // withhold whispered/tense, snap bright
      if (!['whisper', 'tense'].includes(panels[n - 2] && panels[n - 2].delivery) && n >= 2) panels[n - 2].delivery = 'whisper';
      sn.delivery = 'bright'; if (sn.cameraMove !== 'snap cut') { sn.cameraMove = 'snap cut'; fixed.push(`panel ${n}: the snap cuts in (snap cut)`); }
      // the peak withhold holds (slow push-in), never cuts; the snap owns the snap cut and the ding
      { const pk2 = panels[n - 2]; if (pk2 && pk2.cameraMove === 'snap cut') { pk2.cameraMove = 'slow push-in'; fixed.push(`panel ${n - 1}: the peak withhold pushes in slowly (the snap cut belongs to the snap)`); }
        panels.forEach((pn, i) => { if (i < n - 1 && pn.cameraMove === 'snap cut') { pn.cameraMove = 'hold'; fixed.push(`panel ${i + 1}: snap cut only on the snap`); } if (i < n - 1 && pn.effect === 'ding') { pn.effect = pn.silence ? 'none' : pn.tension >= 4 ? 'hush' : 'tick'; fixed.push(`panel ${i + 1}: ding moved to the snap`); } });
        if (sn.effect === 'none' || !sn.effect) sn.effect = 'ding';
        // small camera motion: tense beats push in, one quiet beat drifts (slight pan) when the board is all holds
        const holds = panels.filter((pn, i) => i < n - 1 && pn.cameraMove === 'hold').length;
        if (holds >= Math.ceil((n - 1) * 0.6)) { panels.forEach((pn, i) => { if (i > 0 && i < n - 1 && pn.cameraMove === 'hold' && pn.tension >= 3 && pn.shot !== 'insert') pn.cameraMove = 'slow push-in'; }); const q = panels.find((pn, i) => i > 0 && i < n - 2 && pn.cameraMove === 'hold' && pn.tension <= 2); if (q) q.cameraMove = 'slight pan'; fixed.push('camera: tense beats push in slowly, a quiet beat pans slightly (the board was all holds)'); } }
      // accent only on tension spikes and the snap
      panels.forEach((pn, i) => { const allowed = pn.tension >= 3 || i === n - 1; if (pn.accentAllowed && !allowed) { pn.accentAllowed = false; fixed.push(`panel ${i + 1}: accent not allowed in a quiet frame`); } if (i === n - 1) pn.accentAllowed = true; pn.accentAllowed = !!pn.accentAllowed; });
      // no location change without a transition shot
      panels.forEach((pn, i) => { if (i && pn.location !== panels[i - 1].location) { if (!pn.transitionShot || pn.shot !== 'wide') { pn.transitionShot = true; pn.shot = 'wide'; pn.boardNotes = (str(pn.boardNotes) + ' Transition shot: establishing wide of the new place.').trim(); fixed.push(`panel ${i + 1}: location changes, made it a wide transition shot`); } } else pn.transitionShot = !!pn.transitionShot && i > 0 && pn.location !== panels[i - 1].location; });
    }
    p.panels = panels;
    // suspense plan: 4+ devices on real beats
    let dev = Array.isArray(p.suspensePlan.devices) ? p.suspensePlan.devices : [];
    dev = dev.map((d) => ({ device: closest(d.device, DEVICES, null), beat: Math.round(num(d.beat, 0)), how: str(d.how) })).filter((d) => d.device && d.beat >= 1 && d.beat <= n);
    if (n && !dev.find((d) => d.device === 'silence beat')) { dev.push({ device: 'silence beat', beat: p.rhythm.silence, how: 'music drops, no voice, held an extra half second' }); fixed.push('suspense plan: silence beat mapped to panel ' + p.rhythm.silence); }
    if (dev.length < 4) errors.push('suspense plan needs four or more devices mapped to beats (got ' + dev.length + ')');
    p.suspensePlan.devices = dev; if (!str(p.suspensePlan.knowledgeGap)) errors.push('suspense plan: say what the audience knows that a character does not, or the reverse');
    for (const k of SPINE) if (!str(p.spine[k])) errors.push('story spine: "' + k + '" is missing');
    // social packaging
    const so = p.social;
    if (words(so.seriesTitle).length >= 6 || !str(so.seriesTitle)) { if (!str(so.seriesTitle)) errors.push('social: series title missing'); else { so.seriesTitle = words(so.seriesTitle).slice(0, 5).join(' '); fixed.push('social: series title cut to under 6 words'); } }
    if (words(so.hookText).length > 8 || !str(so.hookText)) { if (!str(so.hookText)) so.hookText = words(panels[0] && (panels[0].caption || panels[0].action)).slice(0, 8).join(' '); else so.hookText = words(so.hookText).slice(0, 8).join(' '); fixed.push('social: hook text max 8 words'); }
    let tags = (Array.isArray(so.hashtags) ? so.hashtags : String(so.hashtags || '').split(/[\s,]+/)).map((t) => '#' + str(t).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter((t) => t.length > 1);
    tags = [...new Set(tags)]; ['#stickfigure', '#suspense', '#shortstory', '#animation', '#storytime'].forEach((t) => { if (tags.length < 5 && !tags.includes(t)) tags.push(t); }); if (tags.length !== (Array.isArray(so.hashtags) ? so.hashtags.length : -1)) fixed.push('social: exactly 5 hashtags'); so.hashtags = tags.slice(0, 5);
    if (sentences(so.caption) > 2) { so.caption = str(so.caption).split(/(?<=[.!?])\s+/).slice(0, 2).join(' '); fixed.push('social: caption cut to 2 sentences'); }
    if (!str(so.caption)) errors.push('social: post caption missing');
    if (!str(so.endCardLine)) so.endCardLine = 'Follow for part 2';
    for (const [k, v] of [['caption', so.caption], ['hookText', so.hookText], ['seriesTitle', so.seriesTitle], ['cliffhanger', so.cliffhanger]]) { const s = hasSpoiler(v); if (s) { if (k === 'caption' || k === 'cliffhanger') errors.push(`social.${k} spoils the snap ("${s}")`); else { so[k] = k === 'seriesTitle' ? 'The Little Mystery' : words(panels[0] && panels[0].action).slice(0, 6).join(' '); fixed.push(`social.${k} spoiled the snap - replaced`); } } }
    // voices: distinct, locked, fitting
    castVoices(p, fixed);
    // one source of truth for on-screen text (after the narrator is settled): a voiced panel's caption is exactly its spoken text
    syncCaptions(p, fixed);
    // arm pose per figure from ACTION / BOARD NOTES (default relaxed arms down, never a T-pose)
    mapPoses(p);
    // durations: total 24-32 s with the 1.5 s end card (timing() enforces the per-shot rules)
    const tm = timing(p); const total = tm.total;
    if (total < 24 - 1e-6 || total > 32 + 1e-6) warnings.push('total ' + total.toFixed(1) + ' s outside 24-32 s after timing');
    panels.forEach((pn, i) => { pn.duration = +tm.shots[i].dur.toFixed(2); });
    // shot list + thumbnails + still prompts are rebuilt from the repaired panels so they always agree
    p.shots = buildShots(p, tm); if (!Array.isArray(p.thumbnails) || p.thumbnails.length !== n) { p.thumbnails = panels.map((pn) => `${pn.n}. ${pn.shot} - ${pn.action}`); fixed.push('thumbnail row rebuilt (one line per panel)'); }
    if (!Array.isArray(p.pausePoints) || !p.pausePoints.length) p.pausePoints = [p.rhythm.silence, n - 1].filter((v, k, a) => a.indexOf(v) === k);
    p.pausePoints = p.pausePoints.map((v) => Math.round(num(v, 0))).filter((v) => v >= 1 && v <= n);
    p.stillPrompts = panels.map((pn) => stillPrompt(p, pn));
    p.assembly = assemblyRules(p, tm);
    p.timing = { total: +total.toFixed(2), endCard: tm.endCard, shots: tm.shots.map((s) => ({ panel: s.panel, start: +s.start.toFixed(2), dur: +s.dur.toFixed(2) })) };
    return { plan: p, errors, fixed, warnings };
  }

  // ---------------- on-screen text = spoken text (one source of truth) ----------------
  const narrated = (p, pn) => !!(p.narrator && p.narrator.use !== false && str(pn.narration) && !pn.silence);
  // The caption of a voiced panel is the voiced text: the narration (when the narrator reads it), or nothing when only a character
  // speaks (the character's line is the burned-in caption). Unvoiced panels keep their CAPTION. Idempotent; reports what it changed.
  function syncCaptions(p, fixed) {
    fixed = fixed || [];
    (p.panels || []).forEach((pn, i) => {
      if (narrated(p, pn)) {
        if (words(pn.narration).length >= 12) { pn.narration = words(pn.narration).slice(0, 11).join(' ').replace(/[,;:]$/, ''); fixed.push(`panel ${i + 1}: narration cut to 11 words (it is also the caption)`); }
        if (str(pn.caption) !== str(pn.narration)) { if (str(pn.caption)) pn.captionWas = pn.caption; fixed.push(`panel ${i + 1}: caption "${pn.caption || ''}" -> narration "${pn.narration}" (the caption is the spoken text)`); pn.caption = str(pn.narration); }
      } else if ((pn.dialogue && str(pn.dialogue.line)) || (pn.reply && str(pn.reply.line))) {
        if (str(pn.caption)) { pn.captionWas = pn.caption; fixed.push(`panel ${i + 1}: caption "${pn.caption}" removed (the spoken line is the burned-in caption)`); pn.caption = ''; }
      }
    });
    (p.shots || []).forEach((sh, i) => { const pn = (p.panels || [])[i]; if (pn) sh.onScreenText = onScreenText(p, pn); });
    return fixed;
  }
  function onScreenText(p, pn) {
    const say = (d) => { const c = (p.characters || []).find((q) => q.id === d.speaker); return `${c ? c.name : d.speaker}: ${d.line}`; };
    const t = [narrated(p, pn) ? pn.narration : '', pn.dialogue ? say(pn.dialogue) : '', pn.reply ? say(pn.reply) : ''].filter(Boolean);
    return t.length ? t.join(' / ') + ' (spoken, burned in word for word)' : (pn.caption || 'none');
  }
  // every caption/voice mismatch in a plan (empty = in sync); used by tests and the pipeline's final QA
  function captionMismatches(p) {
    const out = [];
    (p.panels || []).forEach((pn, i) => {
      if (narrated(p, pn) && str(pn.caption) !== str(pn.narration)) out.push({ panel: i + 1, caption: pn.caption, voiced: pn.narration });
      else if (!narrated(p, pn) && ((pn.dialogue && str(pn.dialogue.line)) || (pn.reply && str(pn.reply.line))) && str(pn.caption)) out.push({ panel: i + 1, caption: pn.caption, voiced: [pn.dialogue && pn.dialogue.line, pn.reply && pn.reply.line].filter(Boolean).join(' / ') });
    });
    return out;
  }

  // ---------------- pose library mapping ----------------
  // Which arm pose (ARM_POSES) a figure takes in a panel, and what it holds, from the panel's ACTION + BOARD NOTES: sentences that
  // name this character, plus unnamed sentences when the character is the panel's focus (or the only one in front). Falls back
  // to the stage pose label; anything unknown is 'idle' (relaxed arms down).
  function poseFor(p, pn, sc) {
    const chars = p.characters || []; const c = chars.find((q) => q.id === sc.id); const name = lc(c && c.name);
    const others = chars.filter((q) => q.id !== sc.id).map((q) => lc(q.name)).filter(Boolean);
    const front = ((pn.stage && pn.stage.chars) || []).filter((q) => !q.far);
    const lead = (pn.stage && pn.stage.focus === sc.id) || (front.length === 1 && front[0].id === sc.id);
    const sents = lc(str(pn.action) + '. ' + str(pn.boardNotes)).split(/(?<=[.!?;])\s+|\.\s*/).map((x) => x.trim()).filter(Boolean);
    const has = (s, n) => n && new RegExp('\\b' + n.replace(/[^a-z0-9 ]/g, '') + '\\b').test(s);
    const mine = sents.filter((s) => has(s, name) || (lead && !others.some((o) => has(s, o)) && !has(s, name) && !/\b(camera|frame|shot|lettering|focus entirely)\b/.test(s)));
    const t = ' ' + mine.join('. ') + ' ';
    const clue = (pn.stage && pn.stage.clue) || {};
    const objIn = (s) => { const m = /\b(cup|mug|coffee|latte|tea|note|paper|message|card|letter|envelope|phone|book|photo|picture|ticket)s?\b/.exec(s); return m ? HOLDABLE[m[1]] : null; };
    const r = (arms, holds) => ({ arms, holds: holds || null });
    if (sc.pose === 'sit') return r('sit');
    if (sc.pose === 'hide') return r('hide');
    if (sc.facing === 'back') return r('back');
    if (/\bwav(e|es|ing)\b(?! of)/.test(t)) return r('wave');
    if (/\bshrug/.test(t)) return r('shrug');
    if (/\bhands? on (her |his |their )?hips\b/.test(t)) return r('hips');
    if (/\b(hand|hands|palm)s? (to|on|over|pressed to) (her |his |their )?(chest|heart)\b|\bclutch(es|ing)? (her |his |their )?(chest|heart)\b/.test(t)) return r('hand-chest');
    if (/\bpoint(s|ing|ed)?\b/.test(t)) return r('point');
    if (/\b(read|reads|reading|unfold|unfolds|unfolding|opens?|opening|stares? at|studies)\b[^.]*\b(note|letter|paper|message|card|envelope)\b|\b(note|letter|paper) in (her|his|their) hands?\b/.test(t)) { const o = objIn(t.slice(t.search(/\b(note|letter|paper|message|card|envelope)\b/))) || 'note'; return r('reading', o === 'letter' ? 'letter' : 'note'); }
    if (/\b(knuckles|grip|grips|gripping|clutch|clutches|clutching|both hands)\b/.test(t) && /\b(cup|mug|coffee|latte|tea)\b/.test(t)) return r('grip-cup', 'cup');
    if (/\b(hold|holds|holding|held|lift|lifts|lifting|sip|sips|sipping|carr(y|ies|ying)|raises?|raising|picks? up)\b[^.]*\b(cup|mug|coffee|latte|tea)\b|\b(cup|mug) in (her|his|their) hand\b/.test(t)) return r('cup', 'cup');
    if (/\b(hold|holds|holding|checks?|checking|looks? at|scroll(s|ing)?)\b[^.]*\bphone\b/.test(t)) return r('phone', 'phone');
    if (/\b(startl|gasp|whips? around|spins? around|jumps?|jumped|shock|recoil|flinch)/.test(t)) return r('startled');
    if (/\b(cheer|cheers|celebrat|arms up|hooray|throws? (her|his|their) arms)/.test(t)) return r('cheer');
    if (/\breach(es|ing)?\b/.test(t)) return r('reach');
    if (/\b(freez|frozen|stiff|tense|holds? (her|his|their) breath|breath held)/.test(t)) return r('tense');
    // stage label fallback (the old 'freeze' arms-out pose is gone: freeze = tense, arms down)
    const held = HOLDABLE[clue.object] || null;
    switch (sc.pose) {
      case 'cheer': return r('cheer');
      case 'point': return r('point');
      case 'reach': return r('reach');
      case 'freeze': return r('tense');
      case 'hold': return held === 'note' || held === 'letter' || held === 'photo' || held === 'book' || held === 'ticket' ? r('reading', held) : held === 'phone' ? r('phone', 'phone') : r('cup', 'cup');
      default: return r('idle');
    }
  }
  function mapPoses(p) { (p.panels || []).forEach((pn) => ((pn.stage && pn.stage.chars) || []).forEach((sc) => { const m = poseFor(p, pn, sc); sc.arms = m.arms; sc.holds = m.holds; })); return p; }
  // a saved plan (older engine) brought up to date without a new Gemini call: captions synced, poses mapped, shot list text
  function refresh(p) { const fixed = syncCaptions(p, []); mapPoses(p); return fixed; }
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
  function friendlyHair(hex) { const c = hsl(hex); return !(c.h >= 15 && c.h <= 50 && c.l < 0.4 && c.s < 0.6 && c.s > 0.05) || c.l < 0.2; }
  function hslHex(h, s2, l) { const a = s2 * Math.min(l, 1 - l); const f = (n) => { const k = (n + h / 30) % 12; const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, '0'); }; return '#' + f(0) + f(8) + f(4); }
  function deepen(hex) { const c = hsl(hex); return hslHex(c.h, Math.min(0.95, c.s + 0.25), clamp(c.l - 0.2, 0.48, 0.62)); }
  function shade(hex, k) { if (!hexOk(hex)) return hex; const n = parseInt(hex.slice(1), 16); const f = (v) => Math.round(clamp(k < 0 ? v * (1 + k) : v + (255 - v) * k, 0, 255)); return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(f).map((v) => v.toString(16).padStart(2, '0')).join(''); }
  function defaultAnchors(id) {
    const A = { 'coffee shop': ['espresso machine', 'chalk menu board', 'window with plants'], kitchen: ['fridge with magnets', 'stove with a kettle', 'window over the sink'], bedroom: ['bed with a quilt', 'night lamp', 'window with curtains'], 'bathroom mirror': ['round mirror', 'sink', 'towel rail'], 'living room': ['sofa', 'standing lamp', 'framed pictures'], classroom: ['chalkboard', 'desks in rows', 'wall clock'], office: ['desk with a monitor', 'potted plant', 'window blinds'], 'bus stop': ['bus stop sign', 'shelter bench', 'street lamp'], 'park bench': ['bench', 'round trees', 'lamp post'], 'grocery aisle': ['shelves of cans', 'shopping cart', 'aisle sign'], gym: ['dumbbell rack', 'mirror wall', 'water cooler'], 'restaurant booth': ['booth seats', 'pendant lamp', 'menu stand'], rooftop: ['city skyline', 'string lights', 'railing'], hallway: ['doors in a row', 'ceiling lamps', 'runner rug'], car: ['steering wheel', 'dashboard', 'side window'], library: ['tall bookshelves', 'reading lamp', 'quiet sign'], subway: ['seats', 'grab handles', 'route map'], stairwell: ['stairs', 'handrail', 'landing window'], elevator: ['elevator doors', 'floor buttons', 'floor display'], 'party kitchen': ['counter with snacks', 'balloons', 'fridge'], 'waiting room': ['row of chairs', 'reception desk', 'wall clock'], beach: ['sea', 'sun umbrella', 'sand castle'] };
    return A[id] || ['window', 'door', 'lamp'];
  }

  // ---------------- voices ----------------
  function scoreVoice(name, c) {
    const v = VOICES[name]; if (!v) return -99; const h = c.voiceHint || {}; let s = 0;
    const g = lc(h.gender); if (g.startsWith('f') && v[0] === 'f') s += 4; else if (g.startsWith('m') && v[0] === 'm') s += 4; else if (g && !g.startsWith('n')) s -= 6;
    const age = lc(h.age); if (/child|kid|teen/.test(age)) s += v[1] === 'high' ? 3 : v[1] === 'mid' ? 0 : -3; if (/older|old|grand|elder|senior/.test(age)) s += v[1] === 'low' ? 3 : v[3] === 'mature' ? 3 : -1; if (/young adult/.test(age)) s += v[1] !== 'low' ? 1 : 0;
    const en = lc(h.energy); if (en.startsWith('high') && v[2] === 'high') s += 2; if (en.startsWith('calm') && v[2] === 'low') s += 2; if (en.startsWith('med') && v[2] === 'mid') s += 1;
    const per = lc(c.personality + ' ' + c.role + ' ' + c.silhouette);
    if (/warm|kind|gentle|sweet/.test(per) && /warm|gentle|soft|friendly/.test(v[3])) s += 2; if (/shy|quiet|timid/.test(per) && /soft|breathy|gentle/.test(v[3])) s += 2;
    if (/bold|confident|boss/.test(per) && /firm|forward/.test(v[3])) s += 2; if (/cheer|bubbly|energetic|excit|playful|goofy|silly/.test(per) && /upbeat|bright|lively|excitable/.test(v[3])) s += 2;
    if (/barista|friend|neighbo/.test(per) && /friendly|casual|easy/.test(v[3])) s += 1;
    return s;
  }
  function castVoices(p, fixed) {
    const used = [];
    const pick = (c, prefer) => {
      const distinctPen = (n) => used.reduce((pen, u) => pen + (u === n ? 99 : (VOICES[u][0] === VOICES[n][0] && VOICES[u][1] === VOICES[n][1] ? 3 : 0)), 0);
      if (prefer && VOICES[prefer] && !used.includes(prefer) && scoreVoice(prefer, c) >= 2 && distinctPen(prefer) < 3) return prefer;
      return Object.keys(VOICES).map((n) => [n, scoreVoice(n, c) - distinctPen(n)]).sort((a, b) => b[1] - a[1])[0][0];
    };
    (p.characters || []).forEach((c) => {
      const want = Object.keys(VOICES).find((n) => lc(n) === lc(c.voice)); const v = pick(c, want);
      if (v !== want) fixed.push(`voice: ${c.name} cast as ${v} (${VOICES[v].slice(0, 2).join(', ')} pitch, ${VOICES[v][3]})` + (want ? ` instead of ${want} (not distinct or not fitting)` : ''));
      if (v !== want) c.voiceWhy = `${VOICES[v][3]}, ${VOICES[v][1]} pitch, ${VOICES[v][2]} energy - fits ${lc(c.voiceHint.age || 'adult')} ${lc(c.voiceHint.gender || '')} ${lc(c.personality).slice(0, 60)}`.replace(/\s+/g, ' ');
      c.voice = v; used.push(v);
    });
    p.narrator = p.narrator || {}; p.narrator.use = p.narrator.use !== false;
    const nv = Object.keys(VOICES).find((n) => lc(n) === lc(p.narrator.voice));
    if (!nv || used.includes(nv)) { const cand = ['Sulafat', 'Achird', 'Vindemiatrix', 'Schedar', 'Charon', 'Callirrhoe', 'Umbriel', 'Despina'].find((n) => !used.includes(n) && !used.some((u) => VOICES[u][0] === VOICES[n][0] && VOICES[u][1] === VOICES[n][1])) || ['Sulafat', 'Achird', 'Schedar'].find((n) => !used.includes(n)); p.narrator.voice = cand; p.narrator.why = 'warm storyteller, distinct from every character'; if (nv) fixed.push('narrator voice changed to ' + cand + ' (must differ from the characters)'); }
    else p.narrator.voice = nv;
  }

  // ---------------- timing (assembly rules) ----------------
  // Shot durations: plan durations, stretched to fit the voiced lines (lineDur[i] seconds incl. both dialogue + narration),
  // peak withhold +0.5 s, snap shorter than every earlier shot, end card 1.5 s, total 24-32 s.
  const LINE_LEAD = 0.35; const LINE_TAIL = 0.35; const END_CARD = 1.5;
  function timing(p, lineDur) {
    const P = p.panels || []; const n = P.length; lineDur = lineDur || [];
    const need = P.map((pn, i) => (lineDur[i] ? lineDur[i] + LINE_LEAD + LINE_TAIL : 0));
    let d = P.map((pn, i) => Math.max(clamp(num(pn.duration, 3), 1.4, 6), need[i], pn.silence ? 2.0 : 0));
    if (n >= 2) d[n - 2] = Math.max(d[n - 2], 2.4); // peak withhold base (the +0.5 s hold is added below)
    const fit = (target) => { // scale the flexible part (time above each shot's minimum) to hit target body length
      const min = d.map((v, i) => Math.max(need[i], i === n - 1 ? 1.0 : 1.4, P[i].silence ? 2.0 : 0)); const flex = d.map((v, i) => v - min[i]);
      const body = d.reduce((a, b) => a + b, 0); const fl = flex.reduce((a, b) => a + b, 0); if (!fl) return;
      const k = clamp((target - (body - fl)) / fl, 0, 3); d = d.map((v, i) => min[i] + flex[i] * k);
    };
    const extra = n >= 2 ? 0.5 : 0; const sum = () => d.reduce((a, b) => a + b, 0) + extra + END_CARD;
    if (sum() > 32) fit(32 - extra - END_CARD - 0.2); if (sum() < 24) fit(24 - extra - END_CARD + 0.4);
    if (sum() < 24) { const add = (24 - sum() + 0.2) / Math.max(1, n - 1); d = d.map((v, i) => (i === n - 1 ? v : v + add)); }
    // snap faster than every shot before it
    if (n >= 2) { const prevMin = Math.min(...d.slice(0, n - 1)); const snapMin = Math.max(need[n - 1], 1.0); d[n - 1] = Math.max(snapMin, Math.min(d[n - 1], prevMin - 0.3));
      if (d[n - 1] >= prevMin) { const lift = d[n - 1] + 0.3; d = d.map((v, i) => (i < n - 1 ? Math.max(v, lift) : v)); } }
    const shots = []; let t = 0;
    d.forEach((v, i) => { const dur = v + (i === n - 2 ? extra : 0); shots.push({ panel: i + 1, start: t, dur, peakHold: i === n - 2 ? extra : 0, silence: !!P[i].silence, snap: i === n - 1 }); t += dur; });
    return { shots, endCard: { start: t, dur: END_CARD }, total: t + END_CARD, body: t };
  }
  function buildShots(p, tm) {
    const P = p.panels; const n = P.length; const prevShots = Array.isArray(p.shots) ? p.shots : [];
    return P.map((pn, i) => {
      const g = prevShots.find((s) => Math.round(num(s.panel, -1)) === pn.n) || prevShots[i] || {};
      const last = i === n - 1; const audio = pn.silence ? 'hard silence' : closest(g.audioCue, AUDIO_CUES, pn.effect === 'ding' ? 'ding' : pn.effect === 'creak' ? 'door' : 'room tone');
      return { n: pn.n, panel: pn.n, startFrame: `still from panel ${pn.n}`, endFrame: last ? 'held pose on the snap' : `still from panel ${pn.n + 1}`, duration: +tm.shots[i].dur.toFixed(2),
        move: pn.silence ? 'hold' : last ? 'snap cut' : pn.cameraMove, actionInMotion: str(g.actionInMotion) || motionText(pn.stage.motion), doNotMove: 'face design, clothing colors, signature items, anchors',
        suspenseTiming: str(g.suspenseTiming) || (pn.silence ? 'held pose, the clue almost shows' : pn.hold ? 'the moment before: ' + pn.hold : ''), audioCue: audio,
        onScreenText: onScreenText(p, pn), transition: last ? 'dip to accent' : (closest(g.transition, TRANSITIONS, 'cut') === 'dip to accent' ? 'cut' : closest(g.transition, TRANSITIONS, 'cut')) };
    });
  }
  function motionText(m) { return { 'head-turn': 'head turn', reach: 'reach', door: 'door', 'phone-light': 'phone light', step: 'one small step', lean: 'lean in', 'look-up': 'look up', jump: 'little hop', 'hand-enter': 'hand entering frame', blink: 'blink', none: 'breathing only' }[m] || 'breathing only'; }
  function assemblyRules(p, tm) {
    const n = p.panels.length; const sil = p.rhythm.silence;
    return [`Drop the music on the silence beat (panel ${sil}): hard silence, no voice, no music.`, `Hold the peak withhold (panel ${n - 1}) an extra half second (${tm.shots[n - 2] ? tm.shots[n - 2].dur.toFixed(1) : '?'} s).`,
      `Cut the snap (panel ${n}) faster than the shots before it (${tm.shots[n - 1].dur.toFixed(1)} s vs >= ${Math.min(...tm.shots.slice(0, n - 1).map((s) => s.dur)).toFixed(1)} s).`, `End card ${END_CARD} s: "${p.social.seriesTitle}" on the accent color (${p.colorScript.accent.hex}).`,
      `Export 1080x1920, H.264, 24 fps, captions burned in (lower third, never over faces), safe margins. Total ${tm.total.toFixed(1)} s.`];
  }
  function lookOf(p, id) { const c = (p.characters || []).find((q) => q.id === id); if (!c) return ''; return `${c.name} (${c.silhouette || 'stick figure'}, ${c.hair === 'none' ? 'no hair' : c.hair + ' hair'}, ${c.clothing || 'top ' + c.top}, ${c.signatureItem || c.item})`; }
  function stillPrompt(p, pn) {
    const cs = p.colorScript; const loc = (p.locations || []).find((l) => l.id === pn.location) || { name: pn.location, anchors: defaultAnchors(pn.location) };
    const colors = `${cs.dominant.name} ${cs.dominant.hex}, ${cs.support.name} ${cs.support.hex}` + (pn.accentAllowed ? `, accent ${cs.accent.name} ${cs.accent.hex} on the clue` : '');
    const who = (pn.stage.chars || []).map((c) => lookOf(p, c.id)).filter(Boolean).join('; ') || 'none in frame';
    return `Pretty colorful stick-figure storyboard frame, flat design, clean black outlines, soft friendly palette of ${colors}, designed simple background, professional comic composition, suspense staging. Location: ${loc.name} with ${loc.anchors.join(', ')}. Characters: ${who}. Action, crop, eyeline: ${pn.action}; ${pn.framing}. Shot: ${pn.shot}. Tension from framing and pose, not horror. Warm and nice. No realism, no detailed anatomy, no text except simple signs.`;
  }

  // ---------------- generation (with validate + repair/retry) ----------------
  function parseJson(text) { const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, ''); const a = t.indexOf('{'); const b = t.lastIndexOf('}'); if (a < 0 || b < a) throw new Error('no JSON object in the reply'); return JSON.parse(t.slice(a, b + 1)); }
  // gen: async (contents, opts) => text (VTS.gemini.generate). Returns { plan, report }.
  async function generate(input, gen, o) {
    o = o || {}; const tries = o.tries || 3; const report = { attempts: [] }; let prev = null; let feedback = null; let best = null;
    for (let a = 0; a < tries; a++) {
      const pr = buildPrompt(Object.assign({}, input, { feedback, previous: prev }));
      if (o.onStatus) o.onStatus(a ? `Fixing ${feedback.length} rule${feedback.length > 1 ? 's' : ''} (try ${a + 1}/${tries})…` : 'Writing the story, suspense plan and storyboard…');
      let raw;
      try { raw = parseJson(await gen([{ role: 'user', parts: [{ text: pr.user }] }], { system: pr.system, json: true, temperature: a ? 0.6 : 0.9, maxTokens: 24000, think: 'low', timeout: 180000 })); } catch (e) { report.attempts.push({ error: String(e.message || e) }); if (e && (e.status || e.friendly) && !/JSON|Unexpected|no JSON/.test(String(e.message))) throw e; feedback = ['the reply was not one valid JSON object']; continue; }
      const v = validate(raw, input); report.attempts.push({ errors: v.errors, fixed: v.fixed.length });
      if (!best || v.errors.length < best.errors.length) best = v;
      if (!v.errors.length) break;
      prev = raw; feedback = v.errors;
    }
    if (!best) throw new Error('Gemini did not return a usable story plan. Try again.');
    // last resort: force the remaining hard errors into shape so the story still renders (reported)
    if (best.errors.length) { const forced = forceRepair(best.plan); const was = best; best = Object.assign(validate(forced, input), { forcedFrom: was.errors }); best.fixed = was.fixed.concat(best.fixed); best.warnings = was.warnings.concat(best.warnings.filter((w) => !was.warnings.includes(w))); }
    report.fixed = best.fixed; report.warnings = best.warnings; report.remaining = best.errors; report.forcedFrom = best.forcedFrom || [];
    best.plan.report = { fixed: best.fixed, warnings: best.warnings, forced: best.forcedFrom || [], attempts: report.attempts.length };
    best.plan.input = { storyline: input.storyline, tone: input.tone || '', beats: Number(input.beats) || 8, platform: input.platform || 'reel', part1: !!input.part1 };
    return { plan: best.plan, report };
  }
  function forceRepair(p) {
    const ids = new Set((p.characters || []).map((c) => c.id)); const sp = (p.spoilerWords || []).map(lc);
    (p.panels || []).forEach((pn, i, a) => {
      if (pn.dialogue && (!ids.has(pn.dialogue.speaker) || words(pn.dialogue.line).length > 10)) pn.dialogue = words(pn.dialogue && pn.dialogue.line).length > 10 && ids.has(pn.dialogue.speaker) ? { speaker: pn.dialogue.speaker, line: words(pn.dialogue.line).slice(0, 8).join(' ') } : null;
      if (pn.dialogue && i < a.length - 1 && sp.some((w) => lc(pn.dialogue.line).includes(w))) pn.dialogue = null;
      if (pn.narration && words(pn.narration).length > 12) pn.narration = words(pn.narration).slice(0, 10).join(' ');
    });
    { const P = p.panels || []; const sn = P[P.length - 1]; const ch = p.characters || []; const hero = ch[0];
      ch.forEach((c) => { if (!sn || P.some((pn) => (pn.dialogue && pn.dialogue.speaker === c.id) || (pn.reply && pn.reply.speaker === c.id))) return;
        if (!sn.dialogue) sn.dialogue = { speaker: c.id, line: c === hero ? 'Oh! It was you!' : `Surprise, ${hero.name}!` }; else if (!sn.reply && sn.dialogue.speaker !== c.id) sn.reply = { speaker: c.id, line: c === hero ? 'Oh! It was you!' : `Surprise, ${hero.name}!` }; }); }
    const so = p.social || {}; if (so.caption && sp.some((w) => lc(so.caption).includes(w))) so.caption = 'Wait for the last frame.'; if (so.cliffhanger && sp.some((w) => lc(so.cliffhanger).includes(w))) so.cliffhanger = '';
    if (!so.caption) so.caption = 'Watch till the end.'; if (!so.seriesTitle) so.seriesTitle = 'The Little Mystery';
    p.suspensePlan = p.suspensePlan || {}; if (!p.suspensePlan.knowledgeGap) p.suspensePlan.knowledgeGap = 'The audience sees the clue before the character does.';
    const n = (p.panels || []).length; const dev = p.suspensePlan.devices || []; const need = [['false calm', 1], ['withheld fact', 2], ['reaction before cause', Math.max(2, n - 3)], ['wide then medium then close-up', Math.max(2, n - 2)], ['cliffhanger hold', Math.max(1, n - 1)]];
    for (const [d, b] of need) if (dev.length < 4 && !dev.find((x) => x.device === d)) dev.push({ device: d, beat: b, how: 'added by the repair step' }); p.suspensePlan.devices = dev;
    p.spine = p.spine || {}; for (const k of SPINE) if (!p.spine[k]) p.spine[k] = (p.panels.find((pn) => pn.spine === k) || {}).action || k;
    return p;
  }

  // ---------------- Markdown (spec output order) ----------------
  function toMarkdown(p) {
    const L = []; const cs = p.colorScript; const n = p.panels.length; const name = (id) => ((p.characters || []).find((c) => c.id === id) || { name: id }).name;
    L.push(`# ${p.social.seriesTitle || 'Story'}`, '', `> ${p.input ? p.input.storyline : ''}`, '');
    L.push('## 1. Assumptions and the withheld question', `- Tone: ${p.assumptions.tone}`, `- Length: ${p.assumptions.length} beats`, `- Platform: ${p.assumptions.platform}`, `- Invented stake: ${p.assumptions.inventedStake || 'none needed'}`);
    (p.assumptions.chosen || []).forEach((c) => L.push(`- Chosen: ${c}`)); L.push(`- **Withheld question:** ${p.assumptions.withheldQuestion}`, '');
    L.push('## 2. Color script', `- Dominant: ${cs.dominant.name} \`${cs.dominant.hex}\``, `- Support: ${cs.support.name} \`${cs.support.hex}\``, `- Accent: ${cs.accent.name} \`${cs.accent.hex}\` (only on tension spikes and the snap: panels ${p.panels.filter((x) => x.accentAllowed).map((x) => x.n).join(', ')})`, cs.note ? `- ${cs.note}` : '', '');
    L.push('## 3. Character lock');
    p.characters.forEach((c) => L.push(`### ${c.name}`, `- Role: ${c.role}`, `- Silhouette: ${c.silhouette}`, `- Hair: ${c.hair}${c.hair !== 'none' ? ' `' + c.hairColor + '`' : ''}`, `- Clothing: ${c.clothing || ''} (top \`${c.top}\`, bottom \`${c.bottom}\`)`, `- Signature item: ${c.signatureItem || c.item}`, `- Personality: ${c.personality}`, `- Stress tell: ${c.stressTell} (gets bigger as suspense rises)`, `- Voice (locked): **${c.voice}** - ${c.voiceWhy || ''}`, ''));
    if (p.narrator && p.narrator.use) L.push(`Narrator voice: **${p.narrator.voice}** - ${p.narrator.why || ''}`, '');
    L.push('## 4. Location lock'); p.locations.forEach((l) => L.push(`### ${l.name}`, `- Anchors: ${l.anchors.join('; ')}`, `- Time of day: ${l.timeOfDay}`, `- Palette: ${l.palette || ''}`, `- Suspense feature: ${l.suspenseFeature}`, ''));
    L.push('## 5. Suspense plan', `- Withheld question: ${p.suspensePlan.withheldQuestion}`, `- Knowledge gap: ${p.suspensePlan.knowledgeGap}`); p.suspensePlan.devices.forEach((d) => L.push(`- ${d.device} -> beat ${d.beat}${d.how ? ': ' + d.how : ''}`)); L.push('');
    L.push('## 6. Story spine'); SPINE.forEach((k) => L.push(`- **${k}:** ${p.spine[k]}`)); L.push('');
    L.push('## 7. Thumbnail storyboard'); p.thumbnails.forEach((t, i) => L.push(`${i + 1}. ${String(t).replace(/^\d+\.\s*/, '')}`));
    L.push('', `Rhythm: false calm ${(p.rhythm.falseCalm || []).join(', ') || '-'}; silence ${p.rhythm.silence}; snap ${p.rhythm.snap}. ${p.rhythm.note || ''}`, `Pause points: ${p.pausePoints.join(', ')}`, '');
    L.push('## 8. Full panels');
    p.panels.forEach((pn) => L.push(`### PANEL ${pn.n} — ${pn.location}`, `- SHOT: ${pn.shot}${pn.transitionShot ? ' (transition shot)' : ''}`, `- FRAMING: ${pn.framing}`, `- COLOR: ${pn.color || ''} (accent ${pn.accentAllowed ? 'allowed' : 'not allowed'})`, `- SUSPENSE BEAT: ${pn.suspenseBeat} (${pn.mood}, tension ${pn.tension}/5)`, `- ACTION: ${pn.action}`,
      `- DIALOGUE: ${pn.dialogue ? name(pn.dialogue.speaker) + ': "' + pn.dialogue.line + '"' + (pn.reply ? ' / ' + name(pn.reply.speaker) + ': "' + pn.reply.line + '"' : '') + ' (' + pn.delivery + ')' : 'NONE'}`, pn.narration ? `- NARRATOR: "${pn.narration}"` : '', `- EFFECT: ${pn.effect}`, `- CAPTION: ${pn.caption || (pn.dialogue || pn.reply ? 'the spoken line (burned in word for word)' : 'none')}`, `- DURATION: ${pn.duration} s${pn.n === n - 1 ? ' (incl. +0.5 s peak hold)' : ''}`, `- CAMERA MOVE: ${pn.cameraMove}`, `- BOARD NOTES: ${pn.boardNotes || ''}${(pn.stage.chars || []).length ? ' [poses: ' + pn.stage.chars.map((c) => name(c.id) + ' ' + (c.arms || 'idle') + (c.holds ? ' + ' + c.holds : '')).join(', ') + ']' : ''}`, `- HOLD: ${pn.hold || ''}`, ''));
    L.push('## 9. Still image prompts'); p.stillPrompts.forEach((s, i) => L.push(`${i + 1}. ${s}`)); L.push('');
    L.push('## 10. Video shot list and assembly'); p.shots.forEach((s) => L.push(`### SHOT ${s.n} — panel ${s.panel}`, `- START FRAME: ${s.startFrame}`, `- END FRAME: ${s.endFrame}`, `- DURATION: ${s.duration} s`, `- MOVE: ${s.move}`, `- ACTION IN MOTION: ${s.actionInMotion}`, `- DO NOT MOVE: ${s.doNotMove}`, `- SUSPENSE TIMING: ${s.suspenseTiming}`, `- AUDIO CUE: ${s.audioCue}`, `- ON-SCREEN TEXT: ${s.onScreenText}`, `- TRANSITION: ${s.transition}`, ''));
    L.push('Assembly rules:'); p.assembly.forEach((a) => L.push(`- ${a}`)); L.push('');
    const so = p.social; L.push('## 11. Social packaging', `- Series title: ${so.seriesTitle}`, `- Panel 1 hook text: ${so.hookText}`, `- Cliffhanger: ${so.cliffhanger || 'none (standalone)'}`, `- End card line: ${so.endCardLine}`, `- Hashtags: ${so.hashtags.join(' ')}`, `- Post caption: ${so.caption}`, `- Art direction: ${so.artDirection || ''}`, '');
    if (p.report && (p.report.fixed.length || p.report.forced.length)) { L.push('---', '_Engine checks: ' + p.report.fixed.length + ' auto-repairs' + (p.report.forced.length ? ', forced: ' + p.report.forced.join('; ') : '') + '._'); }
    return L.filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
  }
  function socialCaption(p) { return `${p.social.caption}\n\n${p.social.hashtags.join(' ')}`; }

  // voice lines of a plan (what the TTS cast reads), in order
  function voiceLines(p) {
    const out = [];
    p.panels.forEach((pn, i) => {
      if (pn.silence) return;
      // pn.voiceDirection = { <who>: 'extra read direction' } (a director's note for one line, e.g. a re-take: 'a touch slower')
      const dir = (who) => { const d = pn.voiceDirection && pn.voiceDirection[who]; return d ? { direction: String(d) } : {}; };
      if (p.narrator && p.narrator.use && pn.narration) out.push(Object.assign({ panel: i, who: 'narrator', voice: p.narrator.voice, text: pn.narration, delivery: i === 0 ? 'curious' : pn.delivery === 'whisper' ? 'tense' : 'warm' }, dir('narrator')));
      if (pn.dialogue) { const c = p.characters.find((q) => q.id === pn.dialogue.speaker); if (c) out.push(Object.assign({ panel: i, who: c.id, voice: c.voice, text: pn.dialogue.line, delivery: pn.delivery }, dir(c.id))); }
      if (pn.reply) { const c = p.characters.find((q) => q.id === pn.reply.speaker); if (c) out.push(Object.assign({ panel: i, who: c.id, voice: c.voice, text: pn.reply.line, delivery: pn.delivery }, dir(c.id))); }
    });
    return out;
  }
  function styleFor(p, who, delivery, direction) {
    const c = (p.characters || []).find((q) => q.id === who); const d = DELIVERY[delivery] || DELIVERY.light; const x = direction ? '; ' + String(direction).trim().replace(/\.$/, '') : '';
    if (who === 'narrator' || !c) return `Narrate like a warm storybook narrator, ${d}${x}`;
    const age = lc(c.voiceHint && c.voiceHint.age); const kid = /child|kid/.test(age) ? 'like a young kid, ' : /teen/.test(age) ? 'like a teenager, ' : /older/.test(age) ? 'like a kind older person, ' : '';
    return `Say it ${kid}as ${c.name}, ${lc(c.personality).replace(/\.$/, '')}: ${d}${x}`;
  }

  const api = { LOCATIONS, FEATURES, DEVICES, SHOTS, MOVES, EFFECTS, SPINE, MOODS, PLATFORMS, TONES, HAIR, ITEMS, POSES, ARM_POSES, EYES, SYMBOLS, CLUES, MOTIONS, DELIVERY, VOICES, NICE_PALETTES, END_CARD, LINE_LEAD, LINE_TAIL,
    SPEC, buildPrompt, validate, generate, syncCaptions, captionMismatches, onScreenText, poseFor, mapPoses, refresh, parseJson, timing, toMarkdown, socialCaption, voiceLines, styleFor, stillPrompt, castVoices, friendlyColor, shade, deepen, hsl, defaultAnchors, closest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.VTS = root.VTS || {}; root.VTS.story = api; }
}(typeof window !== 'undefined' ? window : null));
