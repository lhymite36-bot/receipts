#!/usr/bin/env node
// One-time YouTube authorisation for the Receipts pipeline. Stores the refresh token at ~/.secrets/receipts/youtube-refresh-token (0600). Never prints it.
//   node pipeline/yt-auth.js device     # OAuth client type "TVs and Limited Input devices": prints a URL + short code; approve on any phone/PC.
//                                       # (Google's device flow allows only the broad "youtube" scope, which includes uploads.)
//   node pipeline/yt-auth.js loopback   # OAuth client type "Desktop app": prints a URL; open it in a browser ON THIS BOX (redirects to 127.0.0.1).
//                                       # Scopes: youtube.upload + youtube.readonly (narrower).
// Client id/secret: env RECEIPTS_YT_CLIENT_ID / RECEIPTS_YT_CLIENT_SECRET or ~/.secrets/receipts/youtube-client.json.
// Sign in as lhymite36@gmail.com and pick the Receipts (@ReceiptsDaily) channel if Google asks which channel/brand account.
const http = require('http'); const crypto = require('crypto');
const C = require('./yt-common');
const EXPECT = process.env.EXPECT_CHANNEL || 'UCUCiwjjGv05mzngpmVjdTgg';
const mode = process.argv[2] || 'device';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function finish(j) {
  if (!j.refresh_token) throw new Error('no refresh_token returned (revoke the app at myaccount.google.com/permissions and retry; loopback uses prompt=consent)');
  const f = C.saveRefreshToken(j.refresh_token); console.log('Refresh token saved to', f, '(not printed). Scopes:', j.scope);
  try { const ch = await C.myChannel(j.access_token); console.log('Authorised channel(s):', JSON.stringify(ch)); if (!ch.some((c) => c.id === EXPECT)) console.log('WARNING: expected channel', EXPECT, 'not in the list. Re-run and choose the Receipts channel / brand account.'); else console.log('OK: Receipts channel confirmed.'); }
  catch (e) { console.log('Channel check skipped:', e.message); }
}
async function device() {
  const { id, secret } = C.clientCreds();
  const r = await fetch('https://oauth2.googleapis.com/device/code', { method: 'POST', body: new URLSearchParams({ client_id: id, scope: 'https://www.googleapis.com/auth/youtube' }) });
  const d = await r.json(); if (!r.ok) throw new Error('device/code HTTP ' + r.status + ' ' + JSON.stringify(d));
  console.log('\n  On your phone, open: ' + d.verification_url + '\n  Enter code:          ' + d.user_code + '\n  (expires in ' + Math.round(d.expires_in / 60) + ' min) waiting…\n');
  let iv = (d.interval || 5) * 1000; const end = Date.now() + d.expires_in * 1000;
  while (Date.now() < end) {
    await sleep(iv);
    const body = new URLSearchParams({ client_id: id, device_code: d.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }); if (secret) body.set('client_secret', secret);
    const t = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body }); const j = await t.json();
    if (t.ok) return finish(j);
    if (j.error === 'authorization_pending') continue; if (j.error === 'slow_down') { iv += 5000; continue; }
    throw new Error('device token: ' + j.error + ' ' + (j.error_description || ''));
  }
  throw new Error('device code expired');
}
async function loopback() {
  const { id, secret } = C.clientCreds();
  const verifier = crypto.randomBytes(48).toString('base64url'); const challenge = crypto.createHash('sha256').update(verifier).digest('base64url'); const state = crypto.randomBytes(12).toString('hex');
  const srv = http.createServer(); await new Promise((ok) => srv.listen(Number(process.env.PORT || 0), '127.0.0.1', ok)); const redirect = 'http://127.0.0.1:' + srv.address().port;
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  Object.entries({ client_id: id, redirect_uri: redirect, response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly', access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state, login_hint: process.env.LOGIN_HINT || 'lhymite36@gmail.com' }).forEach(([k, v]) => u.searchParams.set(k, v));
  console.log('\nOpen this URL in the browser on this machine:\n\n' + u.toString() + '\n\nwaiting…');
  const code = await new Promise((ok, bad) => srv.on('request', (req, res) => { const q = new URL(req.url, redirect).searchParams; if (!q.get('code') && !q.get('error')) { res.end(); return; }
    res.end(q.get('code') ? 'Receipts pipeline authorised. You can close this tab.' : 'Authorisation failed: ' + q.get('error')); srv.close(); if (q.get('state') !== state) bad(new Error('state mismatch')); else if (q.get('error')) bad(new Error(q.get('error'))); else ok(q.get('code')); }));
  const body = new URLSearchParams({ client_id: id, code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' }); if (secret) body.set('client_secret', secret);
  const t = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body }); const j = await t.json(); if (!t.ok) throw new Error('token exchange: ' + JSON.stringify(j));
  return finish(j);
}
(mode === 'loopback' ? loopback() : device()).catch((e) => { console.error('FATAL', e.message); process.exit(1); });
