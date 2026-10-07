#!/usr/bin/env bash
# Quick Cloudflare tunnel to the gate (4002) and Paradym webhook registration. Usage: ./janus-tunnel.sh [stop]
set -u
export PATH=$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH
LOGS=$HOME/pilot-logs; mkdir -p "$LOGS"
if [ "${1:-}" = "stop" ]; then pkill -f "[c]loudflared tunnel --no-autoupdate --url"; echo stopped; exit 0; fi
pkill -f "[c]loudflared tunnel --no-autoupdate --url" 2>/dev/null; sleep 1
setsid nohup /usr/local/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:4002 > "$LOGS/tunnel.log" 2>&1 < /dev/null &
for i in $(seq 1 20); do
  URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOGS/tunnel.log" | head -1); [ -n "$URL" ] && break; sleep 1
done
[ -n "${URL:-}" ] || { echo "no tunnel url"; tail -5 "$LOGS/tunnel.log"; exit 1; }
echo "$URL" > "$HOME/.pilot-tunnel-url"; echo "tunnel: $URL"
for i in $(seq 1 10); do c=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$URL/health"); [ "$c" = "200" ] && break; sleep 3; done
echo "via tunnel: $c"
cd "$HOME/StormCatch-Credential-Core" && SERVICE_ROLE=gate ./node_modules/.bin/tsx --env-file=.env src/scripts/register-webhook.ts "$URL" 2>&1 | tail -4
