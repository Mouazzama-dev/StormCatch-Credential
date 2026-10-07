# Pilot v0 boxes

Reference copies of what runs on the two Raspberry Pi boxes. The deployed files live in
the home directory of user `rospocroccante`; the unit lives in `~/.config/systemd/user/`.
Edit here, copy over, restart the unit.

| Box | Hostname | Role | Services |
|---|---|---|---|
| janus | `sc-dev-cm5-janus` | gate | engine :5175, decision :4003, gate :4002, Cloudflare quick tunnel + Paradym webhook, e-paper loop |
| bishop | `sc-dev-pi5-bishop` | robot | robot-service :4004, camera MJPEG :8000, dashboard :8090, QR reader |

All services bind to loopback except the gate, which bishop reaches over the LAN.

## Install on a box

```sh
cp pilot/<box>/*.sh pilot/<box>/*.py ~/
mkdir -p ~/.config/systemd/user && cp pilot/<box>/*.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now pilot.service
systemctl --user enable --now pilot-tunnel.service   # janus only
sudo loginctl enable-linger $USER   # once, so the unit starts at boot without a login
```

`<box>-start.sh status` prints the processes and a health line per port. Logs go to
`~/pilot-logs/`. The unit waits for NetworkManager to report full connectivity before
starting, up to two minutes.

On janus the Cloudflare tunnel and the Paradym webhook registration live in
`pilot-tunnel.service`, bound to `pilot.service` and restarted on failure every 30 s.
A tunnel that fails at boot therefore leaves engine, gate and display running; reads end
in a DENY until the webhook is registered again. Both scripts exit non-zero when the
tunnel does not answer or the registration is refused, so `systemctl --user status
pilot-tunnel` shows the real state.

## Secrets

Nothing here holds a secret. The engine token is read from `~/.pilot-engine-token`, the
Paradym key and wallet ids from `StormCatch-Credential-Core/.env`. Keep it that way.

## Boot test, 2026-10-07

`sudo systemctl reboot` on janus: SSH back after 32 s, gate healthy, new quick-tunnel URL,
webhook on the gate wallet re-pointed at it, fresh code on the e-paper after 50 s. No
hands on the box.
