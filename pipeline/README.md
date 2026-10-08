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

## Voice (pipeline/voice.env + pipeline/voice-cast.js)
Each character is voiced **separately** with Gemini TTS (prebuilt voices), then assembled with our own timing:
- **Skeptic / narrator: `Algenib`**, a low, gravelly voice (~110-130 Hz), dry/deadpan/sarcastic style, clipped,
  "..." before punchlines, 0.6 s silence before each punch beat
- **Claim Guy: `Puck`**, a bright, high voice (~225 Hz), loud/fast/hyped influencer style, ~6 dB louder, tempo x1.08,
  internal pauses squeezed to 0.12 s so he rattles on
- Request: one take per character (all of that character's turns, style as `speech_metadata.style` on 3.5+ models,
  the "Say ...:" prefix on older ones). The take is split per turn by an ASR-verified aligner (Gemini audio
  transcription; a read-aloud instruction preamble is trimmed). If it can't be verified, it falls back to one request per turn.
  Raw takes are cached in `<out>.takes/`, so a quota stop never wastes requests that already succeeded.
- Models: `TTS_MODELS=gemini-3.8-flash-tts,gemini-2.5-flash-preview-tts` only. **Flattening models are refused**
  (`gemini-3.8-flash-lite-tts`, `gemini-3.1-flash-tts-preview`: measured pitch variation 2.6 st vs 5.0 st on 2.5).
  Override with `ALLOW_FLAGGED_MODEL=1`, which marks the Short as flagged in the log.
  On a 429 it waits up to `TTS_MAX_WAIT` s; when no allowed model has quota it exits 4 and render-day.sh **holds** the remaining
  Shorts (nothing ships with a worse voice).
- **Voice QA (objective, every Short)**, in `<out>.voice-log.json`: for each turn, the voice name, model and method,
  start time, F0 (median, semitone std), loudness (dB, std), spectral centroid, words/s, and an ASR transcript with a
  similarity score. Each Short must pass all of these:
  - pitch gap >= 4 st or centroid gap >= 20%
  - Claim Guy faster (words/s) and >= 2 dB louder
  - every line nearer its own character's pitch
  - pitch variation >= 2 st per character
  - Claim Guy loudness std >= 3 dB
  - every take ASR >= 0.75
  - no flagged model

  A failure gets one fresh take, and a second failure means that Short is not shipped (exit 5; `ALLOW_FLAT=1` overrides).
  Per-turn audio is saved in `<out>.lines/`.

- **Take cleanup:** Gemini 3.8 TTS takes were seen ending in a ~0.14 s DC-shifted, full-scale noise burst. In the Short it
  sounded like a loud "system error" beep at the end of each character's last turn (0:17 and 0:34 in sample v2).
  `cleanTake()` cuts any voiced stretch with a burst (30 ms mean > 0.08; real speech stays < 0.04) before splitting, trims the
  dead tail, and removes DC. Every cut is listed in the voice log (`glitchesRemoved`).
- **Character colour:** Claim Guy is EQ'd brighter (+4 dB at 2.5 kHz, compressor) at -13 dB, with a split-band de-esser: the
  band above 4.5 kHz is compressed 8:1, so his "s" sounds stay soft. v3's air shelf made them harsh (ZCR ~0.8 at 0.9 FS at
  0:15.5), and ffmpeg's `deesser` filter added DC at strong settings. Takes are soft-clipped and capped at 0.85 FS (`VOICE_PEAK`).
  Skeptic is darker (bass +3 dB, presence -2 dB, low-pass 7 kHz) at -19.5 dB. Edges and silence cuts get 4-6 ms fades (no seam clicks).
- **Artifact QA** (`pipeline/audio-qa.js`, run on the voice track and the final Short) flags:
  - noise bursts / DC steps
  - pure-tone beeps: >= 150 ms steady tone at a loud level, outside the planned SFX windows
  - isolated clicks in quiet audio
  - harsh hiss: 20 ms with zero-crossing rate > 0.5 and peak > 0.6, also inside SFX windows
  - clipping
- **Captions word for word:** `pipeline/word-times.py` (local faster-whisper `base.en`, no API quota) times every word of the
  final voice. Script words are matched in order and stored as `beats[i].wordAt`, and the renderer uses those onsets instead of
  its loudness estimate. Setup: `python3 -m venv ~/.venvs/asr && ~/.venvs/asr/bin/pip install faster-whisper`
  (box default `/home/box/.venvs/asr`, or set `ASR_PYTHON`; the workflow installs it). The voice QA fails if under 92% of the script words are heard in order. Each caption word stays on screen
  for at least 0.3 s, and a chunk never leaves a single orphan word ("dinner conversation / right now.").
