#!/usr/bin/env node
// Receipts daily pipeline: pick N unused myths for a day and write <dir>/plan.json (resumable: an existing plan is reused).
// Usage: node pipeline/pick-topics.js <YYYY-MM-DD> <outDir> [count=6]
// env STATE_FILE (default pipeline/state/used.json), SLOTS_IST (default "08:00,11:00,14:00,17:00,20:00,23:00"),
//     GEMINI_API_KEY + TOPIC_MODEL (only when the built-in bank in myths.json runs out: Gemini invents new, non-repeating myths).
const fs = require('fs'); const path = require('path');
const [DAY, OUT, COUNT = '6'] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(DAY || '') || !OUT) { console.error('usage: pick-topics.js YYYY-MM-DD outDir [count]'); process.exit(2); }
const STATE = process.env.STATE_FILE || path.join(__dirname, 'state', 'used.json');
const BANK = JSON.parse(fs.readFileSync(path.join(__dirname, 'myths.json'), 'utf8'));
const SLOTS = (process.env.SLOTS_IST || '08:00,11:00,14:00,17:00,20:00,23:00').split(',').map((x) => x.trim());
const N = Math.min(Number(COUNT), SLOTS.length);
const planFile = path.join(OUT, 'plan.json');
fs.mkdirSync(OUT, { recursive: true });
if (fs.existsSync(planFile)) { console.log('PLAN exists', planFile); process.exit(0); }
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { used: [] };
const usedIds = new Set(state.used.map((u) => u.id)); const usedClaims = state.used.map((u) => u.claim);
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// IST is UTC+05:30 all year (no DST).
const publishAt = (day, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return new Date(Date.parse(day + 'T00:00:00Z') + ((h * 60 + m) - 330) * 60000).toISOString().replace('.000Z', 'Z'); };

const FORMAT_HINT = {
  'skeptic-vs-claim': 'Format: Skeptic vs Claim Guy, a quick comic argument.',
  'people-say': 'Format: "People say..." Open by quoting the claim, then dismantle it.',
  'got-receipts': 'Format: Got receipts. Claim Guy states the myth like a fact; the Skeptic drops receipts one by one.',
  pov: 'Format: POV. Open with "POV:" — you just confidently repeated this myth at dinner, and the Skeptic is sitting right there.',
  'nobody-me': 'Format: Nobody: / Claim Guy: — nobody asked, Claim Guy announces the myth anyway; the Skeptic answers.',
  expectation: 'Format: Expectation vs Reality: what Claim Guy promises vs what actually happens.',
};
function brief(m, fmt) {
  return [`Myth to bust: "${m.claim}".`, `The receipt (only use these facts, add no other numbers or studies): ${m.receipt}`, FORMAT_HINT[fmt] || '',
    'Cast: Claim Guy (speaker "brain") pushes the myth with at least 3 short, loud, overconfident lines ("Trust me, bro."); the Skeptic (speaker "me") flattens him with deadpan receipts. Narrator only if needed.',
    'Write it to be performed out loud: short lines, fast setups, a one-word beat before the reveal, 2-3 interjections ("Oh no.", "Sir.", "Yeah, no."), the punchline alone on its own beat. Funny, sarcastic and fast, never a dry lecture. End with a comment-bait question that loops back to the hook.'].filter(Boolean).join(' ');
}

async function generateNew(k) {
  const key = process.env.GEMINI_API_KEY; if (!key) throw new Error('myth bank exhausted and no GEMINI_API_KEY for the generator');
  const model = process.env.TOPIC_MODEL || 'gemini-3.5-flash';
  const prompt = `List ${k + 4} popular, widely believed myths or misconceptions (science, nature, history, money, tech, food; NOT psychology, health advice, politics or religion) that are clearly false according to well-established sources, each with a short receipt (1-2 sentences of well-known, verifiable facts; no invented studies or numbers). Do NOT repeat or paraphrase any of these: ${usedClaims.concat(BANK.myths.map((m) => m.claim)).join(' | ')}`;
  const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'OBJECT', properties: { claim: { type: 'STRING' }, receipt: { type: 'STRING' }, tags: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['claim', 'receipt'] } } } };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('topic generator HTTP ' + r.status);
  const j = await r.json(); const arr = JSON.parse(j.candidates[0].content.parts[0].text);
  const seen = new Set(usedClaims.concat(BANK.myths.map((m) => m.claim)).map(norm));
  return arr.filter((x) => x.claim && x.receipt && !seen.has(norm(x.claim))).map((x) => ({ id: 'gen-' + norm(x.claim).replace(/ /g, '-').slice(0, 40), claim: x.claim, receipt: x.receipt, tags: (x.tags || []).slice(0, 3), generated: true }));
}

(async () => {
  let pool = BANK.myths.filter((m) => !usedIds.has(m.id));
  if (pool.length < N) pool = pool.concat((await generateNew(N - pool.length)).filter((m) => !usedIds.has(m.id)));
  if (pool.length < N) throw new Error('not enough topics');
  const dayIdx = Math.floor(Date.parse(DAY + 'T00:00:00Z') / 86400000);
  const items = pool.slice(0, N).map((m, i) => { const fmt = BANK.formats[(dayIdx + i) % BANK.formats.length];
    return { n: i + 1, id: m.id, claim: m.claim, receipt: m.receipt, tags: m.tags || [], format: fmt, slotIST: SLOTS[i], publishAt: publishAt(DAY, SLOTS[i]), idea: brief(m, fmt) }; });
  fs.writeFileSync(planFile, JSON.stringify({ day: DAY, createdAt: new Date().toISOString(), items }, null, 1));
  state.used.push(...items.map((x) => ({ id: x.id, claim: x.claim, day: DAY, n: x.n })));
  fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
  console.log('PLAN', planFile); items.forEach((x) => console.log(x.n, x.slotIST, 'IST', x.publishAt, x.format, '|', x.claim));
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
