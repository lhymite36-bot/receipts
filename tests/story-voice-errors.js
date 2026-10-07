// Story voice step with mocked Gemini responses: each failure shows its real reason (per-minute limit, daily quota, model not
// available, invalid key, network), a new key gets a fresh try, and model discovery picks what the key can use.
// No network.  node tests/story-voice-errors.js
'use strict';
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const W = path.join(__dirname, '..', 'www', 'js');
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'story-plan.json'), 'utf8'));
let pass = 0; let fail = 0; const ok = (n, c, v) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + n + (c || v === undefined ? '' : '  ' + JSON.stringify(v).slice(0, 400))); };
// fake TTS audio: harmonic tone 0.9 s per paragraph with 0.6 s pauses, 16-bit PCM base64
function pcm(paras, f0) { const R = 24000; const parts = []; for (let k = 0; k < paras; k++) { const n = Math.round(R * 0.9); for (let i = 0; i < n; i++) { const f = f0 * Math.pow(2, 2.5 * Math.sin(6.28 * 1.4 * i / R) / 12); parts.push(0.3 * Math.sin(6.283 * f * i / R) * Math.sin(Math.PI * i / n)); } for (let i = 0; i < R * 0.6; i++) parts.push(0); } const b = Buffer.alloc(parts.length * 2); parts.forEach((v, i) => b.writeInt16LE(Math.round(v * 32767), i * 2)); return b.toString('base64'); }
const err = (status, apiStatus, message, details) => ({ status, body: { error: { code: status, status: apiStatus, message, details: details || [] } } });
const quota = (id, delay) => err(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota, please check your plan and billing details.', [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: id, quotaValue: '10' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: delay }]);
const PER_MIN = () => quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '1s');
const PER_DAY = () => quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '76000s');
const NOT_FOUND = (m) => err(404, 'NOT_FOUND', `models/${m} is not found for API version v1beta, or is not supported for generateContent.`);
const BAD_KEY = () => err(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.', [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }]);
const AUDIO = (n, f0) => ({ status: 200, body: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm(n, f0) } }] } }] } });
const listOf = (names) => ({ status: 200, body: { models: names.map((n) => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) } });

