// Debug probe: builds the renderer exactly like preview-offline.js and dumps the SFX cue list, the caption chunks per beat
// and (STEMS=dir) separate voice / music / sfx stems of the app mix. Usage: node tests/live/probe-mix.js <pkg.json> <voice.wav> [look.json]
const puppeteer = require('puppeteer-core'); const http = require('http'); const fs = require('fs'); const path = require('path');
const WWW = path.join(__dirname, '..', '..', 'www');
const [PKG, AUDIO, LOOKF] = process.argv.slice(2);
(async () => {
  const pk0 = JSON.parse(fs.readFileSync(PKG, 'utf8')); const pkg = pk0.pkg || pk0;
  const srv = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html'; let f = path.join(WWW, p); if (p === '/__audio.wav') f = AUDIO; if ((!f.startsWith(WWW) && f !== AUDIO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200); res.end(fs.readFileSync(f)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage(); page.on('pageerror', (e) => console.error('PAGEERR', String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/'); await page.waitForFunction(() => window.VTS && window.VTS.render && window.VTS.audiofx);
  const lookx = LOOKF ? JSON.parse(fs.readFileSync(LOOKF, 'utf8')) : {};
  const out = await page.evaluate(async (pkg, lookx, stems) => {
    const R = window.VTS.render; const buf = await R.decodeBlob(await (await fetch('/__audio.wav')).blob());
    const P = R.plan(buf, Math.max(60, buf.duration + 2)); const c = document.createElement('canvas'); const [cw, ch] = R.frameSize('9:16', 1); c.width = cw; c.height = ch;
    const look = Object.assign({ preset: 'teal', aspect: '9:16', visual: 'scenes', captionStyle: 'tiktok', captionCase: 'upper', intensity: 'punchy', hook: true, cta: true, autoEmoji: true, loop: true, progress: true, sfx: true, music: 'quirky', textHook: pkg.textHook || '', ctaSticker: pkg.cta || '', template: 'classic', humour: 3, anim: '2d', motion: 'classic', handle: '' }, lookx);
    const r = new R.Renderer(c); r.setup(Object.assign({}, look, { beats: pkg.beats, speechStart: P.speechStart, speechEnd: P.speechEnd, duration: P.total, sections: null, speech: P.speech }));
    r.env = window.VTS.motion.envelopeFromBuffer(buf); await r.prepare();
    const res = { total: P.total, cues: r.cx.cues, fx: r.cx.fx.map((f) => f.type + '@' + f.start.toFixed(2)), shots: (r.shots || []).map((s) => [s.start, s.transition]),
      beats: r.timeline.map((b) => ({ s: +b.start.toFixed(2), e: +b.end.toFixed(2), text: b.text, words: b.words, wt: (b.wordTimes || []).map((x) => +x.toFixed(2)), chunks: (b.chunks || []).map((q) => q.map((k) => b.words[k]).join(' ')) })) };
    if (stems) {
      const enc = (m) => { const L = m.getChannelData(0); const n = L.length; const a = new Int16Array(n); for (let i = 0; i < n; i++) a[i] = Math.max(-1, Math.min(1, L[i])) * 32767; let s = ''; const u = new Uint8Array(a.buffer); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return { sr: m.sampleRate, b64: btoa(s) }; };
      const base = { total: P.total, lead: 0.3, audioDur: P.audioDur, musicVol: look.musicVol, sfxVol: look.sfxVol, voiceVol: look.voiceVol, duckDb: look.duckDb, sfxLowpassHz: look.sfxLowpassHz, sfxPeak: look.sfxPeak, stampDb: look.stampDb, stampIds: look.stampIds }; // same options as preview-offline.js
      res.stems = {
        full: enc(await window.VTS.audiofx.mix(buf, Object.assign({}, base, { cues: r.cx.cues, music: look.music }))),
        music: enc(await window.VTS.audiofx.mix(buf, Object.assign({}, base, { cues: [], music: look.music, voiceVol: 0 }))),
        sfx: enc(await window.VTS.audiofx.mix(buf, Object.assign({}, base, { cues: r.cx.cues, music: 'none', voiceVol: 0 }))),
        voice: enc(await window.VTS.audiofx.mix(buf, Object.assign({}, base, { cues: [], music: 'none' }))) };
    }
    return res;
  }, pkg, lookx, !!process.env.STEMS);
  if (out.stems) { fs.mkdirSync(process.env.STEMS, { recursive: true }); for (const [k, v] of Object.entries(out.stems)) { const pcm = Buffer.from(v.b64, 'base64'); const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(v.sr, 24); h.writeUInt32LE(v.sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40); fs.writeFileSync(path.join(process.env.STEMS, k + '.wav'), Buffer.concat([h, pcm])); } delete out.stems; }
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
