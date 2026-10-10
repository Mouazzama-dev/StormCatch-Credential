#!/usr/bin/env bash
# Run one QR sweep from the laptop. Usage: ./qr_sweep.sh <distance label> [hold seconds]
# Needs ssh aliases bishop and janus, ~/qr_sweep.py on both boxes (scp pilot/tools/qr_sweep.py there),
# the janus e-paper inside the bishop camera frame. Pauses the gate display loop and the reader,
# runs the sweep, prints the table, brings both back.
set -euo pipefail
DIST=${1:?distance label, e.g. 200cm}
HOLD=${2:-12}
STAMP=$(date +%Y%m%d-%H%M)
OUT=${OUT:-$HOME/work_vault/00_PILOT_V0/sweeps}
mkdir -p "$OUT"
N=$(python3 -c "import sys; sys.path.insert(0, '$(dirname "$0")'); import qr_sweep; print(len(qr_sweep.VARIANTS))")
SECS=$(( N * (HOLD + 6) + 20 ))

echo "pausing janus display loop and bishop reader"
ssh janus '~/janus-display.sh stop' >/dev/null
ssh bishop 'pkill -f "[q]r_present.py" || true'

echo "bishop reads for ${SECS}s in the background"
ssh bishop "setsid nohup python3 ~/qr_sweep.py read --seconds $SECS --out /tmp/sweep-reads.json > /tmp/sweep-read.log 2>&1 < /dev/null &"
sleep 2
echo "janus shows the variants (hold ${HOLD}s each)"
ssh janus "python3 ~/qr_sweep.py show --hold $HOLD --out /tmp/sweep-schedule.json"

echo "waiting for the reader to finish"
ssh bishop 'while pgrep -f "[q]r_sweep.py read" >/dev/null; do sleep 2; done; tail -1 /tmp/sweep-read.log'
scp -q janus:/tmp/sweep-schedule.json "$OUT/$STAMP-$DIST-schedule.json"
scp -q bishop:/tmp/sweep-reads.json "$OUT/$STAMP-$DIST-reads.json"

echo "restoring display loop and reader"
ssh janus '~/janus-display.sh' >/dev/null
ssh bishop '~/bishop-restart-reader.sh' >/dev/null 2>&1 || ssh bishop '~/bishop-start.sh' >/dev/null

python3 "$(dirname "$0")/qr_sweep.py" table "$OUT/$STAMP-$DIST-schedule.json" "$OUT/$STAMP-$DIST-reads.json" \
  --distance "$DIST" --json "$OUT/$STAMP-$DIST-table.json" | tee "$OUT/$STAMP-$DIST-table.md"
