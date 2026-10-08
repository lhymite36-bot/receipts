#!/usr/bin/env node
// Blind listen for Story voice QA (Gemini, audio only: no captions, no picture, no script, file names hidden).
// For each clip: perceived gender + confidence, adult / child impression, and the exact words heard (word by word).
// usage: node pipeline/voice-listen.js a.wav [b.wav ...]   env GEMINI_API_KEY; LISTEN_MODELS (comma list, first that answers)
// Prints JSON [{ file, model, gender, confidence, age, words, notes }]. Uses the text/audio model quota, never TTS.
'use strict';
const fs = require('fs');
const KEY = process.env.GEMINI_API_KEY; if (!KEY) { console.error('NO GEMINI_API_KEY'); process.exit(2); }
const MODELS = (process.env.LISTEN_MODELS || 'gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash').split(',').map((s) => s.trim()).filter(Boolean);
const ASK = 'You are a blind listening test. Listen ONLY to the audio clip (a single short line of speech). Do not guess from any context. '
  + 'Answer strictly as JSON: {"gender":"male"|"female"|"unclear","confidence":0..1,"age":"child"|"teen"|"adult"|"unclear",'
  + '"words":"exactly the words you hear, in order, including fillers, false starts and repeats; write a word you cannot make out as [?]",'
  + '"unclearWords":["any word that is weak, swallowed or ambiguous, with what it could be"],"delivery":"flat"|"natural"|"expressive","robotic":true|false,'
  + '"notes":"one short sentence on how the voice sounds"}';
async function ask(model, wav) {
  const body = { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: fs.readFileSync(wav).toString('base64') } }, { text: ASK }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(Number(process.env.LISTEN_TIMEOUT_MS || 60000)) });
  const j = await r.json(); if (!r.ok) throw new Error(`${model} HTTP ${r.status} ${String((j.error && j.error.message) || '').slice(0, 100)}`);
  const t = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((p) => p.text || '').join(''); return JSON.parse(t.replace(/^```json|```$/g, '').trim());
}
(async () => {
  const out = [];
  for (const f of process.argv.slice(2)) {
    let res = null; const errs = [];
    for (const m of MODELS) { try { res = Object.assign({ file: f, model: m }, await ask(m, f)); break; } catch (e) { errs.push(String(e.message)); console.error(`  ${f}: ${String(e.message).slice(0, 120)}`); } }
    out.push(res || { file: f, error: errs });
  }
  console.log(JSON.stringify(out, null, 1));
})();
