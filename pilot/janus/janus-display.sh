#!/usr/bin/env bash
# Gate display loop on janus: code, verdict, fresh code. Usage: ./janus-display.sh [stop|status]
set -u
LOGS=$HOME/pilot-logs; mkdir -p "$LOGS"
case "${1:-start}" in
  stop)   pkill -f "[g]ate_display.py .*--loop"; echo stopped; exit 0 ;;
  status) pgrep -af "[g]ate_display.py .*--loop" || echo "not running"; tail -n 5 "$LOGS/display.log" 2>/dev/null; exit 0 ;;
esac
pkill -f "[g]ate_display.py .*--loop" 2>/dev/null; sleep 1
setsid nohup python3 "$HOME/gate_display.py" G-1 --loop > "$LOGS/display.log" 2>&1 < /dev/null &
sleep 3; pgrep -af "[g]ate_display.py .*--loop" || { echo "display NOT running"; tail -n 10 "$LOGS/display.log"; exit 1; }
tail -n 3 "$LOGS/display.log"
