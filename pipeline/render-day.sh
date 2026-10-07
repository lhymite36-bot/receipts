#!/bin/bash
# Receipts daily render: bash pipeline/render-day.sh <YYYY-MM-DD> [n ...]   (default: all items in the plan)
# Picks topics (pipeline/pick-topics.js), then per Short: Gemini script -> pipeline/voice-cast.js (two Gemini voices + QA) -> headless
# 9:16 render with the Receipts app (tests/live/e2e-live.js, comic-ink look, classic motion) -> final QA (pipeline/final-qa.js)
# -> <=60 s check -> YouTube metadata.
# Resumable: finished Shorts (rcp-shortN.mp4 + .meta.json) are skipped; saved scripts/voices are reused.
# env OUT_ROOT (default /workspace/receipts-pipeline/days), COUNT (6), LEN (60), HUMOUR (3), TONE (sarcastic), GEMINI_API_KEY (required).
set -u
DAY=$1; shift
REPO=$(cd "$(dirname "$0")/.." && pwd); D=${OUT_ROOT:-/workspace/receipts-pipeline/days}/$DAY; mkdir -p "$D"
cd "$REPO" || exit 1
set -a; . "$REPO/pipeline/voice.env"; set +a
node -e "require('puppeteer-core')" 2>/dev/null || npm install --no-save --no-audit --no-fund puppeteer-core@23.11.1 || exit 1
[ -n "${GEMINI_API_KEY:-}" ] || { echo 'NO GEMINI_API_KEY'; exit 1; }
node pipeline/pick-topics.js "$DAY" "$D" "${COUNT:-6}" || exit 1
NS="$*"; [ -n "$NS" ] || NS=$(python3 -c "import json;print(' '.join(str(x['n']) for x in json.load(open('$D/plan.json'))['items']))")
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
QUOTA=0
for n in $NS; do
  OUT=$D/short$n; FINAL=$D/rcp-short$n.mp4
  if [ -f "$FINAL" ] && [ -f "$D/rcp-short$n.meta.json" ]; then echo "SKIP $n (done)"; continue; fi
  [ $QUOTA = 1 ] && { echo "HOLD $n (TTS quota exhausted; resume later with the same command)"; continue; }
  read -r FMT IDEA < <(python3 -c "import json,sys;it=[x for x in json.load(open('$D/plan.json'))['items'] if x['n']==$n][0];print(it['format'],it['idea'])")
  COMMON="ANIM=2d MOTION=classic FORMAT=$FMT TONE=${TONE:-sarcastic} HUMOUR=${HUMOUR:-3} HANDLE=${HANDLE:-@ReceiptsDaily}"
  # 1) script (text models only), rejected before any TTS if Claim Guy has < 3 lines
  for a in 1 2 3; do
    [ -f "$OUT.pkg.json" ] && break
    minc=3; [ $a -ge 3 ] && minc=0
    echo "SCRIPT $n attempt $a $(date +%H:%M:%S) [$FMT]"
    env $COMMON SCRIPT_ONLY=1 MIN_CLAIM_LINES=$minc IDEA="$IDEA" timeout 900 node tests/live/e2e-live.js "${LEN:-60}" "$OUT" >> "$OUT.log" 2>&1
    [ -f "$OUT.pkg.json" ] || sleep 20
  done
  [ -f "$OUT.pkg.json" ] || { echo "FAIL $n (no script)"; continue; }
  # 2) voice: two separate Gemini voices + objective QA; never ships a flat/same-voice take
  if ! python3 -c "import json,sys;sys.exit(0 if json.load(open('$OUT.voice-log.json')).get('pass') else 1)" 2>/dev/null; then
    for a in 1 2; do
      node pipeline/voice-cast.js "$OUT" 2>&1 | tee -a "$OUT.log" | grep -E "^(TTS|VOICE|  (PASS|FAIL)|TTS_QUOTA)"; rc=${PIPESTATUS[0]}
      [ $rc = 0 ] && break
      [ $rc = 4 ] && { QUOTA=1; break; }
      [ $rc = 5 ] && [ $a = 1 ] && { echo "  voice QA failed: one fresh take"; rm -rf "$OUT.takes" "$OUT.voice.wav"; continue; }
      break
    done
    [ $QUOTA = 1 ] && { rm -f "$OUT.voice.wav"; echo "HOLD $n (TTS quota)"; continue; }
    [ $rc = 0 ] || { rm -f "$OUT.voice.wav"; echo "FAIL $n (voice QA rc=$rc, not shipping)"; continue; }
  fi
  # 3) render (reuses the saved script + voice), <=60 s
  for a in 1 2; do
    env $COMMON timeout 1800 node tests/live/e2e-live.js "${LEN:-60}" "$OUT" >> "$OUT.log" 2>&1
    [ -f "$OUT.json" ] && [ -f "$OUT.mp4" ] && break; sleep 10
  done
  [ -f "$OUT.mp4" ] || { echo "FAIL $n (render)"; continue; }
  # 4) final QA: no beeps/bursts/clicks in the mixed audio, captions word for word, music well under the voice
  node pipeline/final-qa.js "$OUT.mp4" 2>&1 | tee -a "$OUT.log" | grep -E "^(  (PASS|FAIL)|FINAL_QA)"; [ ${PIPESTATUS[0]} = 0 ] || { echo "FAIL $n (final QA, see $OUT.mp4.final-qa.json; not shipping)"; continue; }
  d=$(dur "$OUT.mp4"); f=$(python3 -c "d=$d;print('ok' if d<=59.5 else ('%.4f'%(d/59.0) if d/59.0<=1.15 else 'long'))")
  if [ "$f" = long ]; then echo "FAIL $n (too long: $d s)"; continue; fi
  if [ "$f" = ok ]; then ffmpeg -y -loglevel error -i "$OUT.mp4" -c:v copy -c:a aac -b:a 192k -movflags +faststart "$FINAL"
  else ffmpeg -y -loglevel error -i "$OUT.mp4" -filter_complex "[0:v]setpts=PTS/$f[v];[0:a]atempo=$f[a]" -map '[v]' -map '[a]' -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "$FINAL"; fi
  node pipeline/make-meta.js "$D/plan.json" "$n" "$OUT.pkg.json" > "$D/rcp-short$n.meta.json"
  echo "DONE $n $(date +%H:%M:%S) $FINAL $(dur "$FINAL")s"
done
[ $QUOTA = 1 ] && { echo "TTS_QUOTA: stopped early, finished Shorts are kept; re-run after the quota resets (05:30 IST)"; echo ALLDONE; exit 4; }
echo ALLDONE
