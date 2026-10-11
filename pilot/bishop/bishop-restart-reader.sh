#!/usr/bin/env bash
# Restart the QR reader on bishop (camera -> decode -> robot /present -> gate /result).
set -e
export GATE_URL=${GATE_URL:-http://sc-dev-cm5-janus.local:4002}
pkill -f "qr_present.py" || true
sleep 1
setsid nohup python3 "$HOME/qr_present.py" --poll 40 >> "$HOME/pilot-logs/qr_present.log" 2>&1 < /dev/null &
sleep 4
pgrep -af "qr_present.py" || echo "reader NOT running"
tail -1 "$HOME/pilot-logs/qr_present.log"
