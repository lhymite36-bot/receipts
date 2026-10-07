#!/bin/bash
# Receipts daily pipeline, end to end: render N Shorts, then upload them to YouTube scheduled at the IST slots.
#   bash pipeline/run-day.sh [YYYY-MM-DD]        (default: tomorrow in IST when run after 20:00 IST, else today)
# env DRY_RUN=1 renders + prints the upload requests without touching YouTube. See pipeline/README.md for all env vars.
set -u
REPO=$(cd "$(dirname "$0")/.." && pwd)
DAY=${1:-$(TZ=Asia/Kolkata bash -c '[ $(date +%H) -ge 20 ] && date -d tomorrow +%F || date +%F')}
D=${OUT_ROOT:-/workspace/receipts-pipeline/days}/$DAY
bash "$REPO/pipeline/render-day.sh" "$DAY" || exit 1
if [ "${DRY_RUN:-0}" = 1 ]; then node "$REPO/pipeline/yt-upload.js" "$D" --dry-run; else node "$REPO/pipeline/yt-upload.js" "$D"; fi
