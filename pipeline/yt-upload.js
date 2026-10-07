#!/usr/bin/env node
// Uploads a day's rendered Receipts Shorts straight to YouTube (Data API v3 videos.insert, resumable upload).
// Usage: node pipeline/yt-upload.js <dayDir> [n ...] [--dry-run]
//   PRIVACY=scheduled (default): status.privacyStatus=private + status.publishAt=<slot>; YouTube flips it public at that time.
//            Slots already in the past (or <15 min away) are uploaded as public right away.
//   PRIVACY=public|unlisted|private: upload with that status (no publishAt).
//   NOTIFY=false skips subscriber notifications; SYNTHETIC=1 sets status.containsSyntheticMedia=true.
//   EXPECT_CHANNEL (default UCUCiwjjGv05mzngpmVjdTgg) — aborts if the token belongs to another channel.
// Auth: RECEIPTS_YT_CLIENT_ID, RECEIPTS_YT_CLIENT_SECRET, RECEIPTS_YT_REFRESH_TOKEN (env) or ~/.secrets/receipts/*.
// NOTE: projects that have not passed YouTube's API compliance audit get every upload locked to private (see pipeline/README.md).
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const C = require('./yt-common');
const args = process.argv.slice(2); const DRY = args.includes('--dry-run'); const pos = args.filter((a) => !a.startsWith('--'));
const DIR = pos[0]; if (!DIR) { console.error('usage: yt-upload.js <dayDir> [n ...] [--dry-run]'); process.exit(2); }
const EXPECT = process.env.EXPECT_CHANNEL || 'UCUCiwjjGv05mzngpmVjdTgg';
const PRIVACY = process.env.PRIVACY || 'scheduled';
const plan = JSON.parse(fs.readFileSync(path.join(DIR, 'plan.json'), 'utf8'));
const want = pos.slice(1).map(Number); const items = plan.items.filter((x) => !want.length || want.includes(x.n));
const logFile = path.join(DIR, 'uploads.json'); const log = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf8')) : [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function probe(f) {
  const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', f]).toString());
  const v = p.streams.find((s) => s.codec_type === 'video'); return { w: v.width, h: v.height, d: Number(p.format.duration), audio: p.streams.some((s) => s.codec_type === 'audio') };
}
function resource(meta) {
  const status = { selfDeclaredMadeForKids: false, embeddable: true, license: 'youtube' };
  if (PRIVACY === 'scheduled') {
    if (Date.parse(meta.publishAt) - Date.now() > 15 * 60000) { status.privacyStatus = 'private'; status.publishAt = meta.publishAt; } else status.privacyStatus = 'public';
  } else status.privacyStatus = PRIVACY;
  if (process.env.SYNTHETIC === '1') status.containsSyntheticMedia = true;
  return { snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: meta.categoryId || '27', defaultLanguage: 'en', defaultAudioLanguage: 'en' }, status };
}
async function upload(tok, file, body) {
  const size = fs.statSync(file).size; const notify = process.env.NOTIFY === 'false' ? 'false' : 'true';
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=' + notify, {
    method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(size), 'x-upload-content-type': 'video/mp4' }, body: JSON.stringify(body) });
  if (!init.ok) throw new Error('upload init HTTP ' + init.status + ' ' + (await init.text()).slice(0, 500));
  const loc = init.headers.get('location'); const data = fs.readFileSync(file);
  for (let a = 1; a <= 5; a++) {
    let start = 0;
    if (a > 1) { // ask how much arrived, then resume
      const q = await fetch(loc, { method: 'PUT', headers: { authorization: 'Bearer ' + tok, 'content-range': 'bytes */' + size } });
      if (q.status === 200 || q.status === 201) return q.json();
      const rg = q.headers.get('range'); start = rg ? Number(rg.split('-')[1]) + 1 : 0;
    }
    try {
      const r = await fetch(loc, { method: 'PUT', headers: { authorization: 'Bearer ' + tok, 'content-type': 'video/mp4', 'content-length': String(size - start), 'content-range': 'bytes ' + start + '-' + (size - 1) + '/' + size }, body: data.subarray(start) });
      if (r.status === 200 || r.status === 201) return r.json();
      const t = await r.text(); if (r.status < 500 && r.status !== 308) throw Object.assign(new Error('upload HTTP ' + r.status + ' ' + t.slice(0, 500)), { fatal: true });
      console.log('  upload attempt', a, 'HTTP', r.status, '- resuming');
    } catch (e) { if (e.fatal) throw e; console.log('  upload attempt', a, 'error', e.message, '- resuming'); }
    await sleep(a * 5000);
  }
  throw new Error('upload failed after retries');
}
(async () => {
  const todo = [];
  for (const it of items) {
    const file = path.join(DIR, 'rcp-short' + it.n + '.mp4'); const mf = path.join(DIR, 'rcp-short' + it.n + '.meta.json');
    if (log.some((x) => x.n === it.n && x.videoId)) { console.log('SKIP', it.n, '(already uploaded)'); continue; }
    if (!fs.existsSync(file) || !fs.existsSync(mf)) { console.log('MISSING', it.n, file); continue; }
    const pr = probe(file); if (!(pr.h > pr.w) || pr.d > 60.5 || !pr.audio) { console.log('INVALID', it.n, JSON.stringify(pr), '(needs vertical, <=60 s, with audio)'); continue; }
    todo.push({ it, file, meta: JSON.parse(fs.readFileSync(mf, 'utf8')), pr });
  }
  if (DRY) { todo.forEach((x) => console.log('DRY', x.it.n, x.file, JSON.stringify(x.pr), JSON.stringify(resource(x.meta), null, 1))); return; }
  if (!todo.length) { console.log('nothing to upload'); return; }
  const tok = await C.accessToken();
  try { const ch = await C.myChannel(tok); if (!ch.some((c) => c.id === EXPECT)) throw new Error('token is for ' + JSON.stringify(ch) + ', expected ' + EXPECT); console.log('channel OK', JSON.stringify(ch)); }
  catch (e) { if (/expected/.test(e.message)) throw e; console.log('channel check skipped:', e.message); }
  for (const x of todo) {
    const body = resource(x.meta); console.log('UPLOAD', x.it.n, x.meta.title, '|', body.status.privacyStatus, body.status.publishAt || '');
    const v = await upload(tok, x.file, body);
    const e = { n: x.it.n, id: x.it.id, title: x.meta.title, videoId: v.id, url: 'https://youtube.com/shorts/' + v.id, privacyStatus: v.status && v.status.privacyStatus, publishAt: v.status && v.status.publishAt, uploadStatus: v.status && v.status.uploadStatus, uploadedAt: new Date().toISOString() };
    log.push(e); fs.writeFileSync(logFile, JSON.stringify(log, null, 1)); console.log('  OK', JSON.stringify(e));
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
