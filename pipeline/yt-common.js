// Shared helpers for the Receipts YouTube scripts. Never prints tokens or client secrets.
const fs = require('fs'); const path = require('path');
const SECRETS_DIR = process.env.RECEIPTS_SECRETS_DIR || '/home/box/.secrets/receipts';
const readMaybe = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch (_) { return ''; } };
function clientCreds() {
  let id = process.env.RECEIPTS_YT_CLIENT_ID || ''; let secret = process.env.RECEIPTS_YT_CLIENT_SECRET || '';
  const jf = process.env.RECEIPTS_YT_CLIENT_JSON || path.join(SECRETS_DIR, 'youtube-client.json'); // the JSON downloaded from Google Cloud Console
  if ((!id || !secret) && fs.existsSync(jf)) { const j = JSON.parse(fs.readFileSync(jf, 'utf8')); const c = j.installed || j.web || j; id = id || c.client_id; secret = secret || c.client_secret; }
  if (!id) throw new Error('missing RECEIPTS_YT_CLIENT_ID (or ' + jf + ')');
  return { id, secret };
}
const REFRESH_FILE = process.env.RECEIPTS_YT_REFRESH_FILE || path.join(SECRETS_DIR, 'youtube-refresh-token');
const refreshToken = () => process.env.RECEIPTS_YT_REFRESH_TOKEN || readMaybe(REFRESH_FILE);
function saveRefreshToken(tok) { fs.mkdirSync(path.dirname(REFRESH_FILE), { recursive: true, mode: 0o700 }); fs.writeFileSync(REFRESH_FILE, tok + '\n', { mode: 0o600 }); return REFRESH_FILE; }
async function accessToken() {
  const rt = refreshToken(); if (!rt) throw new Error('missing RECEIPTS_YT_REFRESH_TOKEN (or ' + REFRESH_FILE + '); run pipeline/yt-auth.js once');
  const { id, secret } = clientCreds();
  const body = new URLSearchParams({ client_id: id, refresh_token: rt, grant_type: 'refresh_token' }); if (secret) body.set('client_secret', secret);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('token refresh failed: HTTP ' + r.status + ' ' + (j.error || '') + ' ' + (j.error_description || '') + (j.error === 'invalid_grant' ? ' (refresh token revoked/expired: if the OAuth app is in "Testing" mode tokens expire after 7 days; publish it to Production and re-run yt-auth.js)' : ''));
  return j.access_token;
}
async function api(tok, method, url, body) {
  const r = await fetch(url, { method, headers: Object.assign({ authorization: 'Bearer ' + tok }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(method + ' ' + url.split('?')[0] + ' HTTP ' + r.status + ' ' + JSON.stringify(j.error && j.error.errors || j.error || j).slice(0, 400)); e.status = r.status; throw e; } return j;
}
async function myChannel(tok) { const j = await api(tok, 'GET', 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true'); return (j.items || []).map((c) => ({ id: c.id, title: c.snippet.title, handle: c.snippet.customUrl })); }
module.exports = { clientCreds, refreshToken, saveRefreshToken, accessToken, api, myChannel, REFRESH_FILE, SECRETS_DIR };
