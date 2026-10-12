# Pilot v0 boxes

Reference copies of what runs on the two Raspberry Pi boxes. The deployed files live in
the home directory of user `rospocroccante`; the unit lives in `~/.config/systemd/user/`.
Edit here, commit, run `tools/pilot-provision.sh <box> --restart`.

| Box | Hostname | Role | Services |
|---|---|---|---|
| janus | `sc-dev-cm5-janus` | gate | engine :5175, decision :4003, gate :4002, Cloudflare quick tunnel + Paradym webhook, e-paper loop |
| bishop | `sc-dev-pi5-bishop` | robot | robot-service :4004, camera MJPEG :8000, dashboard :8090, QR reader |

All services bind to loopback except the gate, which bishop reaches over the LAN, and the
gate webhook, which Paradym reaches through the tunnel on `/webhook/<token>` only.
`ROBOT_HOST` and `CAM_BIND` open robot-service and the camera stream when a remote consumer needs them.

## Put the stack on a box

FHU's `sc-provision` prepares the system: updates, cloudflared, toolchain, accounts with
`sc-add-dev`, Wi-Fi with `sc-add-wifi`. The pilot layer goes on with one command from
the laptop:

```sh
pilot/tools/pilot-provision.sh janus --check      # report only, changes nothing
pilot/tools/pilot-provision.sh janus              # sync, install, enable, start if down
pilot/tools/pilot-provision.sh bishop --restart   # same, and restart a running stack
```

It ships the committed files of this checkout and, for janus, of
`../stormcatch-policy-sdk`; installs node 22 and pnpm under `~/.local/opt`, the python
packages for the role, the WeChat models (bishop), the e-Paper library with the SPI1 pin
patch and `tpm2-tools` with the `tss` group (both boxes); runs
`pnpm install --frozen-lockfile`; copies the box scripts and the user units; enables
linger; prints one line per step. `.env` and `~/.pilot-*` never leave the box: the
script lists what is missing and stops before starting anything. `~/.pilot-version` on
the box records which commits run there. SPI, the TPM overlay and the SPI1 bus of the
e-paper on both boxes, the camera on bishop and mDNS to the other box are reported, not
changed: `config.txt` is FHU's.

The boxes find each other by mDNS. bishop reaches the gate at
`http://sc-dev-cm5-janus.local:4002`; `GATE_URL` overrides it.

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

## QR sweep

`tools/qr_sweep.py` measures which QR version and physical size the bishop camera decodes
at a given distance: 16 variants (V4 to V10, module 3 to 8 px, 28 to 60 mm on the 4.2"
panel), each shown on the janus e-paper for a fixed hold while bishop decodes every
snapshot frame with the same WeChat detector as the reader. The payload has the shape of
the real compact gate code, with the variant in the first eight characters.

Put the janus display inside the bishop camera frame at a known distance (the
provisioning script has put `qr_sweep.py` in `~` on both boxes), then from the laptop:

    pilot/tools/qr_sweep.sh 200cm

It first asks bishop for one snapshot and one decode of the code the gate shows right
now (`qr_sweep.py probe`). On a miss it keeps the frame next to the sweep files and
stops, so the camera gets aimed before five minutes run for nothing. Then it pauses the
display loop and the reader, runs the sweep, restores both and prints a markdown table
(frames, decoded, rate, first-decode latency, decode time per variant). Files land in
`~/work_vault/00_PILOT_V0/sweeps/`. Repeat per distance.
