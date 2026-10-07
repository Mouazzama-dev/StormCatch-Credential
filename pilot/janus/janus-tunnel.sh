#!/usr/bin/env bash
# Quick Cloudflare tunnel to the gate (4002) and Paradym webhook registration. Usage: ./janus-tunnel.sh [stop]
set -u
export PATH=$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH
LOGS=$HOME/pilot-logs; mkdir -p "$LOGS"
if [ "${1:-}" = "stop" ]; then pkill -f "[c]loudflared tunnel --no-autoupdate --url"; echo stopped; exit 0; fi

# cloudflared prints the hostname on the "Visit it at" line. Its error lines mention
# api.trycloudflare.com, which must never be taken for the tunnel URL.
tunnel_url() { grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOGS/tunnel.log" | grep -v "^https://api\." | head -1; }

URL=""
for attempt in 1 2 3 4 5; do
  pkill -f "[c]loudflared tunnel --no-autoupdate --url" 2>/dev/null; sleep 1
  setsid nohup /usr/local/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:4002 > "$LOGS/tunnel.log" 2>&1 < /dev/null &
  for i in $(seq 1 30); do
    URL=$(tunnel_url); [ -n "$URL" ] && break
    pgrep -f "[c]loudflared tunnel --no-autoupdate --url" > /dev/null || break
    sleep 1
  done
  [ -n "$URL" ] && break
  echo "tunnel attempt $attempt failed: $(tail -1 "$LOGS/tunnel.log" | cut -c1-160)"; sleep $((attempt * 10))
done
[ -n "$URL" ] || { echo "no tunnel url after 5 attempts"; rm -f "$HOME/.pilot-tunnel-url"; exit 1; }
echo "$URL" > "$HOME/.pilot-tunnel-url"; echo "tunnel: $URL"
for i in $(seq 1 10); do c=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$URL/health"); [ "$c" = "200" ] && break; sleep 3; done
echo "via tunnel: $c"
[ "$c" = "200" ] || { echo "tunnel not reachable, webhook left as is"; exit 1; }
WHTOK=$(cat "$HOME/.pilot-webhook-token" 2>/dev/null || true)
cd "$HOME/StormCatch-Credential-Core" && SERVICE_ROLE=gate WEBHOOK_TOKEN=$WHTOK ./node_modules/.bin/tsx --env-file=.env src/scripts/register-webhook.ts "$URL" 2>&1 | tail -4
