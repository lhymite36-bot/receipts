// Debug: draw single frames of the real renderer (same setup as preview-offline.js) and save PNGs, plus a JSON probe.
// Usage: node tests/live/frames-at.js <pkg.json> <voice.wav> <look.json|-> <out-prefix> t1 [t2 ...]   (env PROBE='js expr on r')
const puppeteer = require('puppeteer-core'); const http = require('http'); const fs = require('fs'); const path = require('path');
const WWW = path.join(__dirname, '..', '..', 'www');
const [PKG, AUDIO, LOOKF, PREFIX, ...TS] = process.argv.slice(2);
(async () => {
  const pk0 = JSON.parse(fs.readFileSync(PKG, 'utf8')); const pkg = pk0.pkg || pk0;
  const srv = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html'; let f = path.join(WWW, p); if (p === '/__audio.wav') f = AUDIO; if ((!f.startsWith(WWW) && f !== AUDIO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200); res.end(fs.readFileSync(f)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage(); page.on('pageerror', (e) => console.error('PAGEERR', String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/'); await page.waitForFunction(() => window.VTS && window.VTS.render && window.VTS.motion);
  const lookx = Object.assign(LOOKF && LOOKF !== '-' ? JSON.parse(fs.readFileSync(LOOKF, 'utf8')) : {}, process.env.LOOK_OVERRIDE ? JSON.parse(process.env.LOOK_OVERRIDE) : {});
  const out = await page.evaluate(async (pkg, lookx, ts, probe) => {
    const R = window.VTS.render; const buf = await R.decodeBlob(await (await fetch('/__audio.wav')).blob());
    const P = R.plan(buf, Math.max(60, buf.duration + 2)); const c = document.createElement('canvas'); const [cw, ch] = R.frameSize('9:16', 1); c.width = cw; c.height = ch;
    const look = Object.assign({ preset: 'teal', aspect: '9:16', visual: 'scenes', captionStyle: 'tiktok', captionCase: 'upper', intensity: 'punchy', hook: true, cta: true, autoEmoji: true, loop: true, progress: true, sfx: false, music: 'none', textHook: pkg.textHook || '', ctaSticker: pkg.cta || '', template: 'classic', humour: 2, anim: '2d', motion: 'classic', handle: '' }, lookx);
    try { await document.fonts.load('900 100px Montserrat'); } catch (_) { /* */ }
    const r = new R.Renderer(c); r.setup(Object.assign({}, look, { beats: pkg.beats, speechStart: P.speechStart, speechEnd: P.speechEnd, duration: P.total, sections: null, speech: P.speech }));
    r.env = window.VTS.motion.envelopeFromBuffer(buf); await r.prepare();
    const frames = []; const probes = [];
    for (const t of ts) { r.draw(t); frames.push(c.toDataURL('image/png').split(',')[1]); if (probe) { try { probes.push([t, eval(probe)]); } catch (e) { probes.push([t, String(e)]); } } }
    return { frames, probes, fx: r.cx.fx, shots: (r.shots || []).map((s) => [s.start, s.transition]), hookEnd: r.cx.hookEnd };
  }, pkg, lookx, TS.map(Number), process.env.PROBE || '');
  out.frames.forEach((b, k) => fs.writeFileSync(PREFIX + TS[k] + '.png', Buffer.from(b, 'base64'))); delete out.frames;
  console.log(JSON.stringify(out));
  await browser.close(); srv.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
