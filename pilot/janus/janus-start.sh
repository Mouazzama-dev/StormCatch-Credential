#!/usr/bin/env bash
# Gate box (janus): policy engine 5175, decision 4003, gate 4002. All on loopback, no Docker.
# Usage: ./janus-start.sh [stop|status]
set -u
export PATH=$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH
CC=$HOME/StormCatch-Credential-Core
SDK=$HOME/stormcatch-policy-sdk/packages/authoriser
LOGS=$HOME/pilot-logs; mkdir -p "$LOGS"
rotate_logs() { for f in "$LOGS"/*.log; do [ -f "$f" ] && mv -f "$f" "$f.1"; done; }
TOKFILE=$HOME/.pilot-engine-token

ports() { ss -ltnp 2>/dev/null | grep -E ':(4002|4003|5175) ' | awk '{print $4}' | sort; }

case "${1:-start}" in
  stop)
    pkill -f "src/server/index.ts" ; pkill -f "src/services/decision/server.ts" ; pkill -f "src/services/gate/server.ts"
    sleep 1; echo "stopped; listeners left:"; ports; exit 0 ;;
  status)
    ports
    for p in 5175 4003 4002; do printf "%s " "$p"; curl -s -m 3 "http://127.0.0.1:$p/health" || curl -s -m 3 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$p/api/session"; echo; done
    exit 0 ;;
esac

if [ -n "$(ports)" ]; then echo "already running:"; ports; exit 0; fi
[ -s "$TOKFILE" ] || head -c 24 /dev/urandom | base64 | tr -d '/+=\n' > "$TOKFILE"
TOK=$(cat "$TOKFILE")
rotate_logs

( cd "$SDK" && PORT=5175 HOST=127.0.0.1 TESTER_TOKEN=$TOK setsid nohup ./node_modules/.bin/tsx src/server/index.ts > "$LOGS/engine.log" 2>&1 < /dev/null & )
cd "$CC"
DECISION_HOST=127.0.0.1 ENGINE_URL=http://127.0.0.1:5175 ENGINE_TOKEN=$TOK setsid nohup ./node_modules/.bin/tsx --env-file=.env src/services/decision/server.ts > "$LOGS/decision.log" 2>&1 < /dev/null &
GATE_HOST=0.0.0.0 DECISION_HOST=127.0.0.1 SERVICE_ROLE=gate setsid nohup ./node_modules/.bin/tsx --env-file=.env src/services/gate/server.ts > "$LOGS/gate.log" 2>&1 < /dev/null &
sleep 8
echo "listeners:"; ports
for p in 4003 4002; do printf "%s " "$p"; curl -s -m 3 "http://127.0.0.1:$p/health"; echo; done
printf "5175 "; curl -s -m 3 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5175/api/session
