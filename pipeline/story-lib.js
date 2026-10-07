// Node side of Story mode: loads the app's own Gemini client (www/js/gemini.js, same model fallback + key handling as the app)
// and the story engine (www/js/story.js) so the pipeline plans stories exactly like the app does. Key from GEMINI_API_KEY (never printed).
'use strict';
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const W = path.join(__dirname, '../www/js');
function loadApp() {
  const ctx = { console, setTimeout, clearTimeout, AbortController, TextEncoder, TextDecoder, atob, btoa, Blob, URL, fetch };
  ctx.window = ctx; ctx.self = ctx; ctx.localStorage = { getItem: () => null, setItem() {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(W, 'gemini.js'), 'utf8'), ctx, { filename: 'gemini.js' });
  let model = process.env.MODEL || ctx.VTS.gemini.DEFAULT_MODEL;
  Object.assign(ctx.VTS.gemini.host, { getKey: () => process.env.GEMINI_API_KEY || '', getModel: () => model, setModel: (m) => { model = m; }, onModelSwitch: (a, b) => console.log('  model switch', a, '->', b) });
  return ctx.VTS;
}
const story = require('../www/js/story.js');
const red = (s) => String(s).split(process.env.GEMINI_API_KEY || '\u0000').join('REDACTED');
async function planStory(input, onStatus) {
  const V = loadApp();
  return story.generate(input, (contents, opts) => V.gemini.generate(contents, opts), { onStatus });
}
module.exports = { loadApp, planStory, story, red };
