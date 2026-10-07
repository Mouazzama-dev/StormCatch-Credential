#!/usr/bin/env bash
# Robot box (bishop): robot-service 4004, camera stream 8000, dashboard 8090, QR reader.
# Usage: ./bishop-start.sh [stop|status]
set -u
export PATH=$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH
export GATE_URL=${GATE_URL:-http://192.168.178.101:4002}
CC=$HOME/StormCatch-Credential-Core/robot-agent
LOGS=$HOME/pilot-logs; mkdir -p "$LOGS"
rotate_logs() { for f in "$LOGS"/*.log; do [ -f "$f" ] && mv -f "$f" "$f.1"; done; }

ports() { ss -ltn 2>/dev/null | grep -E ":(4004|8000|8090) " | awk '{print $4}' | sort; }
procs() { pgrep -af "[r]obot-service.ts|[c]am_stream.py|[q]r_dashboard.py|[q]r_present.py" | cut -c1-80; }
stop_all() {
  pkill -f "[r]obot-service.ts"; pkill -f "[q]r_present.py"; pkill -f "[q]r_dashboard.py"; pkill -f "[c]am_stream.py"
  sleep 2
}

case "${1:-start}" in
  stop)   stop_all; echo "stopped; left:"; procs; exit 0 ;;
  status) ports; procs; printf "4004 "; curl -s -m 3 http://127.0.0.1:4004/health; echo; tail -n 2 "$LOGS/qr_present.log" 2>/dev/null; exit 0 ;;
esac

stop_all
rotate_logs
# Loopback only: robot-service has no auth and every caller (qr_present, dashboard) is local.
( cd "$CC" && ROBOT_HOST=127.0.0.1 setsid nohup ./node_modules/.bin/tsx src/robot-service.ts > "$LOGS/robot-service.log" 2>&1 < /dev/null & )
cd "$HOME"
setsid nohup python3 "$HOME/cam_stream.py" >> "$LOGS/cam_stream.log" 2>&1 < /dev/null &
sleep 5
setsid nohup python3 "$HOME/qr_dashboard.py" >> "$LOGS/qr_dashboard.log" 2>&1 < /dev/null &
setsid nohup python3 "$HOME/qr_present.py" --poll 40 >> "$LOGS/qr_present.log" 2>&1 < /dev/null &
sleep 12
echo "listeners:"; ports
printf "4004 "; curl -s -m 5 http://127.0.0.1:4004/health; echo
procs
