#!/bin/bash
# Receipts daily render: bash pipeline/render-day.sh <YYYY-MM-DD> [n ...]   (default: all items in the plan)
# Picks topics (pipeline/pick-topics.js), then per Short: Gemini script -> Gemini TTS (Skeptic + Claim Guy voices) -> headless
# 9:16 render with the Receipts app (tests/live/e2e-live.js, comic-ink look, classic motion) -> <=60 s check -> YouTube metadata.
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
for n in $NS; do
  OUT=$D/short$n; FINAL=$D/rcp-short$n.mp4
  if [ -f "$FINAL" ] && [ -f "$D/rcp-short$n.meta.json" ]; then echo "SKIP $n (done)"; continue; fi
  read -r FMT IDEA < <(python3 -c "import json,sys;it=[x for x in json.load(open('$D/plan.json'))['items'] if x['n']==$n][0];print(it['format'],it['idea'])")
  len=${LEN:-60}; ok=0
  for a in 1 2 3 4; do
    minc=3; [ $a -ge 3 ] && minc=0   # after two scripts without enough Claim Guy lines, accept a narrator-led one
    echo "START $n attempt $a $(date +%H:%M:%S) [$FMT len=$len]"
    ANIM=2d MOTION=classic FORMAT=$FMT TONE=${TONE:-sarcastic} HUMOUR=${HUMOUR:-3} HANDLE=${HANDLE:-@ReceiptsDaily} MIN_CLAIM_LINES=$minc IDEA="$IDEA" \
      timeout 1800 node tests/live/e2e-live.js "$len" "$OUT" >> "$OUT.log" 2>&1; rc=$?
    if [ $rc -eq 3 ]; then echo "  script rejected (Claim Guy lines < $minc)"; rm -f "$OUT.pkg.json"; continue; fi
    if [ -f "$OUT.json" ] && [ -f "$OUT.mp4" ]; then
      d=$(dur "$OUT.mp4")
      # Shorts must be <=60 s: up to 15% over is sped up (video+audio together); longer -> rewrite at ~30 s.
      f=$(python3 -c "d=$d;print('ok' if d<=59.5 else ('%.4f'%(d/59.0) if d/59.0<=1.15 else 'long'))")
      if [ "$f" = long ]; then echo "  too long ($d s) -> retry at 30"; rm -f "$OUT.pkg.json" "$OUT.voice.wav" "$OUT.mp4" "$OUT.json"; len=30; continue; fi
      if [ "$f" = ok ]; then ffmpeg -y -loglevel error -i "$OUT.mp4" -c:v copy -c:a aac -b:a 192k -movflags +faststart "$FINAL"
      else ffmpeg -y -loglevel error -i "$OUT.mp4" -filter_complex "[0:v]setpts=PTS/$f[v];[0:a]atempo=$f[a]" -map '[v]' -map '[a]' -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "$FINAL"; fi
      ok=1; break
    fi
    grep -q "429" "$OUT.log" && echo "  Gemini 429 (quota/rate) seen"; sleep $((a*30))
  done
  if [ $ok = 1 ]; then node pipeline/make-meta.js "$D/plan.json" "$n" "$OUT.pkg.json" > "$D/rcp-short$n.meta.json"; fi
  echo "DONE $n ok=$ok $(date +%H:%M:%S) $(ls "$FINAL" 2>/dev/null) $( [ -f "$FINAL" ] && dur "$FINAL")s"
done
echo ALLDONE
