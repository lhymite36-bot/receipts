/* Turns a rambling idea into a Short package (structured JSON), plus caption-beat helpers. */
(function () {
  'use strict';
  const VTS = (window.VTS = window.VTS || {});

  const TONES = {
    deadpan: { label: 'Deadpan receipts', funny: true, prompt: 'Deadpan and dry: flat, unimpressed, slightly smug "got the receipt" energy. Short sentences. Stamp the claim, drop the fact, move on. No exclamation marks. Never therapy-speak.' },
    sarcastic: { label: 'Sharp smug', funny: true, prompt: 'Dry, sharp, slightly smug myth-buster: tease the viral claim (not the viewer), then drop a clean fact. Comic timing. "People say X. Cute. Here\'s the receipt." Kind underneath, never mean.' },
    genz: { label: 'Chaotic Gen-Z', funny: true, prompt: 'Chaotic Gen-Z internet voice: fast, meme-literate ("be so fr", "receipts or it didn\'t happen", "not me believing that"), playful exaggeration about viral claims. Keep slang light; never mean.' },
    roast: { label: 'Roast the claim', funny: true, prompt: 'Gently roast the viral claim / influencer who posted it, then drop the real fact. Tease the claim, never identity, looks, or mental-health conditions.' },
    calm: { label: 'Calm explainer', prompt: 'Calm, clear explainer. Short sentences. Fact first, joke second. Never preachy.' },
    bold: { label: 'Bold stamp', prompt: 'Bold, direct, high-energy myth-bust. Punchy sentences, hard cuts in the wording, a little provocative but never rude.' },
    soft: { label: 'Soft', prompt: 'Soft, gentle, clear. Still myth-busting — just kinder delivery.' },
  };
  const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Hindi', 'Indonesian', 'Filipino', 'Swahili', 'Arabic', 'Japanese', 'Korean'];

  // Video formats (templates). step numbers: 0 = hook/body, 1-3 = numbered items (badge "LABEL n OF 3"), 4 = CTA.
  const FORMATS = {
    classic: { label: 'Hook + 3 receipts + CTA', badge: 'RECEIPT', prompt: 'Structure: hook naming a viral claim, then exactly 3 numbered receipts ("One", "Two", "Three") each busting a related myth with a concrete fact, then a CTA. Steps use step 1/2/3.' },
    'people-say': { label: 'People say…', badge: '', prompt: 'Format "People say…": open with "People say X" (the viral claim), then dryly dismantle it with 2-3 beats of evidence, then one clear fact and a smug closer. Use fx "myth-fact" on the stamp beats. Mostly step 0. No psychology/self-help framing.' },
    'got-receipts': { label: 'Got receipts', badge: '', prompt: 'Format "Got receipts": hook is a bold false claim the internet loves; then drop receipts one by one (sources, logic, counter-examples) with dry humour; end with a stamp line and CTA "which claim should I stamp next?". Mostly step 0.' },
    'skeptic-vs-claim': { label: 'Skeptic vs Claim Guy', badge: '', prompt: 'Format "Skeptic vs Claim Guy": comic argument. Claim Guy (speaker "brain" — smug influencer energy, overselling the myth) vs Skeptic (speaker "me" — dry, receipt-dropping). Alternate short lines; narrator once names the real fact; Skeptic gets the last stamp line before CTA. Each beat is ONE speaker. Mostly step 0. NEVER use a pink Brain character — Claim Guy is a loud human.' },
    'stamp-it': { label: 'Stamp it', badge: 'STAMP', prompt: 'Format "Stamp it": 3 viral claims (steps 1-3). For each: state the claim, then stamp MYTH or FACT (fx "myth-fact", fxText "MYTH" or "FACT") with a one-line receipt. Dry and punchy.' },
    'myth-fact': { label: 'Myth vs Fact', badge: 'MYTH', prompt: 'Format "Myth vs Fact": 3 popular science / money / internet myths (steps 1-3); for each, say the myth (fx "myth-fact", fxText "MYTH"), then the fact (fx "myth-fact", fxText "FACT") with a real explanation. Only well-established facts; no invented numbers. Niche: science myths, money myths, viral internet claims — NOT psychology/self-help.' },
    pov: { label: 'POV:', badge: '', prompt: 'Format "POV": hook starts with "POV:" and puts the viewer inside the moment they believed a viral claim, escalate with 2-3 beats, then the receipt (real fact) and a dry closer. Use fx "freeze" once. Mostly step 0.' },
    'nobody-me': { label: 'Nobody: / Me:', badge: '', prompt: 'Format "Nobody: / Me:": hook is "Nobody:" then "Me:" falling for a viral claim (speaker "me"), then narrator drops the receipt and a smarter alternative. Mostly step 0.' },
    expectation: { label: 'Expectation vs Reality', badge: '', prompt: 'Format "Expectation vs Reality": expectation = the viral claim / influencer promise; reality = what actually happens; then the fact; then a realistic takeaway. Use fx "split" with fxText "Expectation|Reality". Mostly step 0.' },
    rating: { label: 'Rating viral claims', badge: 'CLAIM', prompt: 'Format "Rating viral claims": rate 3 viral claims out of 10 with dry humour and a one-line receipt each (steps 1-3, fx "rating" with fxText "Claim|score").' },
    signs: { label: '3 fake facts you still believe', badge: 'FAKE', prompt: 'Format "3 fake facts you still believe": hook names the niche, then 3 viral falsehoods (steps 1-3) with a funny example and the real fact each. CTA "which one did you believe?".' },
    storytime: { label: 'Storytime', badge: '', prompt: 'Format "Storytime": short first-person story about falling for (or fact-checking) a viral claim, a twist, then the receipt and one takeaway. Mostly step 0. Characters: me, friend, boss, claim-guy (speaker "brain") — never a therapist or pink Brain.' },
  };
  const HUMOUR = ['Straight (no jokes)', 'Light smile', 'Funny', 'Unhinged (still kind)'];
  const HUMOUR_PROMPT = [
    'Humour: none. Warm and clear, no jokes.',
    'Humour: light. One or two gentle, relatable smiles; mostly teaching.',
    'Humour: funny. A joke or sarcastic aside every 2-3 lines, relatable exaggeration, one clear punchline (punch true).',
    'Humour: unhinged but kind. Rapid-fire jokes, absurd escalation, meme energy, 2-3 punchlines (punch true), stickers on punchlines. Still accurate and never mean.',
  ];
  const COMEDY_RULES = [
    'You write for "Receipts": a faceless, animated myth-busting channel on TikTok and YouTube Shorts. Niche: science myths, money myths, viral internet claims. Tone: dry, sharp, slightly smug "got receipts" energy. NOT psychology, self-help, therapy, overthinking, or social awkwardness.',
    'Goals: stop the scroll in 1-2 seconds, make people laugh at a viral claim they believed, teach ONE real fact accurately, and make them comment, share and rewatch.',
    'Hook: max 12 words, first 1-2 seconds, name the claim ("People say X…") or stump them with a bold counter-claim. No greetings, no "in this video", no "hey guys".',
    'Pattern interrupts: a new beat every 2-3 seconds; alternate setup / punchline; stamp overlays (fx myth-fact) on reveal beats; use fx on at most 1 in 3 beats.',
    'Accuracy: only well-established facts. Never invent studies, statistics, percentages or experts. No medical advice or diagnosis. Jokes target the claim and the hype, never identities or looks.',
    'Cast: optional Skeptic (speaker "me") and Claim Guy (speaker "brain" — a loud human who oversells myths, NOT a pink Brain sidekick). Narrator for facts. No therapist character.',
    'Loop: the last line should flow back into the first line so a rewatch feels seamless.',
    'CTA: comment-bait ("which claim should I stamp next?", "send this to the friend who still believes this", "receipt or myth — comment below"). Never beg for likes.',
    'Spoken text is what the AI voice reads: no emoji, no hashtags, no stage directions, no speaker labels inside "script" or beat text.',
    'Write for the EAR (it is performed by expressive AI voices): one idea per beat, mostly 3-12 words; contractions; vary the rhythm (a quick run of short lines, then a one- or two-word beat like "Cute." / "Wrong." / "Buddy."); use 2-3 interjections ("Oh no.", "Wait.", "Sir.", "Okay, so…", "Yeah, no."); set up, then put the punchline alone in its own beat (punch true). Never split a sentence or a phrase across beats.',
    'Claim Guy: when he is in the cast give him at least 3 short, loud, overconfident lines ("Trust me, bro.", "I saw it on a poster!", "Science says so. Probably.") that the Skeptic flattens with a dry receipt.',
  ].join('\n');

  const SYSTEM = [
    'You are a top YouTube Shorts scriptwriter for Receipts: a faceless myth-busting channel (dry comic voiceover over bold comic-ink visuals).',
    'Every Short follows this proven structure:',
    '1) HOOK (first 1-2 seconds, max 14 words): name a viral claim or open a curiosity gap. No greetings, no "in this video".',
    '2) METHOD: exactly 3 numbered receipts ("One", "Two", "Three"), each busting a myth with a concrete fact.',
    '3) SOFT CTA: one dry line, e.g. "Stamp the claim you believed" or "Follow for more receipts". Never beg.',
    'Rules: the full voiceover script is 80 to 110 words (about 30-45 seconds spoken). Spoken, natural language; contractions welcome.',
    'Grounded in real science / money / internet facts; do not invent studies, statistics or names; no medical or diagnostic claims. Never psychology/self-help framing.',
    'Return ONLY JSON matching the schema.',
  ].join('\n');

  const T = { STRING: 'STRING', NUMBER: 'NUMBER', INTEGER: 'INTEGER', ARRAY: 'ARRAY', OBJECT: 'OBJECT', BOOLEAN: 'BOOLEAN' };
  const SC = () => VTS.scenes;
  function sceneSchema() {
    const s = SC();
    return {
      type: T.OBJECT,
      description: 'The animated 2D cartoon scene shown while this caption is spoken, chosen ONLY from the allowed values.',
      properties: {
        setting: { type: T.STRING, enum: s.SET_IDS },
        pose: { type: T.STRING, description: 'Action id from the allowed list in the prompt that literally shows the main keyword.' },
        emotion: { type: T.STRING, enum: s.EMO_IDS, description: 'Exaggerated cartoon expression of the speaker.' },
        props: { type: T.ARRAY, description: '0-3 prop ids from the list in the prompt.', items: { type: T.STRING } },
        camera: { type: T.STRING, enum: s.CAM_IDS },
        callout: { type: T.STRING, description: 'Optional 1-3 word label, usually empty.' },
        keywords: { type: T.ARRAY, description: '1-3 literal drawable keywords said in this beat.', items: { type: T.STRING } },
        objects: { type: T.ARRAY, description: '0-3 visible objects (nouns).', items: { type: T.STRING } },
        icon: { type: T.STRING, description: 'One emoji for the main keyword.' },
        characters: { type: T.INTEGER, description: '1; 2 for a conversation or two people (waving, walking-toward, high-five); 3 = also someone standing behind the main character.' },
        weather: { type: T.STRING, enum: (s.WEATHER_IDS || ['none']).slice(), description: 'Outdoor weather overlay; omit to auto-match the mood.' },
      },
      required: ['setting', 'pose', 'emotion', 'props', 'camera'],
    };
  }
  const SCENE_RULES = [
    'Scenes: every beat gets a "scene" for a faceless myth-busting channel animated in bold comic-ink 2D (cream paper, ink outlines, stamp-red accents).',
    'Illustrate the words literally (e.g. "people say MSG is poison" -> kitchen or cafe with checklist; "stamp MYTH" -> void with exclamation; "money myth" -> office with cash/checklist; viral phone claim -> phone-screen). Prefer hard, readable props over soft psychology props.',
    'Keep the SAME setting for consecutive beats of one idea (change setting every 2-4 beats, never every beat). Vary pose/emotion/props within a setting to follow the words.',
    'KEYWORDS FIRST: for every beat list the literal keywords actually spoken, then choose the action (pose), props and setting so the MAIN keyword is clearly visible on screen. Prefer literal over metaphorical (a line about sketching shows the character drawing in a sketchbook with a pencil, not a lightbulb). If no action or prop can show it, use setting "keyword-card" with an icon emoji of the keyword.',
    'The problem/hook uses tense emotions; the steps move toward calm/happy; the CTA is talking or celebrating with heart or speech-bubbles. Use camera "zoom-in" for dramatic lines, "shake" for stress, "pan" for walking, otherwise "static". Max 3 props.',
    SC() ? 'Allowed pose ids (use only these exact ids in "pose"): ' + SC().POSE_IDS.join(', ') + '.' : '',
    'Multi-character poses: waving (one arm; characters 2 = both wave; characters 3 adds a person standing behind the main character, e.g. "you waved back at someone who was waving at the person behind you"), walking-toward (two people approach from far apart, e.g. hallway; add prop phone if the main character pretends to scroll), high-five. driving uses setting car-interior (add prop car-radio for turning the music down). Weather (optional): rain, storm, sun, snow, fog, wind, overcast, sunset, stars, or none; it is drawn over outdoor places and auto-matched to the mood when omitted.',
    SC() ? 'Allowed prop ids (use only these exact ids in "props"; anything else goes in "objects"/"keywords"): ' + SC().PROP_IDS.join(', ') + '.' : '',
  ].filter(Boolean).join('\n');
  const SPEAKERS = ['narrator', 'me', 'brain', 'friend', 'boss', 'crush', 'mom', 'cat']; // brain = Claim Guy (loud myth-seller), me = Skeptic; no therapist / no pink Brain
  const FX_IDS = ['none', 'zoom-punch', 'freeze', 'spotlight', 'impact', 'split', 'before-after', 'chat', 'notification', 'loading', 'xp', 'checklist', 'rating', 'argument', 'myth-fact', 'countdown', 'typing-delete'];
  const SFX_IDS = ['none', 'whoosh', 'pop', 'ding', 'boom', 'scratch', 'boing', 'bruh', 'trombone', 'laugh', 'typing', 'notif', 'heartbeat', 'tick', 'cash', 'levelup', 'wrong', 'tada', 'riser'];
  const SCHEMA = {
    type: T.OBJECT,
    properties: {
      hooks: { type: T.ARRAY, description: '3 alternative spoken hooks, strongest first; script starts with hooks[0].', items: { type: T.STRING } },
      script: { type: T.STRING, description: 'Full voiceover: hooks[0], body, CTA.' },
      beats: {
        type: T.ARRAY,
        description: 'Consecutive beats splitting the script verbatim, covering all of it.',
        items: {
          type: T.OBJECT,
          properties: {
            text: { type: T.STRING, description: 'Verbatim script words.' },
            weight: { type: T.NUMBER, description: 'Spoken words count.' },
            step: { type: T.INTEGER, description: '0 hook/body, 1-3 numbered item, 4 CTA.' },
            emphasis: { type: T.STRING, description: 'Key word copied exactly, or empty.' },
            visual: { type: T.STRING, description: 'Short visual idea.' },
            speaker: { type: T.STRING, enum: SPEAKERS, description: 'Who says it.' },
            fx: { type: T.STRING, enum: FX_IDS, description: 'Meme overlay, mostly none.' },
            fxText: { type: T.STRING, description: 'Overlay text (see prompt), or empty.' },
            sfx: { type: T.STRING, enum: SFX_IDS },
            sticker: { type: T.STRING, description: '1-3 word reaction sticker or emoji, usually empty.' },
            punch: { type: T.BOOLEAN, description: 'true on punchlines.' },
          },
          required: ['text', 'weight', 'step', 'visual'],
        },
      },
      textHook: { type: T.STRING, description: 'First-frame on-screen text, max 7 words.' },
      title: { type: T.STRING, description: 'YouTube Shorts title, under 70 chars.' },
      description: { type: T.STRING, description: 'YouTube description, 2-4 lines + CTA, no hashtags.' },
      hashtags: { type: T.ARRAY, description: 'YouTube: 3-6 hashtags incl. #Shorts.', items: { type: T.STRING } },
      tiktokCaption: { type: T.STRING, description: 'TikTok caption, 1-2 lines ending in a question, no hashtags.' },
      tiktokHashtags: { type: T.ARRAY, description: 'TikTok: 3-5 hashtags.', items: { type: T.STRING } },
      cta: { type: T.STRING, description: 'On-screen CTA sticker, max 8 words, may end with one emoji.' },
      pinnedComment: { type: T.STRING, description: 'Pinned comment that invites replies.' },
      thumbnailText: { type: T.STRING, description: '2-5 word cover text.' },
    },
    required: ['hooks', 'script', 'beats', 'title', 'description', 'hashtags', 'pinnedComment', 'thumbnailText'],
  };

  // ---------- video length ----------
  const LENGTHS = [
    { id: '30', label: '~30 s Short', sec: 30, words: [70, 85], beats: [9, 14] },
    { id: '60', label: '~60 s Short', sec: 60, words: [120, 140], beats: [14, 24] },
    { id: '120', label: '2 min', sec: 120, words: [250, 300] },
    { id: '300', label: '5 min', sec: 300, words: [640, 740] },
    { id: '600', label: '10 min', sec: 600, words: [1300, 1450] },
    { id: '900', label: '15 min', sec: 900, words: [1950, 2150] },
    { id: '1200', label: '20 min', sec: 1200, words: [2600, 2850] },
  ];
  const lengthOf = (id) => LENGTHS.find((l) => l.id === String(id)) || LENGTHS[1];
  const isLong = (id) => lengthOf(id).sec >= 300;
  const SYSTEM_LONG = [
    'You are an expert YouTube scriptwriter for Receipts: a faceless myth-busting / explainer channel (dry voiceover over bold comic-ink 2D scenes).',
    'Long videos: a strong hook in the first 10 seconds, a promise of what the viewer will get, clear sections that each teach one idea with concrete examples and actions, smooth transitions, and a short soft CTA at the very end.',
    'Spoken, natural language; contractions welcome; short sentences that are easy to caption. Grounded; do not invent studies, statistics or names; no medical or diagnostic claims.',
    'Return ONLY JSON matching the schema.',
  ].join('\n');

  function schemaWithScenes() {
    if (!SC()) return SCHEMA;
    const sch = JSON.parse(JSON.stringify(SCHEMA)); const it = sch.properties.beats.items;
    // The scene object already describes the visual: drop the free-text "visual" (about 15% of the reply) in scene mode.
    delete it.properties.visual; it.required = it.required.filter((k) => k !== 'visual');
    it.properties.scene = sceneSchema(); it.required.push('scene'); return sch;
  }
  // Comedy path (v1.4): any funny tone, any non-classic format, or humour > 0.
  const isComedy = (opts) => { const t = TONES[opts && opts.tone]; const h = opts && opts.humour != null ? Number(opts.humour) : (t && t.funny ? 2 : 0); return !isLong(opts && opts.length) && ((t && t.funny) || (opts && opts.format && opts.format !== 'classic') || h > 0); };
  const humourOf = (opts) => { const t = TONES[opts && opts.tone]; const h = opts && opts.humour != null ? Number(opts.humour) : (t && t.funny ? 2 : 0); return Math.max(0, Math.min(3, Math.round(h))); };
  function buildComedyPrompt(idea, opts) {
    const tone = TONES[opts.tone] || TONES.sarcastic; const L = lengthOf(opts.length); const F = FORMATS[opts.format] || FORMATS.classic; const bt = L.beats || [14, 24];
    return [
      'Turn my idea below into a ' + L.label + ' vertical video package for TikTok and YouTube Shorts (posted to both).',
      'Format: ' + F.prompt,
      'Tone: ' + tone.prompt,
      HUMOUR_PROMPT[humourOf(opts)],
      'Length: the script is ' + L.words[0] + '-' + L.words[1] + ' words (about ' + L.sec + ' seconds spoken, never more). Beats: ' + bt[0] + '-' + bt[1] + ' beats; each beat is one sentence or clause of 3-12 words with ONE speaker, text copied verbatim from the script, in order, covering all of it; weight = spoken words.',
      'Per beat: speaker (narrator | me = Skeptic / viewer | brain = Claim Guy, a loud human who oversells myths — NOT a pink Brain | friend | boss | crush | mom | cat). scene.emotion is an exaggerated cartoon expression of the speaker (eye-roll, side-eye, shocked, crying-laughing, smug, dead-inside, panicking, blushing, rage, facepalm, or the basic ones). punch = true on punchlines. sticker = optional 1-3 word reaction (BRUH, WAIT WHAT, NOT AGAIN, SIR??, IT ME, or one emoji like 💀 😭) on at most 3 beats. sfx: boom on dramatic reveals, scratch before a "wait", bruh on facepalms, ding on tips, typing/notif on phone moments, cash for money, heartbeat for anxiety, tick for time pressure, trombone for fails, else none.',
      'fx overlays (at most 1 in 3 beats, never two in a row) with fxText: zoom-punch (optional short caption), freeze (caption like "Yep. That\'s me."), spotlight (short label), impact (1-2 word POW text), split ("Expectation|Reality"), before-after ("Before|After"), chat (2-4 texts "Name: message|me: message"), notification ("App: message"), loading ("Loading motivation…"), xp ("+50 XP · Self-respect"), checklist ("item|item|item"), rating ("Habit|score/10"), argument ("Me: line|Brain: line"), myth-fact ("MYTH" or "FACT"), countdown ("5 second rule"), typing-delete (a long text typed then deleted and replaced: "Bestie: you up?|me: long paragraph you never send|lol").',
      'textHook: 3-7 words of on-screen text for the very first frame that makes people stay (different wording from the spoken hook; e.g. "POV: it\'s 3 a.m. again" or "your brain at 3am:").',
      'Platform text: YouTube title + description + 3-6 hashtags including #Shorts; TikTok tiktokCaption (short, conversational, ends with a question) + 3-5 tiktokHashtags (one broad like #mythbusting plus niche ones); cta for the on-screen sticker (e.g. "Follow for more receipts 🧾"); pinnedComment; thumbnailText.',
      'Language for every field: ' + (opts.language || 'English') + '.',
      opts.handle ? 'Channel handle (only in the CTA if natural): ' + opts.handle : '',
      SC() ? SCENE_RULES + '\nFor two-character beats (Skeptic vs Claim Guy / friend/boss/…) use pose talking or arguing, characters 2, and the same setting for the whole conversation. Claim Guy = speaker brain (human, not pink Brain).' : '',
      '',
      'My idea (dictated, may be messy):',
      '"""',
      String(idea || '').trim().slice(0, 24000),
      '"""',
    ].filter((l) => l !== '').join('\n');
  }
  function buildPrompt(idea, opts) {
    if (isComedy(opts)) return buildComedyPrompt(idea, opts);
    const tone = TONES[opts.tone] || TONES.calm; const L = lengthOf(opts.length);
    return [
      L.sec <= 60 ? 'Turn my rambling idea below into a complete YouTube Short package. The full voiceover script is ' + L.words[0] + '-' + L.words[1] + ' words.' : 'Turn my idea below into a complete ' + L.label + ' YouTube video package. Ignore the 80-110 word rule: the script must be ' + L.words[0] + '-' + L.words[1] + ' words (about ' + L.label + ' spoken); use as many numbered steps as fit naturally (3-5).',
      'Tone: ' + tone.prompt,
      'Language for every field: ' + (opts.language || 'English') + '.',
      opts.handle ? 'Channel handle (only use in the CTA if natural): ' + opts.handle : '',
      L.sec <= 60 ? 'Beats: 12 to 22 beats. Hook beats use step 0, CTA beats use step 4.' : 'Beats: one beat per 3-6 spoken words, covering the whole script. Hook beats use step 0, steps 1-3 for the first three steps (later steps use 3), CTA beats use step 4.',
      'Beat rule: Each beat text must be copied verbatim from the script so captions match the voice.',
      SC() ? SCENE_RULES : '',
      '',
      'My idea (dictated, may be messy):',
      '"""',
      String(idea || '').trim().slice(0, 24000),
      '"""',
    ].filter((l) => l !== '').join('\n');
  }

  // ---------- text helpers ----------
  const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
  const wordCount = (s) => words(s).length;
  function normHashtag(h) {
    const t = String(h || '').trim().replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    return t ? '#' + t : '';
  }
  function splitHook(hookText) {
    // First sentence(s) of the script that equal the hook.
    return String(hookText || '').trim();
  }

  const STEP_RE = /^(?:step\s*)?(one|two|three|first|second|third|1|2|3)\b[\s.:,)\-–—]*/i;
  const CTA_RE = /\b(follow|save this|subscribe|comment|share this|like|send this|for more)\b/i;
  const stepNum = (w) => ({ one: 1, first: 1, '1': 1, two: 2, second: 2, '2': 2, three: 3, third: 3, '3': 3 })[String(w).toLowerCase()] || 0;

  // Split text into caption chunks (2-6 words), breaking at punctuation where possible.
  function chunkText(text, maxWords) {
    maxWords = maxWords || 5;
    const out = [];
    const sentences = String(text || '').replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]*["”’)]?\s*/g) || [];
    for (const sRaw of sentences) {
      const s = sRaw.trim(); if (!s) continue;
      const parts = s.split(/(?<=[,;:—–])\s+/);
      for (const p of parts) {
        const w = words(p);
        if (!w.length) continue;
        const n = Math.ceil(w.length / maxWords);
        const size = Math.ceil(w.length / n);
        for (let i = 0; i < w.length; i += size) out.push(w.slice(i, i + size).join(' '));
      }
    }
    // Merge single-word leftovers into their neighbour.
    for (let i = out.length - 1; i > 0; i--) {
      if (wordCount(out[i]) === 1 && wordCount(out[i - 1]) < maxWords + 1) { out[i - 1] += ' ' + out[i]; out.splice(i, 1); }
    }
    return out;
  }

  // Rebuild beats from the script text using simple heuristics (hook / steps / CTA).
  function beatsFromScript(script, hook, oldBeats) {
    const text = String(script || '').replace(/\s+/g, ' ').trim();
    if (!text) return [];
    const sentences = text.match(/[^.!?…]+[.!?…]*["”’)]?\s*/g) || [text];
    let step = 0;
    const out = [];
    const hookWords = wordCount(hook);
    let spoken = 0;
    const visuals = (oldBeats || []).map((b) => b.visual).filter(Boolean);
    sentences.forEach((sRaw, si) => {
      const s = sRaw.trim(); if (!s) return;
      const m = STEP_RE.exec(s);
      if (m && stepNum(m[1]) && spoken >= Math.max(1, hookWords - 1)) step = stepNum(m[1]);
      const isLast = si === sentences.length - 1;
      let sStep = step;
      if (spoken < hookWords) sStep = 0;
      else if (step >= 3 && CTA_RE.test(s) && (isLast || si >= sentences.length - 2) && !m) sStep = 4;
      else if (step === 0 && isLast && CTA_RE.test(s)) sStep = 4;
      for (const c of chunkText(s)) out.push({ text: c, weight: wordCount(c), step: sStep, emphasis: '', visual: '' });
      spoken += wordCount(s);
    });
    const scenes = (oldBeats || []).map((b) => b.scene).filter(Boolean);
    out.forEach((b, i) => { b.visual = visuals[Math.min(visuals.length - 1, Math.round(i * visuals.length / out.length))] || defaultVisual(b.step); });
    // keep the old scene plan where it lines up proportionally, otherwise infer from the words
    out.forEach((b, i) => { if (scenes.length) b.scene = JSON.parse(JSON.stringify(scenes[Math.min(scenes.length - 1, Math.floor(i * scenes.length / out.length))])); });
    attachScenes(out);
    return out;
  }
  // Validate every beat's scene (unknown values are repaired; missing scenes are inferred from the words with continuity).
  function attachScenes(beats, force) {
    const s = SC(); if (!s) return beats;
    let prev = null;
    beats.forEach((b) => { b.scene = s.normalizeScene(force ? null : b.scene, b.text, b.step, prev); prev = b.scene; });
    if (s.diversify) s.diversify(beats.map((b) => b.scene)); // long videos: no endless repeats of one scene
    return beats;
  }
  function defaultVisual(step) {
    return ['Slow push-in on a moody sky or city at night', 'Hands writing in a journal, soft window light', 'Person walking alone, golden hour, shallow focus', 'Calm ocean waves in slow motion', 'Warm lamp-lit desk with a cup of tea'][step] || 'Abstract light leaks';
  }

  function toStr(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 5000); }
  // Close a JSON reply that was cut off mid-way (MAX_TOKENS): drop a dangling key / half value, close the open
  // string, then close every open array/object in order. Returns a string (may still be invalid; caller parses).
  function repairJSON(text) {
    let raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const st = raw.indexOf('{'); if (st < 0) return raw; raw = raw.slice(st);
    const stack = []; let inStr = false; let esc = false; let lastSafe = 0; let safeStack = [];
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
      else if (c === '}' || c === ']') { stack.pop(); lastSafe = i + 1; safeStack = stack.slice(); }
      else if (c === ',') { lastSafe = i; safeStack = stack.slice(); }
    }
    if (!stack.length && !inStr) return raw;
    // Prefer closing a cut string in place when it is an array item or a value (keeps the partial script text),
    // otherwise cut back to the last complete element.
    let out = raw;
    if (inStr) { if (esc) out = out.slice(0, -1); out += '"'; }
    out = out.replace(/,\s*$/, '').replace(/:\s*$/, ': ""').replace(/,\s*"[^"]*"\s*$/, '');
    const tryClose = (body, stk) => body.replace(/[,\s]+$/, '') + stk.slice().reverse().join('');
    const stk2 = []; { let q = false; let e = false; for (const c of out) { if (q) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') q = false; continue; } if (c === '"') q = true; else if (c === '{' || c === '[') stk2.push(c === '{' ? '}' : ']'); else if (c === '}' || c === ']') stk2.pop(); } }
    const a = tryClose(out, stk2);
    try { JSON.parse(a); return a; } catch (_) { /* fall back */ }
    return tryClose(raw.slice(0, lastSafe), safeStack);
  }
  function parseJSONLoose(text) {
    const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try { return JSON.parse(raw); } catch (_) { /* keep going */ }
    const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
    if (s >= 0 && e > s) return JSON.parse(raw.slice(s, e + 1));
    throw new Error('not json');
  }

  // A cut-off reply can have the whole script but beats for only part of it: keep the planned beats (speakers,
  // fx, jokes) and add plain beats for the uncovered rest of the script so captions + timing stay complete.
  // Long caption beats are split at clause/word boundaries (<= 90 chars each); the first piece keeps fx/sticker/sfx.
  function splitLongBeats(beats) {
    const out = [];
    beats.forEach((b) => {
      const t = b.text; if (t.length <= 90) { out.push(b); return; }
      const pieces = []; let cur = '';
      const tokens = t.match(/\S+\s*/g) || [t];
      tokens.forEach((w) => { const c = cur.trim(); if (c && ((c + ' ' + w.trim()).length > 90 || (c.length > 45 && /[,;:—–]$/.test(c)))) { pieces.push(c); cur = w; } else cur += w; });
      if (cur.trim()) pieces.push(cur.trim());
      pieces.forEach((pt, k) => { const nb = Object.assign({}, b, { text: pt, weight: Math.max(0.5, wordCount(pt)) }); if (k > 0) { delete nb.fx; delete nb.fxText; delete nb.sticker; delete nb.sfx; delete nb.punch; } out.push(nb); });
    });
    return out;
  }
  function completeBeats(script, beats) {
    const all = words(script); const covered = wordCount(beats.map((b) => b.text).join(' '));
    if (all.length - covered < 4 || covered >= all.length * 0.97) return beats;
    const rest = all.slice(covered).join(' '); const last = beats[beats.length - 1] || {};
    const extra = beatsFromScript(rest, '', []);
    extra.forEach((b, k) => { b.step = (k >= extra.length - 2 && CTA_RE.test(b.text)) ? 4 : (last.step === 4 ? 4 : last.step || 0); });
    return beats.concat(extra);
  }
  // Validate + repair whatever Gemini returned into a complete package.
  function normalize(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('empty');
    let hooks = (Array.isArray(obj.hooks) ? obj.hooks : []).map((h) => toStr(typeof h === 'object' && h ? h.text : h, 200)).filter(Boolean);
    let script = toStr(obj.script || obj.voiceover, 40000);
    if (!script) throw new Error('no script');
    if (!hooks.length) hooks = [toStr((script.match(/^[^.!?]+[.!?]?/) || [script])[0], 200)];
    while (hooks.length < 3) hooks.push(hooks[0]);
    hooks = hooks.slice(0, 3);
    let beats = (Array.isArray(obj.beats) ? obj.beats : []).map((b) => ({
      text: toStr(b && b.text, 600), // v1.5.1: never cut a beat mid-word (80-char cut + completeBeats used to add a duplicate tail)
      weight: Math.max(0.5, Math.min(12, Number(b && b.weight) || wordCount(b && b.text) || 1)),
      step: Math.max(0, Math.min(4, Math.round(Number(b && b.step) || 0))),
      emphasis: toStr(b && b.emphasis, 30),
      visual: toStr(b && b.visual, 200),
      scene: b && b.scene,
      speaker: SPEAKERS.includes(String(b && b.speaker || '').toLowerCase()) ? String(b.speaker).toLowerCase() : '',
      fx: FX_IDS.includes(String(b && b.fx || '').toLowerCase()) ? String(b.fx).toLowerCase() : '',
      fxText: toStr(b && b.fxText, 200),
      sfx: SFX_IDS.includes(String(b && b.sfx || '').toLowerCase()) ? String(b.sfx).toLowerCase() : '',
      sticker: toStr(b && b.sticker, 18),
      punch: !!(b && (b.punch === true || b.punch === 'true')),
    })).filter((b) => b.text);
    beats = splitLongBeats(beats);
    beats.forEach((b) => { ['speaker', 'fx', 'fxText', 'sfx', 'sticker'].forEach((k) => { if (!b[k]) delete b[k]; }); if (!b.punch) delete b.punch; if (b.fx === 'none') delete b.fx; if (b.sfx === 'none') delete b.sfx; });
    if (beats.length < 3) beats = beatsFromScript(script, hooks[0], beats);
    else beats = completeBeats(script, beats);
    attachScenes(beats);
    const tagList = (v) => Array.from(new Set((Array.isArray(v) ? v : [v]).flatMap((x) => String(x || '').split(/[\s,]+|(?=#)/)).map(normHashtag).filter(Boolean))); // models sometimes pack several tags into one item
    const hashtags = tagList(obj.hashtags).slice(0, 8);
    if (!hashtags.some((h) => h.toLowerCase() === '#shorts') && hashtags.length < 8) hashtags.push('#Shorts');
    const tiktokHashtags = tagList(obj.tiktokHashtags).filter((h) => h.toLowerCase() !== '#shorts').slice(0, 5);
    return {
      textHook: toStr(obj.textHook, 60), tiktokCaption: toStr(obj.tiktokCaption, 300), tiktokHashtags, cta: toStr(obj.cta, 60),
      hooks, hookIndex: 0, script, beats,
      title: toStr(obj.title, 100) || hooks[0].slice(0, 90),
      description: toStr(obj.description, 3000),
      hashtags,
      pinnedComment: toStr(obj.pinnedComment, 500),
      thumbnailText: toStr(obj.thumbnailText, 60),
    };
  }

  // ---------- long videos: outline -> one Gemini call per section (with context) -> stitch ----------
  const OUTLINE_SCHEMA = {
    type: T.OBJECT,
    properties: {
      hooks: { type: T.ARRAY, description: 'Exactly 3 alternative opening hook lines (max 16 words), strongest first.', items: { type: T.STRING } },
      title: { type: T.STRING, description: 'YouTube title, under 70 characters.' },
      sections: { type: T.ARRAY, description: 'The sections of the video in order. The first section opens with hooks[0]; the last one ends with a soft CTA.', items: { type: T.OBJECT, properties: {
        title: { type: T.STRING, description: '2-6 word chapter title.' }, summary: { type: T.STRING, description: 'What this section says, 1-2 sentences.' },
        points: { type: T.ARRAY, items: { type: T.STRING }, description: '2-4 concrete points, examples or actions.' } }, required: ['title', 'summary', 'points'] } },
      description: { type: T.STRING, description: '3-6 short lines for the description, then a soft CTA line. No hashtags.' },
      hashtags: { type: T.ARRAY, items: { type: T.STRING }, description: '5 to 8 hashtags starting with #.' },
      pinnedComment: { type: T.STRING }, thumbnailText: { type: T.STRING, description: '2-5 punchy words.' },
    },
    required: ['hooks', 'title', 'sections', 'description', 'hashtags', 'pinnedComment', 'thumbnailText'],
  };
  function sectionSchema() {
    const beat = JSON.parse(JSON.stringify(SCHEMA.properties.beats.items)); if (SC()) { delete beat.properties.visual; beat.required = beat.required.filter((k) => k !== 'visual').concat(['scene']); beat.properties.scene = sceneSchema(); }
    return { type: T.OBJECT, properties: { text: { type: T.STRING, description: 'The full voiceover of this section only.' }, beats: { type: T.ARRAY, description: 'Caption beats splitting this section text verbatim, 3-6 words each, in order, covering all of it.', items: beat } }, required: ['text', 'beats'] };
  }
  function sectionCount(L) { return Math.max(3, Math.round(L.sec / 80)); }
  function ideaKey(idea, opts) { const g = VTS.gemini; return (g && g.hashText ? g.hashText : (x) => String(x.length))([String(idea || '').trim(), opts.length, opts.tone, opts.language].join('|')); }
  async function callJSON(prompt, schema, system, opts, what) {
    const g = VTS.gemini;
    return g.withRetry(async (attempt) => {
      const r = await askJSON([{ role: 'user', parts: [{ text: prompt }] }], Object.assign({ system, schema, temperature: 0.8 }, attempt ? { safety: 'BLOCK_NONE' } : {}));
      if (r.obj) return r.obj;
      if (r.emptyErr) { if (attempt === 0 && r.emptyErr.emptyReply !== 'blocked') { const e = new Error('empty reply'); e.status = 503; e.details = r.emptyErr.details; throw e; } throw r.emptyErr; } // one backed-off retry
      const e = new Error('bad json'); e.status = 503; e.details = 'finishReason ' + (r.meta.finishReason || '?') + ', model ' + (r.meta.model || '?') + ': ' + String(r.text).slice(0, 120); throw e; // retried once more as transient
    }, { tries: 4, base: 5000, signal: opts.signal, onWait: (ms, n, err) => opts.onProgress && opts.onProgress({ phase: 'wait', what, ms, attempt: n, quota: err && (err.status === 429) }) });
  }
  // opts: length, tone, language, handle, partial (saved progress), onPartial(partial), onProgress(info), signal
  async function generateLong(idea, opts) {
    const L = lengthOf(opts.length); const tone = TONES[opts.tone] || TONES.calm; const n = sectionCount(L); const key = ideaKey(idea, opts);
    let partial = opts.partial && opts.partial.key === key ? opts.partial : { key, outline: null, sections: [] };
    const lang = 'Language for every field: ' + (opts.language || 'English') + '.';
    if (!partial.outline) {
      if (opts.onProgress) opts.onProgress({ phase: 'outline', i: 0, n: n + 1 });
      const prompt = ['Plan a ' + L.label + ' YouTube video from my idea below. Make exactly ' + n + ' sections (the video is about ' + L.words[0] + '-' + L.words[1] + ' words in total, about ' + Math.round(L.words[1] / n) + ' words per section).', 'Tone: ' + tone.prompt, lang,
        opts.handle ? 'Channel handle (only for the final CTA if natural): ' + opts.handle : '', '', 'My idea (may be a messy dictation or an outline):', '"""', String(idea || '').trim().slice(0, 24000), '"""'].filter(Boolean).join('\n');
      const o = await callJSON('OUTLINE REQUEST\n' + prompt, OUTLINE_SCHEMA, SYSTEM_LONG, opts, 'outline');
      const secs = (Array.isArray(o.sections) ? o.sections : []).map((x) => ({ title: toStr(x && x.title, 80), summary: toStr(x && x.summary, 400), points: (Array.isArray(x && x.points) ? x.points : []).map((p) => toStr(p, 200)).slice(0, 5) })).filter((x) => x.title || x.summary);
      if (secs.length < 2) { const e = VTS.gemini.fail('Gemini returned an outline without sections. Try again.'); throw e; }
      partial.outline = Object.assign({}, o, { sections: secs.slice(0, n + 2) });
      if (opts.onPartial) await opts.onPartial(partial);
    }
    const out = partial.outline; const secs = out.sections; const per = Math.round(L.words[1] / secs.length);
    const hooks = (Array.isArray(out.hooks) ? out.hooks : []).map((h) => toStr(h, 200)).filter(Boolean);
    for (let i = partial.sections.length; i < secs.length; i++) {
      if (opts.signal && opts.signal.aborted) throw VTS.gemini.fail('Stopped.');
      if (opts.onProgress) opts.onProgress({ phase: 'section', i: i + 1, n: secs.length + 1, title: secs[i].title });
      const prevText = i > 0 ? partial.sections[i - 1].text : ''; const lastLines = (prevText.match(/[^.!?]+[.!?]+/g) || []).slice(-2).join(' ').trim();
      const prompt = ['SECTION REQUEST ' + (i + 1) + ' of ' + secs.length, 'Write ONLY section ' + (i + 1) + ' ("' + secs[i].title + '") of this ' + L.label + ' video, about ' + per + ' words, as spoken voiceover. ' + lang, 'Tone: ' + tone.prompt,
        i === 0 ? 'This is the opening: start with exactly this hook: "' + (hooks[0] || secs[0].title) + '", then promise what the viewer will learn.' : 'Continue naturally from the previous section, which ended: "' + lastLines + '". Do not repeat the hook or greet again.',
        i === secs.length - 1 ? 'This is the final section: wrap up in 1-2 lines and end with one soft CTA line' + (opts.handle ? ' (you may mention ' + opts.handle + ')' : '') + '.' : 'Do not end the video here; lead into the next section ("' + (secs[i + 1] ? secs[i + 1].title : '') + '").',
        'This section covers: ' + secs[i].summary, 'Points: ' + secs[i].points.join('; '),
        'Beats: split the section text verbatim into beats of 3-6 words; weight = spoken words; step 0 (the CTA beats in the final section use step 4).', SC() ? SCENE_RULES + '\nIn long videos change the setting every 3-6 beats and vary actions, while keeping each beat literal.' : '',
        '', 'Full outline for context:', secs.map((x, k) => (k + 1) + '. ' + x.title + ' — ' + x.summary).join('\n')].filter(Boolean).join('\n');
      let r = await callJSON(prompt, sectionSchema(), SYSTEM_LONG, opts, 'section ' + (i + 1));
      for (let x = 0; x < 2 && wordCount(toStr(r && r.text, 12000)) < per * 0.75; x++) { // light models under-write long sections: ask once or twice for the full length
        const got = wordCount(toStr(r && r.text, 12000));
        const r2 = await callJSON(prompt + '\n\nIMPORTANT: a previous draft of this section was only ' + got + ' words. Write the FULL section: at least ' + per + ' words of spoken voiceover (more examples, jokes and concrete detail; no filler).', sectionSchema(), SYSTEM_LONG, opts, 'section ' + (i + 1));
        if (wordCount(toStr(r2 && r2.text, 12000)) > got) r = r2;
      }
      const text = toStr(r.text, 12000).replace(/\s+/g, ' ').trim();
      let beats = (Array.isArray(r.beats) ? r.beats : []).map((b) => ({ text: toStr(b && b.text, 80), weight: Math.max(0.5, Math.min(12, Number(b && b.weight) || wordCount(b && b.text) || 1)), step: i === secs.length - 1 && Number(b && b.step) === 4 ? 4 : 0, emphasis: toStr(b && b.emphasis, 30), visual: toStr(b && b.visual, 200), scene: b && b.scene })).filter((b) => b.text);
      if (!text && !beats.length) throw VTS.gemini.fail('Gemini returned an empty section ' + (i + 1) + '. Tap Write again to resume.');
      const covered = wordCount(beats.map((b) => b.text).join(' '));
      if (beats.length < 3 || covered < wordCount(text) * 0.8) beats = beatsFromScript(text, '', beats).map((b) => Object.assign(b, { step: 0 }));
      partial.sections.push({ title: secs[i].title, text: text || beats.map((b) => b.text).join(' '), beats });
      if (opts.onPartial) await opts.onPartial(partial);
    }
    return stitchLong(partial, hooks);
  }
  function stitchLong(partial, hooks) {
    const o = partial.outline; const beats = [];
    partial.sections.forEach((sec, k) => sec.beats.forEach((b, j) => { const nb = Object.assign({}, b, { section: k }); if (j === 0 && k > 0) nb.chapter = sec.title; if (k === 0 && j < 2) nb.step = 0; beats.push(nb); }));
    attachScenes(beats);
    while (hooks.length < 3) hooks.push(hooks[0] || (partial.sections[0] && partial.sections[0].text.split(/[.!?]/)[0]) || '');
    const hashtags = Array.from(new Set((Array.isArray(o.hashtags) ? o.hashtags : []).map(normHashtag).filter(Boolean))).slice(0, 8);
    return { hooks: hooks.slice(0, 3), hookIndex: 0, script: partial.sections.map((x) => x.text).join('\n\n'), beats, sections: partial.sections.map((x) => ({ title: x.title, text: x.text })), long: true,
      title: toStr(o.title, 100) || hooks[0].slice(0, 90), description: toStr(o.description, 5000) + (partial.sections.length > 2 ? '\n\nChapters:\n' + partial.sections.map((x, k) => (k + 1) + '. ' + x.title).join('\n') : ''), hashtags, pinnedComment: toStr(o.pinnedComment, 500), thumbnailText: toStr(o.thumbnailText, 60) };
  }

  // ---------- robust JSON generation (v1.4.1) ----------
  // 1.4.0 bug: when gemini-3.8-flash was busy, the fallback model spent ~13k "thinking" tokens of the 16k output
  // budget and the 2-min script JSON was cut off (finishReason MAX_TOKENS) -> "unexpected format".
  // Now: low thinking + 32k budget; on a cut-off reply ask the model to continue, then repair; callers add a compact retry
  // and a split (text first, beats second) as last resorts.
  const PG_NOTE = 'Safety: keep every joke kind and PG — tease the situation and the brain, never a person or group; no self-harm, violence, sexual, drug or alcohol jokes; no slurs or swearing.';
  const CONTINUE_MSG = 'Your JSON reply was cut off. Continue EXACTLY from the last character you wrote: output only the remaining characters to complete the JSON, with no repetition, no explanation and no code fences.';
  function tryParse(text) { try { return text ? parseJSONLoose(text) : null; } catch (_) { return null; } }
  function joinContinuation(text, more) {
    const m = String(more || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    if (/^\s*\{/.test(m) && tryParse(m)) return m; // the model restarted with a complete object
    for (let k = Math.min(300, m.length, text.length); k >= 12; k--) if (text.endsWith(m.slice(0, k))) return text + m.slice(k); // repeated overlap
    return text + m;
  }
  async function askJSON(contents, o) {
    const g = VTS.gemini; let meta = {};
    const base = Object.assign({ json: true, temperature: 0.85, maxTokens: 32768, timeout: 180000, think: 'low', budgetMs: 240000 }, o, { onMeta: (m) => { meta = m || {}; } });
    let text = ''; const fixes = [];
    try { text = await g.generate(contents, base); } catch (err) {
      // Empty reply on every model tried (safety / OTHER / RECITATION / no text): let the caller try a different request.
      if (err && err.emptyReply) return { obj: null, text: '', meta: { finishReason: String(err.emptyReply).toUpperCase(), model: err.model }, fixes: [], emptyErr: err };
      if (!err.truncated) throw err; meta = Object.assign({ finishReason: 'MAX_TOKENS' }, meta);
    }
    let obj = tryParse(text);
    for (let k = 0; !obj && text && meta.finishReason === 'MAX_TOKENS' && k < 2; k++) {
      let more = '';
      try { more = await g.generate(contents.concat([{ role: 'model', parts: [{ text }] }, { role: 'user', parts: [{ text: CONTINUE_MSG }] }]), Object.assign({}, base, { json: false, schema: null, onMeta: (m) => { meta = m || {}; } })); } catch (err) { if (err && (err.status === 429 || err.quota)) throw err; break; }
      if (!more) break;
      text = joinContinuation(text, more); fixes.push('continued'); obj = tryParse(text);
    }
    if (!obj && text) { obj = tryParse(repairJSON(text)); if (obj) fixes.push('repaired'); }
    return { obj, text, meta, fixes };
  }
  const META_KEYS = ['hooks', 'script', 'textHook', 'title', 'description', 'hashtags', 'tiktokCaption', 'tiktokHashtags', 'cta', 'pinnedComment', 'thumbnailText'];
  function compactSchema() { const sch = JSON.parse(JSON.stringify(SCHEMA)); const it = sch.properties.beats.items; delete it.properties.visual; it.required = it.required.filter((k) => k !== 'visual'); return sch; }
  function metaSchema() { const sch = JSON.parse(JSON.stringify(SCHEMA)); delete sch.properties.beats; sch.required = sch.required.filter((k) => k !== 'beats'); return sch; }
  function beatsOnlySchema() { const it = compactSchema().properties.beats; return { type: T.OBJECT, properties: { beats: it }, required: ['beats'] }; }

  async function generatePackage(idea, opts) {
    const g = VTS.gemini; opts = opts || {};
    if (isLong(opts.length)) return generateLong(idea, opts);
    const L = lengthOf(opts.length); const sch = schemaWithScenes(); let system = SYSTEM;
    if (isComedy(opts)) system = COMEDY_RULES + '\nReturn ONLY JSON matching the schema.';
    else system = SYSTEM.replace('80 to 110 words (about 30-45 seconds spoken)', L.words[0] + ' to ' + L.words[1] + ' words (about ' + L.sec + ' seconds spoken)');
    if (L.sec > 60) {
      // 2-min videos use the short (single-call) path: override the 80-110 word rule in the schema and system text too.
      const w = L.words[0] + '-' + L.words[1] + ' words';
      sch.properties.script.description = 'Full voiceover, ' + w + ' (about ' + L.label + ' spoken): hooks[0], then the numbered steps with examples, then a soft CTA.';
      system = system + '\nLENGTH OVERRIDE for this request: the full voiceover script must be ' + w + ' (about ' + L.label + ' spoken), not 80-110 words. Use 3 to 5 steps with a concrete example each.';
    }
    const prompt = buildPrompt(idea, opts);
    const tell = (what) => { if (opts.onProgress) opts.onProgress({ phase: 'repair', what }); };
    // A complete reply is accepted as before (the length retry below handles short ones); a cut-off/repaired one
    // must still carry at least half the script, otherwise the next fallback runs.
    const usable = (o, rr) => { try { const p = normalize(o); const cutOff = rr && (rr.meta.finishReason === 'MAX_TOKENS' || rr.fixes.includes('repaired')); return !cutOff || wordCount(p.script) >= L.words[0] * 0.5 ? p : null; } catch (_) { return null; } };
    const trail = [];
    const note = (r, tag) => trail.push(tag + ': ' + (r.meta.finishReason || '?') + (r.meta.model ? ' ' + r.meta.model : '') + (r.fixes.length ? ' (' + r.fixes.join('+') + ')' : '') + ', ' + String(r.text || '').length + ' chars');
    const user = [{ role: 'user', parts: [{ text: prompt }] }];
    // 1) one call, full schema (scenes included)
    let r = await askJSON(user, { system, schema: sch }); note(r, 'full');
    let pkg = usable(r.obj, r); let lastText = r.text;
    let emptyErr = r.emptyErr || null; let hardErr = null;
    // After an empty / blocked reply: back off a little, relax safety, and (for safety blocks) tone the jokes down one notch.
    const safetyHit = () => emptyErr && (emptyErr.emptyReply === 'safety' || emptyErr.emptyReply === 'blocked');
    const softPrompt = () => (safetyHit() ? buildPrompt(idea, Object.assign({}, opts, { humour: Math.min(2, humourOf(opts)) })) + '\n\n' + PG_NOTE : prompt);
    const extra = () => (emptyErr ? { safety: 'BLOCK_NONE' } : {});
    const pause = (ms) => (emptyErr ? new Promise((res) => setTimeout(res, opts.backoffMs ?? ms)) : Promise.resolve());
    const step = async (fn) => { try { await fn(); } catch (err) { if (err && err.emptyReply) emptyErr = err; else hardErr = err; } };
    // 2) compact retry: no scene objects (scenes are inferred locally from the words), about half the size
    if (!pkg) {
      tell(emptyErr ? 'empty' : 'compact'); await pause(3000);
      await step(async () => {
        r = await askJSON([{ role: 'user', parts: [{ text: softPrompt() + '\n\nKeep the JSON compact: leave optional fields empty unless they matter.' }] }], Object.assign({ system, schema: compactSchema() }, extra())); note(r, 'compact');
        if (r.emptyErr) emptyErr = r.emptyErr;
        pkg = usable(r.obj, r); lastText = r.text || lastText;
      });
    }
    // 3) split: script + publishing text first, then the beats for that exact script (or local beats)
    if (!pkg && !(hardErr && (hardErr.status === 429 || hardErr.quota))) {
      tell('split'); await pause(5000);
      await step(async () => {
        r = await askJSON([{ role: 'user', parts: [{ text: softPrompt() + '\n\nFor this request return everything EXCEPT "beats" (beats are requested separately).' }] }], Object.assign({ system, schema: metaSchema() }, extra())); note(r, 'text');
        if (r.emptyErr) emptyErr = r.emptyErr;
        const meta = r.obj && typeof r.obj === 'object' ? r.obj : null;
        if (meta && meta.script) {
          let beats = [];
          try {
            const rb = await askJSON([{ role: 'user', parts: [{ text: 'Split this voiceover VERBATIM into ' + (L.beats ? L.beats[0] + '-' + L.beats[1] : 'short') + ' consecutive caption beats of 3-8 words covering all of it, with the beat fields described in the schema. ' + (isComedy(opts) ? 'Format: ' + ((FORMATS[opts.format] || FORMATS.classic).label) + '. Mark speakers, punchlines, fx and sfx as in a funny Short.' : '') + '\n\nVoiceover:\n' + meta.script }] }], Object.assign({ system, schema: beatsOnlySchema() }, extra()));
            note(rb, 'beats'); if (rb.obj && Array.isArray(rb.obj.beats)) beats = rb.obj.beats;
          } catch (err) { if (err && (err.status === 429 || err.quota)) throw err; }
          pkg = usable(Object.assign({}, meta, { beats })); // empty beats -> rebuilt locally from the script
        }
        lastText = r.text || lastText;
      });
    }
    if (!pkg) {
      // Say the real reason: safety block > busy/quota/timeout > empty reply > unreadable JSON.
      let e;
      if (safetyHit()) e = emptyErr;
      else if (hardErr) e = hardErr;
      else if (emptyErr) e = emptyErr;
      else e = g.fail('Gemini returned a script in an unexpected format. Tap “Write my Short” again.');
      e.details = (e.details ? e.details + ' | ' : '') + trail.join(' | ') + (lastText ? ' — ' + String(lastText).slice(0, 120) : '');
      throw e;
    }
    // Smaller fallback models sometimes write a 30 s script for a 60 s request: one retry that asks for the full length.
    if (L.sec <= 120 && wordCount(pkg.script) < L.words[0] * 0.85 && !opts.noLengthRetry) {
      const n = wordCount(pkg.script);
      try {
        const r2 = await askJSON(user.concat([{ role: 'model', parts: [{ text: JSON.stringify(r.obj || {}) }] }, { role: 'user', parts: [{ text: 'That script is only ' + n + ' words, far too short. Rewrite the whole package with a ' + L.words[0] + '-' + L.words[1] + ' word script (about ' + L.sec + ' seconds spoken) and ' + (L.beats ? L.beats[0] + '-' + L.beats[1] : 'more') + ' beats. Keep the same idea, format and jokes, add more beats and punchlines. Return ONLY JSON.' }] }]), { system, schema: sch });
        const pkg2 = usable(r2.obj, r2);
        if (pkg2 && wordCount(pkg2.script) > n) pkg = pkg2;
      } catch (_) { /* keep the shorter script */ }
    }
    pkg.genInfo = trail.join(' | ');
    return pkg;
  }

  // Swap the hook: replace the old hook at the start of the script and rebuild the hook beats.
  function applyHook(pkg, index) {
    const oldHook = pkg.hooks[pkg.hookIndex] || '';
    const newHook = pkg.hooks[index] || '';
    pkg.hookIndex = index;
    if (!newHook) return pkg;
    const s = pkg.script.trim();
    if (oldHook && s.startsWith(oldHook.trim())) pkg.script = newHook + s.slice(oldHook.trim().length);
    else if (!s.startsWith(newHook)) {
      // Drop the first sentence if it looks like a hook, then prepend.
      pkg.script = newHook + ' ' + s.replace(/^[^.!?]+[.!?]\s*/, '');
    }
    pkg.script = pkg.script.replace(/\s+/g, ' ').trim();
    rebuildHookBeats(pkg);
    return pkg;
  }

  function rebuildHookBeats(pkg) {
    const hook = pkg.hooks[pkg.hookIndex] || '';
    const rest = pkg.beats.filter((b) => b.step !== 0);
    const first = pkg.beats.find((b) => b.step === 0) || {};
    const vis = first.visual || defaultVisual(0);
    pkg.beats = chunkText(hook).map((c) => ({ text: c, weight: wordCount(c), step: 0, emphasis: '', visual: vis, scene: first.scene ? JSON.parse(JSON.stringify(first.scene)) : null })).concat(rest);
    attachScenes(pkg.beats);
    return pkg;
  }

  async function regenerateScene(pkg, index) {
    const g = VTS.gemini; const s = SC(); const b = pkg.beats[index];
    const ctx = pkg.beats.map((x, i) => (i === index ? '>>> ' : '    ') + x.text + (x.scene ? '  [' + x.scene.setting + ', ' + x.scene.pose + ']' : '')).join('\n');
    const prompt = ['Suggest a NEW, different animated scene for the beat marked >>> in this YouTube Short. Make it literal and visually fresh, but consistent with its neighbours.', SCENE_RULES,
      'Current scene of that beat: ' + JSON.stringify(b.scene || {}), '', 'Script: ' + pkg.script, '', 'Beats:', ctx].join('\n');
    const text = await g.generate([{ role: 'user', parts: [{ text: prompt }] }], { json: true, schema: sceneSchema(), temperature: 1.0 });
    let raw; try { raw = parseJSONLoose(text); } catch (_) { const e = g.fail('Gemini returned an unexpected scene. Try again.'); e.details = String(text).slice(0, 160); throw e; }
    return s.normalizeScene(raw, b.text, b.step, index > 0 ? pkg.beats[index - 1].scene : null);
  }

  VTS.shortgen = { FORMATS, HUMOUR, HUMOUR_PROMPT, COMEDY_RULES, SPEAKERS, FX_IDS, SFX_IDS, isComedy, humourOf, buildComedyPrompt, LENGTHS, lengthOf, isLong, generateLong, stitchLong, sectionCount, SYSTEM_LONG, OUTLINE_SCHEMA, sectionSchema, attachScenes, regenerateScene, sceneSchema, schemaWithScenes, rebuildHookBeats, TONES, LANGUAGES, SYSTEM, SCHEMA, buildPrompt, normalize, parseJSONLoose, repairJSON, completeBeats, joinContinuation, askJSON, compactSchema, metaSchema, generatePackage, applyHook, beatsFromScript, chunkText, wordCount, words, normHashtag, splitHook };
}());
