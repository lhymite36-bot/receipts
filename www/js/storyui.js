/* Receipts "Story" mode UI: storyline (typed or dictated) -> Gemini story board (www/js/story.js) -> 11 collapsible sections,
   thumbnail storyboard, copy/export -> cast with one locked Gemini voice per character (+ narrator), voice picker + preview,
   voice QA -> canvas preview -> 1080x1920 recording. Myth-bust mode is untouched (this file only adds the Story tab). */
(function () {
  'use strict';
  const VTS = window.VTS; const S = VTS.story; const D = VTS.storyDraw; const A = VTS.storyAudio; const G = VTS.gemini;
  const $ = (id) => document.getElementById(id);
  const K = { mode: 'rcp.mode', plan: 'rcp.story.plan', input: 'rcp.story.input', queue: 'rcp.story.queue', keyfp: 'rcp.story.keyfp', keyAt: 'rcp.story.keyChangedAt', useModel: 'rcp.story.useModel' };
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { toast('Storage is full: the story could not be saved.', true); } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const redact = (m) => (G.redact ? G.redact(String(m)) : String(m));
  let tt = 0; function toast(text, err) { const t = $('toast'); if (!t) return; t.textContent = text; t.className = 'show' + (err ? ' err' : ''); clearTimeout(tt); tt = setTimeout(() => { t.className = ''; }, 2600); }
  function status(id, text, kind) { const el = $(id); if (!el) return; el.textContent = text || ''; el.className = 'status' + (kind ? ' ' + kind : ''); }
  const input = Object.assign({ storyline: '', tone: '', beats: 8, platform: 'reel', narrator: true, part1: false }, load(K.input, {}));
  let plan = load(K.plan, null); let voiced = null; let mixBuf = null; let tm = null; let placed = []; let playing = null; let busy = false;
  const view = $('view-create'); const canvas = $('st-canvas'); let R = null;

  // ---------- mode switch ----------
  function setMode(m) { view.classList.toggle('story-mode', m === 'story'); document.querySelectorAll('#mode-seg button').forEach((b) => { b.classList.toggle('on', b.dataset.mode === m); b.setAttribute('aria-selected', String(b.dataset.mode === m)); }); save(K.mode, m); if (m === 'story') drawCurrent(); }
  document.querySelectorAll('#mode-seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  // ---------- inputs ----------
  const line = $('st-line');
  function paintInputs() {
    line.value = input.storyline; $('st-count').textContent = (input.storyline.trim() ? input.storyline.trim().split(/\s+/).length : 0) + ' words';
    $('st-tone').innerHTML = ['', ...S.TONES].map((t) => `<button type="button" class="chip${input.tone === t ? ' on' : ''}" data-v="${esc(t)}">${t ? esc(t) : 'auto'}</button>`).join('');
    document.querySelectorAll('#st-beats button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === Number(input.beats)));
    document.querySelectorAll('#st-platform button').forEach((b) => b.classList.toggle('on', b.dataset.v === input.platform));
    $('st-narrator').checked = !!input.narrator; $('st-part1').checked = !!input.part1;
  }
  const keep = () => save(K.input, input);
  line.addEventListener('input', () => { input.storyline = line.value; $('st-count').textContent = (line.value.trim() ? line.value.trim().split(/\s+/).length : 0) + ' words'; keep(); });
  $('st-tone').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; input.tone = b.dataset.v; keep(); paintInputs(); });
  $('st-beats').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; input.beats = Number(b.dataset.v); keep(); paintInputs(); });
  $('st-platform').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; input.platform = b.dataset.v; keep(); paintInputs(); });
  $('st-narrator').addEventListener('change', (e) => { input.narrator = e.target.checked; keep(); if (plan && plan.narrator) { plan.narrator.use = input.narrator; S.syncCaptions(plan); persistPlan(); voiced = null; paintCast(); } });
  $('st-part1').addEventListener('change', (e) => { input.part1 = e.target.checked; keep(); });
  const EXAMPLES = ['She finds a note on her coffee cup that says “Don’t turn around”', 'Every night at 9 the lamp in the empty flat across the street turns on', 'A gift box on his doorstep is ticking', 'The new kid always leaves school five minutes early'];
  $('st-examples').innerHTML = EXAMPLES.map((x) => `<button type="button" class="chip">${esc(x)}</button>`).join('');
  $('st-examples').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; input.storyline = b.textContent; keep(); paintInputs(); });

  // ---------- dictation (the app's existing speech engine) ----------
  let engine = null; let base = ''; let committed = '';
  $('st-mic').addEventListener('click', async () => {
    if (engine) { try { await engine.stop(); } catch (_) { /* */ } engine = null; $('st-mic').setAttribute('aria-pressed', 'false'); status('st-mic-status', ''); return; }
    base = line.value.trim(); committed = '';
    const paint = (interim) => { input.storyline = [base, committed, interim].filter(Boolean).join(' '); line.value = input.storyline; keep(); };
    try {
      engine = await VTS.speech.create({ lang: load('rcp.speechLang', '') || navigator.language || 'en-US', commit: (t) => { t = String(t || '').trim(); if (t) committed = committed ? committed + ' ' + t : t; paint(''); }, interim: (t) => paint(t || ''), error: (m) => { status('st-mic-status', m, 'err'); engine = null; $('st-mic').setAttribute('aria-pressed', 'false'); }, ended: () => { engine = null; $('st-mic').setAttribute('aria-pressed', 'false'); status('st-mic-status', ''); } });
      $('st-mic').setAttribute('aria-pressed', 'true'); status('st-mic-status', 'Listening… tap the mic to stop.', 'live'); await engine.start();
    } catch (err) { engine = null; $('st-mic').setAttribute('aria-pressed', 'false'); status('st-mic-status', err && err.friendly ? err.friendly : 'Could not start dictation: ' + redact(err && err.message || err), 'err'); }
  });

  // ---------- board ----------
  function persistPlan() { if (plan) save(K.plan, plan); }
  $('st-go').addEventListener('click', async () => {
    if (busy) return; if (!input.storyline.trim()) { status('st-status', 'Type or dictate a storyline first.', 'err'); return; }
    if (!G.host.getKey || !G.host.getKey()) { status('st-status', 'Add your Gemini API key in Settings first.', 'err'); return; }
    busy = true; $('st-go').disabled = true; stopPreview();
    try {
      const r = await S.generate({ storyline: input.storyline.trim(), tone: input.tone, beats: input.beats, platform: input.platform, narrator: input.narrator, part1: input.part1 }, (contents, opts) => G.generate(contents, opts), { onStatus: (s) => status('st-status', s, 'live') });
      plan = r.plan; if (plan.narrator && !input.narrator) { plan.narrator.use = false; S.syncCaptions(plan); } voiced = null; mixBuf = null; persistPlan();
      status('st-status', `Story boarded: ${plan.panels.length} panels${r.report.fixed.length ? `, ${r.report.fixed.length} rule fixes applied` : ''}. Next: generate the voices.`, 'ok');
      paintPlan(); $('st-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { status('st-status', 'Could not board the story: ' + redact(G.friendlyError ? G.friendlyError(err) : (err && err.message || err)), 'err'); }
    finally { busy = false; $('st-go').disabled = false; }
  });

  // ---------- results ----------
  function md2html(md) {
    const out = []; let list = false; let table = [];
    const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const flushT = () => { if (table.length) { out.push('<pre>' + esc(table.join('\n')) + '</pre>'); table = []; } };
    for (const ln of md.split('\n')) {
      if (/^\s*\|/.test(ln)) { if (list) { out.push('</ul>'); list = false; } table.push(ln); continue; } flushT();
      if (/^\s*[-*] /.test(ln)) { if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + inline(ln.replace(/^\s*[-*] /, '')) + '</li>'); continue; }
      if (list) { out.push('</ul>'); list = false; }
      if (/^#{3,} /.test(ln)) out.push('<h4>' + inline(ln.replace(/^#+ /, '')) + '</h4>'); else if (ln.trim()) out.push('<p>' + inline(ln) + '</p>');
    }
    flushT(); if (list) out.push('</ul>'); return out.join('');
  }
  function sections() { const md = S.toMarkdown(plan); const parts = md.split(/^## /m).slice(1); return parts.map((p) => { const nl = p.indexOf('\n'); return { title: p.slice(0, nl).trim(), body: p.slice(nl + 1) }; }); }
  function renderer() { if (!R) R = new D.StoryRenderer(canvas); R.setup(plan, { timing: tm || undefined, lines: placed }); return R; }
  function recomputeTiming() { if (voiced && voiced.lines.length) { const r = A.placeLines(plan, voiced.lines, S); tm = r.tm; placed = r.lines; } else { tm = S.timing(plan); placed = []; } }
  function paintPlan() {
    if (!plan) { $('st-result').classList.add('hidden'); return; }
    $('st-result').classList.remove('hidden'); recomputeTiming(); const r = renderer();
    const so = plan.social || {}; $('st-title').textContent = so.seriesTitle || 'Story';
    $('st-meta').textContent = `${plan.panels.length} panels · ${tm.total.toFixed(1)} s · ${S.PLATFORMS[(plan.input || {}).platform] || '9:16 Reel'}`; $('st-dur').textContent = tm.total.toFixed(1) + ' s at 24 fps';
    const rep = plan.report || {}; $('st-report').textContent = (rep.fixed || []).length ? `Rule check: ${(rep.fixed || []).length} fixes applied${(rep.forced || []).length ? ', ' + rep.forced.length + ' forced' : ''}. See report.fixed in the JSON export.` : 'Rule check: all story rules met.';
    // thumbnail storyboard strip
    const strip = $('st-strip'); strip.innerHTML = '';
    plan.panels.forEach((pn, i) => { r.drawPanel(i, { captions: false }); const b = document.createElement('button'); b.type = 'button'; b.className = 'st-thumb' + (pn.mood === 'peak' ? ' peak' : ''); const c = document.createElement('canvas'); c.width = 184; c.height = 328; c.getContext('2d').drawImage(canvas, 0, 0, 184, 328); b.appendChild(c); const s = document.createElement('span'); s.textContent = `${i + 1} · ${pn.mood || ''}`; b.appendChild(s); b.addEventListener('click', () => { stopPreview(); renderer().drawPanel(i); }); strip.appendChild(b); });
    { r.draw(tm.endCard.start + 0.8); const b = document.createElement('button'); b.type = 'button'; b.className = 'st-thumb end'; const c = document.createElement('canvas'); c.width = 184; c.height = 328; c.getContext('2d').drawImage(canvas, 0, 0, 184, 328); b.appendChild(c); const s = document.createElement('span'); s.textContent = 'end card'; b.appendChild(s); strip.appendChild(b); }
    $('st-sections').innerHTML = sections().map((s, k) => `<details${k === 0 ? ' open' : ''}><summary>${esc(s.title)}</summary><div class="md">${md2html(s.body)}</div></details>`).join('');
    paintCast(); drawCurrent();
  }
  function drawCurrent() { if (plan && canvas && !playing) renderer().drawPanel(0); }

  // ---------- cast & voices ----------
  const voiceLabel = (v) => { const d = S.VOICES[v] || []; return `${v} · ${d[0] === 'f' ? 'female' : d[0] === 'm' ? 'male' : ''} · ${d[1] || ''} pitch · ${d[3] || ''}`; };
  const voiceOptions = (sel) => Object.keys(S.VOICES).map((v) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(voiceLabel(v))}</option>`).join('');
  function paintCast() {
    if (!plan) return; const rows = plan.characters.map((c) => ({ id: c.id, name: c.name, col: c.top, voice: c.voice, why: c.voiceWhy || '', desc: [c.age, c.energy || c.personality, c.role].filter(Boolean).join(' · ') }));
    if (plan.narrator && plan.narrator.use) rows.push({ id: 'narrator', name: 'Narrator', col: '#F5F0E8', voice: plan.narrator.voice, why: plan.narrator.why || 'hook and caption lines', desc: 'optional, hook/caption lines' });
    const n = (who) => S.voiceLines(plan).filter((l) => l.who === who).length;
    $('st-cast').innerHTML = rows.map((r) => `<div class="st-cast-row"><span class="st-swatch" style="background:${esc(r.col)}"></span><div><b>${esc(r.name)} <span class="muted small">· ${n(r.id)} line${n(r.id) === 1 ? '' : 's'}</span></b><small>${esc(r.desc)}</small><small>${esc(r.why)}</small><select data-who="${esc(r.id)}" aria-label="Voice for ${esc(r.name)}">${voiceOptions(r.voice)}</select></div><button type="button" class="st-prev" data-who="${esc(r.id)}" aria-label="Preview ${esc(r.name)}'s voice">▶</button></div>`).join('');
    paintQa();
  }
  $('st-cast').addEventListener('change', (e) => {
    const s = e.target.closest('select'); if (!s) return; const who = s.dataset.who; const v = s.value;
    const owner = plan.characters.find((c) => c.voice === v && c.id !== who) || (plan.narrator && plan.narrator.use && plan.narrator.voice === v && who !== 'narrator' ? plan.narrator : null);
    const cur = who === 'narrator' ? plan.narrator.voice : plan.characters.find((c) => c.id === who).voice;
    if (owner) { owner.voice = cur; toast(`Voices swapped so every character stays distinct.`); }
    if (who === 'narrator') plan.narrator.voice = v; else { const c = plan.characters.find((q) => q.id === who); c.voice = v; c.voiceWhy = 'chosen by you'; }
    persistPlan(); voiced = null; mixBuf = null; paintCast(); recomputeTiming(); status('st-voice-status', 'Voice changed: generate the voices again.', '');
  });
  $('st-cast').addEventListener('click', async (e) => {
    const b = e.target.closest('.st-prev'); if (!b) return; const who = b.dataset.who; const v = who === 'narrator' ? plan.narrator.voice : plan.characters.find((c) => c.id === who).voice;
    b.disabled = true; b.textContent = '…';
    try { await A.previewVoice(plan, who, v, { useModel: consentModel() }); } catch (err) { const ex = A.explain(errInfo(err), { keyChangedRecently: keyChangedRecently() }); toast('Preview: ' + ex.title + (ex.lines[0] ? ' (' + ex.lines[0].slice(0, 90) + ')' : ''), true); }
    finally { b.disabled = false; b.textContent = '▶'; }
  });
  function paintQa() {
    const el = $('st-voice-qa'); if (!voiced) { el.innerHTML = ''; $('st-render').disabled = true; return; }
    const q = voiced.qa; const names = Object.fromEntries(plan.characters.map((c) => [c.id, c.name]).concat([['narrator', 'Narrator']]));
    el.innerHTML = q.checks.map((c) => `<div class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'} ${esc(c.name)}</div>`).join('') + Object.entries(q.who).map(([w, v]) => `<div class="muted">${esc(names[w] || w)} (${esc(v.voice)}): ${v.f0} Hz, timbre ${v.centroid} Hz, pitch movement ${v.f0StdSt} st</div>`).join('') + `<div class="muted">Model: ${esc(voiced.models.join(', '))}${voiced.acceptFlagged ? ' (lower expressiveness, chosen by you)' : ''} · TTS requests: ${voiced.calls}</div>`;
    const hard = q.checks[0].ok && q.checks[1].ok && q.checks[2].ok; $('st-render').disabled = !hard;
  }
  // ---------- voice errors: the real reason, per model, with a retry ----------
  const keyChangedRecently = () => { const t = Number(load(K.keyAt, 0)) || 0; return t > 0 && Date.now() - t < 12 * 3600 * 1000; };
  const consentModel = () => { const c = load(K.useModel, null); return c && c.fp === A.keyFp() ? c.model : ''; };
  function errInfo(err) { if (err && err.story) return err.story; const c = G.classifyError ? G.classifyError(err) : { kind: 'other', msg: redact(err && err.message || err) }; return { kind: c.kind, perModel: [Object.assign({ model: c.model || 'request' }, c)], retryAfter: c.retryAfter || 0 }; }
  let autoTimer = 0; let autoTries = 0;
  function hideErr() { $('st-voice-err').classList.add('hidden'); clearInterval(autoTimer); $('st-retry').textContent = '↻ Try again now'; }
  function showErr(info) {
    const ex = A.explain(info, { keyChangedRecently: keyChangedRecently() });
    $('st-err-title').textContent = ex.title; $('st-err-text').textContent = ex.text; $('st-err-note').textContent = ex.note || ''; $('st-err-note').classList.toggle('hidden', !ex.note);
    $('st-err-lines').innerHTML = ex.lines.map((l) => `<li>${esc(redact(l))}</li>`).join('');
    const flagged = info.kind === 'onlyFlagged' ? info.flagged : ['unavailable', 'daily', 'busy'].includes(info.kind) && info.avail && !consentModel() ? info.avail.flagged : null;
    const fb = $('st-use-flagged'); if (flagged && flagged.length) { fb.dataset.model = flagged[0]; fb.textContent = `Use ${flagged[0]} anyway (lower expressiveness)`; fb.classList.remove('hidden'); } else fb.classList.add('hidden');
    $('st-voice-err').classList.remove('hidden'); status('st-voice-status', '');
    clearInterval(autoTimer);
    if (info.kind === 'rate' && autoTries < 5) { autoTries++; let t = Math.ceil(info.retryAfter || 30) + 1; autoTimer = setInterval(() => { t--; $('st-retry').textContent = `↻ Try again now (auto in ${t} s)`; if (t <= 0) { clearInterval(autoTimer); genVoices(true); } }, 1000); }
    if (info.kind === 'daily') { save(K.queue, { at: Date.now(), fp: A.keyFp(), title: (plan.social || {}).seriesTitle }); armQueue(); }
  }
  async function genVoices(auto, o) {
    if (!plan || busy) return; busy = true; $('st-voice-go').disabled = true; hideErr();
    const useModel = (o && o.useModel) || consentModel();
    try {
      const r = await A.castVoices(plan, { useModel, rediscover: !auto, onStatus: (s) => status('st-voice-status', s, 'live') });
      autoTries = 0; voiced = Object.assign(r, { qa: A.castQa(r.lines, r.models, { acceptFlagged: r.acceptFlagged }) }); localStorage.removeItem(K.queue); clearInterval(qTimer);
      const q = voiced.qa; status('st-voice-status', q.pass ? `Voices ready and checked (${r.models.join(', ')}${r.acceptFlagged ? ', lower expressiveness' : ''}). Preview or render.` : (q.checks[0].ok ? 'Voices ready (see the notes below).' : 'Two voices sound too alike: pick a different voice for one of them and generate again.'), q.checks[0].ok ? 'ok' : 'err');
      mixBuf = null; recomputeTiming(); paintQa(); paintModels(); $('st-dur').textContent = tm.total.toFixed(1) + ' s at 24 fps';
    } catch (err) { showErr(errInfo(err)); paintModels(); }
    finally { busy = false; $('st-voice-go').disabled = false; }
  }
  function paintModels() { A.discoverModels(false).then((a) => { $('st-models').textContent = a.listed ? `Voice models on this key: ${a.all.join(', ') || 'none'}` : ''; }).catch(() => { $('st-models').textContent = ''; }); }
  $('st-voice-go').addEventListener('click', () => genVoices(false));
  $('st-retry').addEventListener('click', () => { autoTries = 0; A.resetSession(); genVoices(false); });
  $('st-use-flagged').addEventListener('click', (e) => { const m = e.currentTarget.dataset.model; save(K.useModel, { model: m, fp: A.keyFp() }); toast('Using ' + m + ' (lower expressiveness)'); genVoices(false, { useModel: m }); });
  let qTimer = 0; function armQueue() { clearInterval(qTimer); qTimer = setInterval(() => { if (!busy && load(K.queue, null) && plan) genVoices(true); }, 15 * 60 * 1000); }
  // a new key means a fresh try: forget the queue, cooled-down/dead models, the model list and any lower-expressiveness choice
  function onKeyChange() {
    save(K.keyAt, Date.now()); save(K.keyfp, A.keyFp()); localStorage.removeItem(K.queue); localStorage.removeItem(K.useModel); clearInterval(qTimer); A.resetSession(); hideErr(); $('st-models').textContent = '';
    if (plan && !voiced && G.host.getKey && G.host.getKey()) { status('st-voice-status', 'New API key: trying the voices again…', 'live'); setTimeout(() => genVoices(false), 300); }
    else if (plan && !voiced) status('st-voice-status', '');
  }
  window.addEventListener('rcp:keychange', onKeyChange);
  window.addEventListener('storage', (e) => { if (e.key === 'rcp.apiKey') onKeyChange(); });

  // ---------- preview & render ----------
  async function buildMix() { if (mixBuf) return mixBuf; recomputeTiming(); const m = await A.mix(plan, placed, tm, { music: 'storybook' }); mixBuf = A.toAudioBuffer(m); return mixBuf; }
  function stopPreview() { if (playing) { try { playing.src && playing.src.stop(); } catch (_) { /* */ } cancelAnimationFrame(playing.raf); playing = null; $('st-play').textContent = '▶ Preview'; } }
  $('st-play').addEventListener('click', async () => {
    if (!plan) return; if (playing) { stopPreview(); drawCurrent(); return; }
    const ac = VTS.render.audioCtx(); if (ac.state === 'suspended') await ac.resume(); const r = renderer(); let src = null;
    if (voiced) { const b = await buildMix(); src = ac.createBufferSource(); src.buffer = b; src.connect(ac.destination); }
    const t0 = ac.currentTime + 0.1; if (src) src.start(t0); playing = { src, raf: 0 }; $('st-play').textContent = '■ Stop';
    if (!voiced) status('st-render-status', 'Silent preview: generate the voices to hear the cast.', '');
    const tick = () => { if (!playing) return; const t = ac.currentTime - t0; if (t >= r.total) { stopPreview(); return; } r.draw(Math.max(0, t)); playing.raf = requestAnimationFrame(tick); }; tick();
  });
  $('st-render').addEventListener('click', async () => {
    if (!plan || !voiced || busy) { if (!voiced) status('st-render-status', 'Generate the voices first: Story videos are always voiced.', 'err'); return; }
    busy = true; stopPreview(); $('st-render').disabled = true; $('st-download').classList.add('hidden'); $('st-bar').classList.remove('hidden');
    try {
      const ac = VTS.render.audioCtx(); if (ac.state === 'suspended') await ac.resume(); const b = await buildMix(); const r = renderer();
      const dest = ac.createMediaStreamDestination(); const src = ac.createBufferSource(); src.buffer = b; src.connect(dest);
      const vs = canvas.captureStream(24); const stream = new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      const mime = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)); if (!mime) throw new Error('This browser cannot record video (MediaRecorder).');
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9e6, audioBitsPerSecond: 192e3 }); const chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((res) => { rec.onstop = res; });
      r.draw(0); rec.start(250); const t0 = ac.currentTime + 0.15; src.start(t0);
      await new Promise((res) => { const tick = () => { const t = ac.currentTime - t0; if (t >= r.total + 0.1) return res(); r.draw(Math.max(0, Math.min(r.total - 0.001, t))); $('st-bar-fill').style.width = Math.min(100, Math.max(0, t / r.total * 100)).toFixed(1) + '%'; status('st-render-status', `Recording ${Math.max(0, t).toFixed(1)} / ${r.total.toFixed(1)} s (real time, keep this tab open)…`, 'live'); requestAnimationFrame(tick); }; tick(); });
      rec.stop(); await stopped; let blob = new Blob(chunks, { type: mime.split(';')[0] });
      if (!/mp4/.test(mime) && VTS.render.fixWebmDuration) { try { blob = await VTS.render.fixWebmDuration(blob, r.total * 1000); } catch (_) { /* keep */ } }
      const ext = /mp4/.test(mime) ? 'mp4' : 'webm'; const a = $('st-download'); if (a.href) URL.revokeObjectURL(a.href); a.href = URL.createObjectURL(blob); a.download = ((plan.social || {}).seriesTitle || 'story').replace(/[^\w]+/g, '-').toLowerCase() + '.' + ext; a.classList.remove('hidden');
      status('st-render-status', `Rendered ${r.total.toFixed(1)} s, 1080×1920, ${ext.toUpperCase()} (${(blob.size / 1e6).toFixed(1)} MB). Captions burned in.${ext === 'webm' ? ' This browser records WebM; use Chrome 126+ for MP4.' : ''}`, 'ok');
    } catch (err) { status('st-render-status', 'Render failed: ' + redact(err && err.message || err), 'err'); }
    finally { busy = false; $('st-render').disabled = false; $('st-bar').classList.add('hidden'); }
  });

  // ---------- copy / export ----------
  async function copy(text, label) { try { await navigator.clipboard.writeText(text); toast(label + ' copied'); } catch (_) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); toast(label + ' copied'); } catch (__) { toast('Copy is not available here.', true); } t.remove(); } }
  const fileName = (ext) => ((plan.social || {}).seriesTitle || 'story').replace(/[^\w]+/g, '-').toLowerCase() + ext;
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  $('st-copy-doc').addEventListener('click', () => plan && copy(S.toMarkdown(plan), 'Story doc'));
  $('st-copy-prompts').addEventListener('click', () => plan && copy(plan.panels.map((pn, i) => `Panel ${i + 1}: ${pn.stillPrompt || S.stillPrompt(plan, pn)}`).join('\n\n'), 'Still prompts'));
  $('st-copy-social').addEventListener('click', () => plan && copy(S.socialCaption(plan), 'Social caption'));
  $('st-dl-md').addEventListener('click', () => plan && download(new Blob([S.toMarkdown(plan)], { type: 'text/markdown' }), fileName('.md')));
  $('st-dl-json').addEventListener('click', () => { if (!plan) return; const p = Object.assign({}, plan, { timing: { total: tm.total, shots: tm.shots, endCard: tm.endCard } }); download(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }), fileName('.json')); });
  $('st-dl-png').addEventListener('click', async () => { if (!plan) return; stopPreview(); const r = renderer(); for (let i = 0; i < plan.panels.length; i++) { r.drawPanel(i); const b = await new Promise((res) => canvas.toBlob(res, 'image/png')); download(b, fileName(`-panel-${String(i + 1).padStart(2, '0')}.png`)); await new Promise((res) => setTimeout(res, 350)); } toast(plan.panels.length + ' still frames saved'); drawCurrent(); });

  // ---------- boot ----------
  paintInputs(); if (plan && plan.panels) { try { S.refresh(plan); persistPlan(); paintPlan(); } catch (e) { plan = null; } }
  setMode(load(K.mode, 'myth') === 'story' ? 'story' : 'myth');
  { const fp = A.keyFp(); const was = load(K.keyfp, null); if (was !== fp) { if (was) { save(K.keyAt, Date.now()); localStorage.removeItem(K.queue); localStorage.removeItem(K.useModel); } save(K.keyfp, fp); } }
  if (load(K.queue, null) && plan) { status('st-voice-status', 'Queued: voices will be generated when the Gemini TTS quota is back (about 05:30 IST).', ''); armQueue(); setTimeout(() => genVoices(true), 4000); }
  VTS.storyUi = { setMode, get plan() { return plan; }, _test: { setVoiced(v) { voiced = v; mixBuf = null; recomputeTiming(); paintQa(); }, genVoices, onKeyChange } };
}());
