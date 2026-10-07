#!/usr/bin/env bash
# Restart only the gate service on janus, bound to the LAN so the robot box can poll /result.
set -e
export PATH=$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH
LOGS=$HOME/pilot-logs
pkill -f "gate/server.ts" || true
sleep 2
cd ~/StormCatch-Credential-Core
GATE_HOST=0.0.0.0 DECISION_HOST=127.0.0.1 SERVICE_ROLE=gate setsid nohup ./node_modules/.bin/tsx --env-file=.env src/services/gate/server.ts > "$LOGS/gate.log" 2>&1 < /dev/null &
sleep 9
ss -ltnp | grep ":4002" || echo "gate NOT listening"
tail -2 "$LOGS/gate.log"