- **Final QA** (`pipeline/final-qa.js`, in render-day.sh after the render; writes `<short>.mp4.final-qa.json`):
  - audio artifacts
  - every word in exactly one caption chunk, each shown for >= 0.25 s, with measured timing
  - music bed >= 15 dB under the voice
  - voice contrast after the mix: per-line f0 measured on the mp4 (`pipeline/line-f0.js <mp4>`); every Claim Guy line must be
    >= 4 semitones above every Skeptic line
  A failing Short is not shipped.
- **Mix** (`LOOK_OVERRIDE` in voice.env): music ducks 12 dB under the voice, effects at 0.6. In sample v3 the music measured
  31 dB below the voice while it talks (-45.9 vs -14.7 dBFS) and -40.5 dBFS in pauses.
  Sound effects are low-passed at 4.5 kHz and capped at 0.3 FS each. The myth/fact stamp sounds (`ding`, `wrong`) get another
  -9 dB (`sfxLowpassHz`, `sfxPeak`, `stampDb`).
- **On-screen rules:** captions start below the title card while it is up (they are pushed down, never drawn over it).
  Overlays (myth/fact stamp, notification, chat...) never straddle a scene cut: one starting during a transition lands after
  it, with its sound effect, and clears before the next shot. The stamp is a 1.4 s hit drawn from its own small canvas
  (its worn-ink holes used to punch black dots into the frame). To check frames at given times without a full render, run
  `node tests/live/frames-at.js <pkg> <voice.wav> <look.json|-> <out-prefix> t1 t2 ...`.

Scripts are written for the ear: short lines, interjections, the punchline alone on its own beat, and at least 3 Claim Guy lines.
A script without them is rejected *before* any TTS is spent (twice), then accepted.

**TTS quota:** the Gemini free tier allows **10 TTS requests/day per model** (shared with every other project on the key;
2.5-pro-tts is 0). That covers a Short needing 2 requests (batch) up to ~5 (per turn), so 6 Shorts/day needs **Gemini
billing enabled** on the key (paid tier, about cents per Short).

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

## Story mode (headless): `pipeline/story-render.js`
Storyline -> story board (Gemini, `www/js/story.js`, same client + model fallback as the app) -> voiced cast (one locked, expressive
Gemini TTS voice per character + optional narrator; delivery per suspense beat; flattening models refused) -> frame-exact
1080x1920 24 fps render with the app's own `storydraw.js` renderer and `storyaudio.js` mixer -> H.264/AAC MP4 -> QA -> contact sheet.

    node pipeline/story-render.js --story "She finds a note on her coffee cup that says 'Don't turn around'" \
      --tone warm --beats 8 --platform reel --stills --out /workspace/receipts-pipeline/samples/story-sample-1

Outputs `<out>.plan.json`, `<out>.md` (the 11-section doc), `<out>.lines/`, `<out>.voice-log.json`, `<out>.mp4`, `<out>.qa.json`,
`<out>.contact.png`, `<out>.render-info.json`, optional `<out>.stills/`. Resumable (plan + raw takes cached in `<out>.takes/`).
Exit 4 = TTS daily quota exhausted on every allowed model: the render is queued in `/workspace/receipts-pipeline/story-queue/`
(nothing silent or flat is rendered); re-run the command in the queue file after the reset (midnight Pacific: 12:30 IST in October, 13:30 IST in winter).
QA: format/duration, hard silence on the silence beat (< -55 dBFS), audio-qa (bursts/tones/clicks/harsh/clip), per-character
pitch/timbre distinctness measured on the MP4, no captions over faces (every frame), music under voice.
Re-takes and previews (a saved plan is reused and brought up to date: captions re-synced to the spoken text, poses re-mapped):

    # fresh TTS takes for Maya and Leo only (everyone else from the take cache; replaced takes kept in <out>.takes/replaced/)
    node pipeline/story-render.js --out /workspace/receipts-pipeline/samples/story-sample-1 --stills --retake maya,leo --voice leo=Enceladus
    # no TTS at all: cached takes, stand-in voices for anything missing (preview, never posted)
    node pipeline/story-render.js --offline --plan <saved.plan.json> --takes <saved.takes> --out <preview-prefix>

`--retake` takes ids or names (`all`, `narrator` too); a quota stop queues the rerun with only the characters not yet re-taken.

    # ONE line again, read alone with a director's note (1 TTS request; the note is saved in the plan as panels[i].voiceDirection)
    node pipeline/story-render.js --out /workspace/receipts-pipeline/samples/story-sample-1 --stills --retake-line 3:maya \
      --direction "a touch slower and suspenseful, softly starting on the first word, letting each word land, trailing off at the end"

The character's batch take keeps its cache key (all lines, base styles); a line with a direction replaces its batch segment.

