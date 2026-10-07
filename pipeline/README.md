# Receipts daily Shorts pipeline (direct YouTube upload)

6 myth-busting Shorts a day for **Receipts (@ReceiptsDaily, UCUCiwjjGv05mzngpmVjdTgg)**, uploaded with the YouTube Data API.
No Buffer. **Status: built, not switched on yet.** YouTube credentials are still missing (see "Switch-on checklist").

```
pick-topics.js  -> plan.json      6 unused myths (myths.json: 87 myths + a Gemini generator for when they run out),
                                  rotating formats, slots 08:00 11:00 14:00 17:00 20:00 23:00 IST -> publishAt (UTC)
render-day.sh   -> rcp-shortN.mp4 Gemini script (Receipts voice) -> Gemini TTS, two cast voices -> headless 9:16 render with
                                  the Receipts web app (tests/live/e2e-live.js, comic-ink grade, classic motion,
                                  Hormozi captions, SFX + music) -> <=60 s check -> rcp-shortN.meta.json (title, #shorts, tags)
yt-upload.js    -> uploads.json   resumable videos.insert, privacy=private + publishAt per slot (YouTube publishes it on time)
yt-auth.js                        one-time OAuth (device code or loopback); refresh token -> ~/.secrets/receipts/ (0600)
run-day.sh                        render + upload in one command
state/used.json                   every myth already used (no repeats). The workflow commits it back each day
```

## Run

```bash
# box (render only, preview the upload requests):
GEMINI_API_KEY=... DRY_RUN=1 bash pipeline/run-day.sh 2026-10-08
# box (real): needs the YouTube credentials below
bash pipeline/run-day.sh 2026-10-08
# just some Shorts / just upload:
bash pipeline/render-day.sh 2026-10-08 1 2
node pipeline/yt-upload.js /workspace/receipts-pipeline/days/2026-10-08 [--dry-run]
```
GitHub Actions: workflow **Receipts daily Shorts** (`.github/workflows/receipts-daily.yml`), manual inputs day/count/privacy/dry_run.
Its cron (03:30 IST) is commented out and the job is gated on repo variable `RECEIPTS_PIPELINE_ENABLED=true`.

Env: `COUNT` (6), `LEN` (60 = ~45-58 s script), `HUMOUR` (3), `TONE` (sarcastic), `SLOTS_IST`, `OUT_ROOT`, `STATE_FILE`,
`PRIVACY` (scheduled|public|unlisted|private), `NOTIFY=false`, `SYNTHETIC=1`, `EXPECT_CHANNEL`.

## Voice (pipeline/voice.env)
Gemini TTS (same engine as Voice to Short, best TTS model available: falls back automatically), multi-speaker with per-turn style metadata:
- **Skeptic / narrator: `Kore`**, a deadpan, crisp voice with comic timing and pauses before reveals
- **Claim Guy: `Fenrir`**, an overconfident hype-bro, loud, fast and theatrical
- punchline beats get an extra "beat of silence, then slower and drier" direction
- single-voice scripts: `Kore` with a sarcastic, punchy, high-energy style
Scripts are written for the ear: short lines, interjections, punchline alone on its own beat, at least 3 Claim Guy lines
(a script without them is rejected *before* TTS is spent, twice, then accepted).

## Switch-on checklist (needs Beatrice)
1. Google Cloud project (any, under lhymite36@gmail.com) -> enable **YouTube Data API v3**.
2. OAuth consent screen: External, add lhymite36@gmail.com as a test user, then **Publish to Production**.
   In "Testing" mode refresh tokens die after 7 days. Production without verification only shows an "unverified app" warning to you.
3. Credentials -> OAuth client ID, type **TVs and Limited Input devices** (for phone approval) or **Desktop app** (approve in the box browser).
   Save the JSON to `~/.secrets/receipts/youtube-client.json`.
4. `node pipeline/yt-auth.js device`: open google.com/device on the phone, type the code, sign in as lhymite36@gmail.com,
   pick the **Receipts** channel, and allow. (The device flow only accepts the broad `youtube` scope, which includes uploads.)
5. For Actions: repo secrets `GEMINI_API_KEY`, `RECEIPTS_YT_CLIENT_ID`, `RECEIPTS_YT_CLIENT_SECRET`, `RECEIPTS_YT_REFRESH_TOKEN`,
   variable `RECEIPTS_PIPELINE_ENABLED=true`, `gh workflow enable receipts-daily.yml`, then uncomment `schedule`.
6. **Public visibility needs a YouTube API compliance audit.** Uploads from API projects created after 28 Jul 2020 that have not been audited are
   **locked private**. That cannot be appealed or changed in Studio. Apply with the "YouTube API Services - Audit and Quota Extension Form".
   Until approved, uploads are only useful as a test (`PRIVACY=private`).

Quota: since Jun 2026 `videos.insert` has its own bucket (100 uploads/day, 1 unit each); 6/day plus a channels.list check is far below the limit.
YouTube has also been seen enforcing an undocumented "Video Uploads per day" limit of roughly 7 per project per day. 6 fits under it.
