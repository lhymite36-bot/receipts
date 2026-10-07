// Story mode frame check: draws every panel still (and optional extra times) of a plan with the app's StoryRenderer in
// headless Chrome and writes PNGs + a contact sheet. Usage: node tests/live/story-stills.js <plan.json> <out-prefix> [t1 t2 ...]
const puppeteer = require('puppeteer-core'); const http = require('http'); const fs = require('fs'); const path = require('path');
const WWW = path.join(__dirname, '..', '..', 'www');
const [PLAN, OUT, ...TIMES] = process.argv.slice(2);
(async () => {
  const srv = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html'; const f = path.join(WWW, p); if (!f.startsWith(WWW) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.ttf': 'font/ttf' }[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('http://127.0.0.1:' + srv.address().port + '/'); await page.waitForFunction(() => window.VTS && window.VTS.storyDraw && window.VTS.story);
  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const out = await page.evaluate(async (plan, times) => {
    try { await document.fonts.load('900 100px Montserrat'); } catch (_) { /* */ }
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1920; const r = new window.VTS.storyDraw.StoryRenderer(c).setup(plan, {});
    const shots = []; const lay = [];
    for (let i = 0; i < plan.panels.length; i++) { const L = r.drawPanel(i); lay.push({ i, faces: L.faces.length, overlaps: window.VTS.storyDraw.overlaps(L) }); shots.push(c.toDataURL('image/png').split(',')[1]); }
    const extra = []; for (const t of times) { const L = r.draw(Number(t)); extra.push({ t, png: c.toDataURL('image/png').split(',')[1], overlaps: window.VTS.storyDraw.overlaps(L) }); }
    return { shots, lay, extra, total: r.total, tm: r.tm.shots.map((s) => [s.start.toFixed(2), s.dur.toFixed(2)]) };
  }, plan, TIMES);
  out.shots.forEach((b, i) => fs.writeFileSync(`${OUT}-p${String(i + 1).padStart(2, '0')}.png`, Buffer.from(b, 'base64')));
  out.extra.forEach((e) => fs.writeFileSync(`${OUT}-t${e.t}.png`, Buffer.from(e.png, 'base64')));
  console.log(JSON.stringify({ total: out.total, tm: out.tm, layout: out.lay, extra: out.extra.map((e) => ({ t: e.t, overlaps: e.overlaps })), errors: errs }));
  await browser.close(); srv.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