Story QA (in `<out>.qa.json`, every frame / every stem):
- **Captions = spoken text.** One source of truth: a narrated panel's CAPTION is its narration, a panel where only a character speaks
  has no separate caption (the line is burned in). While a line plays, the on-screen text must be exactly that line and nothing else
  (`storyDraw.captionCheck`); the plan is checked too (`story.captionMismatches`). `<out>.captions.png` shows one frame per voiced line.
- **Poses.** Figures use the pose library (`storydraw.js POSE_ARMS`: idle, tense, hips, cup, grip-cup, reading, phone, point, shrug,
  startled, hand-chest, wave, cheer, reach, hide, sit, back) mapped from ACTION / BOARD NOTES (`story.poseFor`); default relaxed arms
  down, no T-pose. Held props are drawn at the hand anchor; QA fails on a T-pose or a prop more than 2 px off its hand
  A held paper clue (note, letter, photo, ticket, book) sits at chest height, angled ~7 deg, label to the camera; if a raised-hands
  pose would lift it within 16 px of the chin, both hands drop with it. QA (`storyDraw.poseCheck`, every frame) also fails when any
  held prop's box overlaps any head circle (its own or another character's, 4 px margin).
- **Audio per stem.** Voice + effects stem: strict audio-qa (tones only in effect windows). Music bed stem: tested against its own notes
  (`audiofx.musicPitches`; any burst / click / hiss / clipping fails). Final mix: a sustained tone passes only inside an effect window
  or when the same note is in the music stem. Music must play under every non-silent shot and drop to hard silence on the silence beat.
  Voice lines get a light de-esser (`storyAudio.deEss`) so a bright "s" no longer trips the harsh-noise check.
  A "tone" inside a voiced line passes only when it is the voice's own harmonic (`audio-qa voiceAware`: it sits on an integer
  harmonic of the voice stem's F0 within 1.5% in >= 80% of frames, F0 measured after subtracting the tone so a beep cannot pull the
  pitch onto itself, and the peak is in the voice stem). story-sample-1's 656 Hz on "Leo" = 2 x 322 Hz (H2 of the vowel); fixed beeps
  under the same voice, in the take or from an effect, still fail (tests/story-engine.js).
- **Effects never over speech.** The mixer protects every line from 0.12 s before its clip (breath / soft onset) to 0.08 s after it;
  an effect cued inside that is moved to the nearest gap that starts in its own shot (tail may ring <= 1 s past the cut, never into
  the silence beat), else ducked -30 dB under the line. QA: the effects stem stays >= 30 dB under every line (0.1 s before -> end).
- **Onsets.** `splitTake` cuts in the quiet before each line's first sound (walks back over a soft "Wh" / an attached breath, bridges
  <= 120 ms gaps, never past the middle of the pause before it), 10 ms fades only on silence. `cleanTake` removes isolated ticks
  (the 44-byte WAV header Gemini 3.8 puts in front of the PCM, now also stripped on receipt and when reading cached takes). Voice QA:
  every clip has >= 30 ms of quiet lead / tail and starts / ends <= -30 dB under its peak, and local ASR (faster-whisper, float32:
  the int8 path returned garbage on this box) must hear >= 60% of the words *including the first word*.
- **Perceived gender.** Adult characters' median voiced F0 must sit in their gender's range (male <= 180 Hz, female >= 165 Hz;
  `voiceHint.gender`, kids / teens not checked), on the cast takes and again in the final mix. Adult male styles carry a "grown man,
  deep adult male chest voice, never falsetto" cue (story-sample-1's Leo on Enceladus read "He wanted to say hi!" at ~317 Hz and
  listeners heard a girl; re-cast to Algenib, ~165-185 Hz). Blind check: `node pipeline/voice-listen.js <wav>...` (Gemini, audio
  only, no script or picture; perceived gender / age and the exact words heard, word by word; text-model quota, never TTS).
- **Director's notes.** A line's `voiceDirection` is appended as a note that overrides the panel mood where they differ (a "nervous,
  slightly hesitant" mood made Maya stutter "What does, uh, what does..."; the note now also asks for one clean read).
- **Takes are reused across models.** A take already made on any allowed model (e.g. the fallback after a quota stop) is reused
  before any live request, so a re-render keeps the approved voice and spends no TTS request.
- **Distinct voices.** A pair passes on pitch (>= 3 st), brightness (centroid >= 18%) or timbre: a speaker embedding
  (`pipeline/speaker-embed.py`, WeSpeaker ResNet34-LM / VoxCeleb ONNX in ~/.cache/receipts-models, local, no quota; vocal-tract /
  formant / voice-quality / gender cues) with cosine <= 0.30 between the characters' pooled lines. Calibration on our own takes:
  same voice across takes >= 0.47, different voices <= 0.43, story-sample-1 Maya/Leo ~0.10.

Offline checks: `node tests/story-engine.js`, `node tests/caption-sync.js`; frame stills: `node tests/live/story-stills.js <plan.json> <out-prefix>`.
No workflow runs Story mode (by design).