function boot() {
  const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, TextEncoder, TextDecoder, Blob, URL, atob: (s) => Buffer.from(s, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64') };
  ctx.window = ctx; ctx.self = ctx; ctx.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  ctx.state = { key: 'AQ.test-key-0000000000', route: () => ({ status: 500, body: {} }), calls: [] };
  ctx.fetch = async (url, init) => { const u = String(url); const m = /models\/([^:?]+):generateContent/.exec(u); const key = (init && init.headers && init.headers['x-goog-api-key']) || ''; ctx.state.calls.push(m ? m[1] : 'list');
    const r = ctx.state.route(m ? m[1] : 'list', key, init); if (r instanceof Error) throw r; return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body }; };
  vm.createContext(ctx);
  for (const f of ['gemini.js', 'story.js', 'storyaudio.js']) vm.runInContext(fs.readFileSync(path.join(W, f), 'utf8'), ctx, { filename: f });
  ctx.VTS.gemini.host.getKey = () => ctx.state.key; ctx.VTS.storyAudio.knobs.minWait = 1; ctx.VTS.storyAudio.knobs.netWait = 10;
  return ctx;
}
const ALLOWED = ['gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts'];
async function run(name, route, list, o) {
  const ctx = boot(); const A = ctx.VTS.storyAudio; ctx.state.route = (model, key) => (model === 'list' ? (typeof list === 'function' ? list(key) : listOf(list)) : route(model, key));
  try { const r = await A.castVoices(plan, o || {}); return { ok: true, r, ctx, A }; } catch (e) { return { ok: false, e, info: e.story || null, ex: A.explain(e.story || { kind: 'other', perModel: [] }, (o && o.ctx) || {}), ctx, A }; }
}
(async () => {
  // 1) per-minute limit on both models: rate (auto-retry), shows the model + PerMinute quotaId
  let t = await run('rate', () => PER_MIN(), ALLOWED);
  ok('429 per-minute -> "per-minute voice limit", auto-retry, model + quotaId shown', !t.ok && t.info.kind === 'rate' && /per-minute/i.test(t.ex.title) && /retries automatically/.test(t.ex.text) && t.ex.lines.some((l) => l.includes('gemini-3.8-flash-tts') && /PerMinute/.test(l)), t.ex);
  ok('per-minute limit is retried on the same model before giving up (3 tries per model)', t.ctx.state.calls.filter((c) => c === 'gemini-3.8-flash-tts').length === 3, t.ctx.state.calls);
  // 1b) per-minute limit that clears: succeeds after the wait
  let n = 0; t = await run('rate-clears', (m) => (m === 'gemini-3.8-flash-tts' && n++ === 0 ? PER_MIN() : AUDIO(2, 200)), ALLOWED);
  ok('per-minute limit that clears -> voices made after the retryDelay wait', t.ok && t.r.models.includes('gemini-3.8-flash-tts'), t.ok ? t.r.models : t.ex);
  // 2) daily quota on both models
  t = await run('daily', () => PER_DAY(), ALLOWED);
  ok('429 per-day -> "daily quota used up", reset time, queued', !t.ok && t.info.kind === 'daily' && /quota is used up/.test(t.ex.title) && /05:30 IST/.test(t.ex.text) && t.ex.lines.every((l) => /daily quota/.test(l) && /PerDay/.test(l)), t.ex);
  ok('daily quota is not retried (1 request per model)', t.ctx.state.calls.filter((c) => c !== 'list').length === 2, t.ctx.state.calls);
  const shared = t.A.explain(t.info, { keyChangedRecently: true });
  ok('daily right after a key change -> explains keys from the same Google account share one quota', /same Google account/.test(shared.note) && /different Google account/.test(shared.note), shared.note);
  // 3) model not available (404) for both allowed models, key lists them anyway
  t = await run('404', (m) => NOT_FOUND(m), ALLOWED.concat(['gemini-3.8-flash-lite-tts']));
  ok('404 model not found -> "can\u2019t use the Story voice models", names the models, offers the lite model', !t.ok && t.info.kind === 'unavailable' && /can.t use the Story voice models/.test(t.ex.title) && /gemini-2\.5-flash-preview-tts/.test(t.ex.text) && /gemini-3\.8-flash-lite-tts \(lower expressiveness\)/.test(t.ex.text), t.ex);
  // 3b) user's likely case: 3.8 daily, 2.5 not available for an AQ key
  t = await run('mixed', (m) => (m === 'gemini-3.8-flash-tts' ? PER_DAY() : NOT_FOUND(m)), ALLOWED);
  ok('3.8 daily + 2.5 404 -> daily, with BOTH per-model reasons listed', !t.ok && t.info.kind === 'daily' && t.ex.lines.length === 2 && /daily quota/.test(t.ex.lines[0]) && /not available/.test(t.ex.lines[1]), t.ex.lines);
  // 4) invalid key (on the model list call)
  t = await run('badkey', () => AUDIO(1, 200), () => BAD_KEY());
  ok('400 API_KEY_INVALID -> "Gemini rejected this API key", Google message shown', !t.ok && t.info.kind === 'key' && /rejected this API key/.test(t.ex.title) && t.ex.lines.some((l) => /API key not valid/.test(l)), t.ex);
  // 4b) invalid key on generate (list worked from cache-less path)
  t = await run('badkey2', () => BAD_KEY(), ALLOWED);
  ok('400 invalid key on generate -> key error, stops at once (no model hopping)', !t.ok && t.info.kind === 'key' && t.ctx.state.calls.filter((c) => c !== 'list').length === 1, t.ctx.state.calls);
  // 5) network
  t = await run('net', () => new TypeError('Failed to fetch'), () => new TypeError('Failed to fetch'));
  ok('network error -> "Couldn\u2019t reach Google"', !t.ok && t.info.kind === 'network' && /reach Google/.test(t.ex.title), t.ex);
  // 6) discovery: only flagged/lite models -> ask; consent -> works, labelled lower expressiveness, QA still runs
  t = await run('flagged', () => AUDIO(2, 220), ['gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview']);
  ok('key offers only lite/flagged models -> "only offers a lower-expressiveness voice model", no TTS request made', !t.ok && t.info.kind === 'onlyFlagged' && /lower-expressiveness/.test(t.ex.title) && t.ctx.state.calls.length === 1, t.ex);
  t = await run('flagged-ok', (m) => AUDIO(2, m.includes('lite') ? 210 : 150), ['gemini-3.8-flash-lite-tts'], { useModel: 'gemini-3.8-flash-lite-tts' });
  const q = t.ok && t.A.castQa(t.r.lines, t.r.models, { acceptFlagged: t.r.acceptFlagged });
  ok('user chose the lite model -> voices made, QA labels it "lower-expressiveness model chosen by you"', t.ok && t.r.acceptFlagged && q.checks[1].ok && /chosen by you/.test(q.checks[1].name), t.ok ? q.checks[1] : t.ex);
  ok('without the choice the lite model is still refused by QA', t.ok && !t.A.castQa(t.r.lines, t.r.models).checks[1].ok);
  // 7) discovery: neither allowed model, but another non-flagged TTS model -> used
  t = await run('other', () => AUDIO(2, 200), ['gemini-2.5-pro-preview-tts', 'gemini-3.8-flash-lite-tts']);
  ok('neither allowed model, another non-flagged TTS model offered -> used (QA model check passes)', t.ok && t.r.models.join() === 'gemini-2.5-pro-preview-tts' && t.A.castQa(t.r.lines, t.r.models).checks[1].ok, t.ok ? t.r.models : t.ex);
  // 8) new key = fresh try: daily-dead models are forgotten when the key changes
  { const ctx = boot(); const A = ctx.VTS.storyAudio; ctx.state.route = (m, key) => (m === 'list' ? listOf(ALLOWED) : key === 'AQ.new-key-111111111111' ? AUDIO(2, 200) : PER_DAY());
    let first = null; try { await A.castVoices(plan, {}); } catch (e) { first = e.story.kind; }
    const before = ctx.state.calls.length; try { await A.castVoices(plan, {}); } catch (e) { /* still daily, from memory */ } const reqSameKey = ctx.state.calls.slice(before).filter((c) => c !== 'list').length;
    ctx.state.key = 'AQ.new-key-111111111111'; let r2 = null; try { r2 = await A.castVoices(plan, {}); } catch (e) { r2 = e; }
    ok('same key: daily-dead models are not re-requested for a while', first === 'daily' && reqSameKey === 0, { first, reqSameKey });
    ok('new key: fresh try straight away (session reset), voices made', r2 && r2.lines && r2.lines.length > 0, r2 && r2.story); }
  // 8b) live-seen case: a model whose free-tier limits are all 0 (gemini-2.5-pro-preview-tts): PerMinute + PerDay, no quotaValue, retry in hours
  const NOFREE = () => err(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota.', [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateContentInputTokensPerModelPerMinute-FreeTier' }, { quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }, { quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '73631s' }]);
  t = await run('nofree', (m) => (m === 'gemini-2.5-pro-preview-tts' ? NOFREE() : PER_DAY()), ALLOWED.concat(['gemini-2.5-pro-preview-tts']));
  ok('3.8 + 2.5 daily, pro has no free tier -> daily (not "per-minute"), pro labelled "no free-tier quota", no waiting', !t.ok && t.info.kind === 'daily' && t.ex.lines.some((l) => /pro-preview-tts: no free-tier quota/.test(l)) && t.ctx.state.calls.filter((c) => c === 'gemini-2.5-pro-preview-tts').length === 1, t.ex.lines);
  const PER_MIN_LONG = () => quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '5000s');
  t = await run('longwait', () => PER_MIN_LONG(), ['gemini-3.8-flash-tts']);
  ok('a retryDelay of hours is reported as daily quota, never waited on', !t.ok && t.info.kind === 'daily' && t.ctx.state.calls.filter((c) => c !== 'list').length === 1, t.info.kind);
  // 9) happy path
  t = await run('happy', (m) => AUDIO(2, 200), ALLOWED);
  ok('happy path: allowed model, all lines voiced', t.ok && t.r.models.join() === 'gemini-3.8-flash-tts' && t.r.lines.length === t.ctx.VTS.story.voiceLines(plan).length, t.ok ? t.r.models : t.ex);
  console.log(`story-voice-errors: ${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
