// Shared offline harness for Story tests: loads the app's story engine + renderer + audio in a vm with a recording mock canvas
// (no Chrome, no network). The mock implements what the renderer calls; measureText is ~0.55 em per character.
'use strict';
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const W = path.join(__dirname, '../www/js');
function mockCtx() {
  const st = { font: '10px x', calls: [] }; const noop = () => {}; const grad = { addColorStop() {} }; let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; const stack = [];
  const api = {
    measureText: (s) => ({ width: String(s).length * (parseInt((/(\d+)px/.exec(st.font) || [0, 10])[1], 10) * 0.55) }),
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    setTransform: (a, b, c, d, e, f) => { m = { a, b, c, d, e, f }; }, getTransform: () => Object.assign({}, m),
    translate: (x, y) => { m = { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e + m.a * x + m.c * y, f: m.f + m.b * x + m.d * y }; },
    scale: (sx, sy) => { m = { a: m.a * sx, b: m.b * sx, c: m.c * sy, d: m.d * sy, e: m.e, f: m.f }; },
    rotate: (r) => { const c = Math.cos(r); const s = Math.sin(r); m = { a: m.a * c + m.c * s, b: m.b * c + m.d * s, c: -m.a * s + m.c * c, d: -m.b * s + m.d * c, e: m.e, f: m.f }; },
    save: () => stack.push(Object.assign({}, m)), restore: () => { if (stack.length) m = stack.pop(); },
    fillText: (s, x, y) => st.calls.push({ s, x, y }),
  };
  return new Proxy(st, { get: (t, k) => (k in api ? api[k] : k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
}
function load() {
  const ctx = { console, Math, Date, JSON, Float32Array, Float64Array, Uint8Array, Int16Array, DataView, ArrayBuffer, Map, Set, Promise, setTimeout };
  ctx.window = ctx; ctx.self = ctx; vm.createContext(ctx);
  for (const f of ['story.js', 'storydraw.js', 'storyaudio.js', 'audiofx.js']) vm.runInContext(fs.readFileSync(path.join(W, f), 'utf8'), ctx, { filename: f });
  return ctx.VTS;
}
function canvas() { const c = mockCtx(); return { width: 1080, height: 1920, getContext: () => c, ctx: c }; }
module.exports = { load, canvas, mockCtx };
