# Interaction points: box test plan and UI plan

Two plans for what comes after the first cut described in [interaction-points.md](./interaction-points.md): how to test pickup and drop-off on the pilot boxes (janus and bishop), and what the user interface for the two points should look like.

## Part 1: testing on the boxes

### What is on the boxes today

| Box | Runs (pilot stack, Rocco's account) | Reachable |
|---|---|---|
| janus (`sc-dev-cm5-janus`) | engine :5175, decision-service :4003, gate :4002, e-paper, Cloudflare tunnel | decision and engine on loopback only; gate on the LAN |
| bishop (`sc-dev-pi5-bishop`) | robot-service :4004, camera, dashboard, QR reader | loopback, camera stream on demand |

Our own account (`mbi`) can reach janus's decision-service on `127.0.0.1:4003` without the engine token, so pickup and drop-off can run on janus as `mbi`, against the real box engine, without touching the pilot stack, its files or its start scripts.

### Before any stage

1. janus is stable: no down/degraded entries in #device-status for a while, and `ssh janus hostname` returns. (On 2026-11-09 janus flapped and closed every SSH session right after authentication; that is Rocco's to fix.)
2. Rocco knows and agrees: the test runs on his box, on ports 1883, 4005 and 4006.
3. The pickup/drop-off work is committed. The box gets exactly that commit, shipped with `git archive`, into its own folder (`~/ip-test`), never into the pilot's checkout.
4. The read-only box check has been run on janus and bishop: node and pnpm for `mbi`, whether `mosquitto`/Docker/sudo exist, free ports, and that the box engine permits `I-1` with `sc:medicine_pickup`.

### Stage 1: everything on janus

Goal: the services, the broker and the real box engine work together.

1. Ship the commit: `git archive --prefix=ip-test/ HEAD | ssh janus 'tar -x -C ~'`, then on janus `cd ~/ip-test && pnpm install --frozen-lockfile`.
2. Broker. With sudo: install the `mosquitto` package and run it as `mbi` with a box-local config (the repo's `broker/` files assume the container's paths). Without sudo: ask Rocco to install it, or run the broker on the laptop for this stage only (`MQTT_URL` points at it).
3. `~/ip-test/.env` holds only `PICKUP_MQTT_PASSWORD` and `DROPOFF_MQTT_PASSWORD`. Pickup and drop-off use no Paradym settings.
4. Start pickup and drop-off with `DECISION_URL=http://127.0.0.1:4003`, bound to loopback (`PICKUP_HOST=127.0.0.1`, `DROPOFF_HOST=127.0.0.1`).
5. Run `node --import tsx --test test/payload.test.ts test/pickup.test.ts test/dropoff.test.ts` on janus.

Pass: 19 tests, 0 skipped; the decision log on janus shows `pilot:I-1` and `pilot:I-2` permits for our calls.

### Stage 2: bishop plays the robot

Goal: the box-to-box path works. bishop asks for a payload at pickup, keeps the token, and hands it over at drop-off.

1. Restart pickup and drop-off on janus bound to the LAN (`PICKUP_HOST=0.0.0.0`, `DROPOFF_HOST=0.0.0.0`). They have no authentication, so only for the length of the test.
2. From bishop: `POST http://sc-dev-cm5-janus.local:4005/pickup` with bishop's robot id, keep the token in a file, then `POST :4006/dropoff` with it, then the same drop-off again.

Pass: pickup 200, drop-off 200 `received`, repeat 409 `revoked`. The token travels by hand (curl), not inside robot-service yet; see "Gaps" in Part 2.

### Stage 3: drop-off on a second device (later)

Goal: the revoke by proxy really crosses devices: drop-off on bishop, broker and pickup on janus. Blocked today: drop-off needs a decision-service, and janus's is loopback-only by design. Needs Rocco: either a LAN-reachable decision endpoint with a token, or the real desk hardware with its own path to the engine.

### Stage 4: part of the pilot (later)

Pickup, drop-off and the broker started by the pilot's start scripts and provisioning, like the gate. That changes Rocco's files (`pilot/`), so it is his change or done together with him, after stages 1 and 2 pass.

### Clean up after each run

Stop the three processes, remove `~/ip-test/.payload` (dev keys and blacklist) and the broker's data, and restore loopback binding. Nothing else on the box changes.

## Part 2: the UI

### Martin's view (team meeting)

1. Pharmacist and doctor sign in through the certificate platform, which can act as an OpenID provider (Better Auth) because the KYC was done there. Signed in, the platform knows who they are and their role.
2. At pickup the pharmacist chooses what goes into the robot ("this, this and this"); a small platform where a company member signs in creates the JWT for the robot and puts it on the robot. Martin offered to build that platform.
3. The robot carries the token, the gate checks the JWT and the robot's identity certificate.
4. At drop-off the doctor signs in, says "I am receiving a medication", scans the robot's QR, and the JSON (the virtual medication) comes out.
5. On receipt, a checkmark puts the token's `jti` in a shared database as blacklisted; it cannot be used again.

### Frank's pilot design (`stormcatch-design`, `pilot/umv/pilot.md`, procedure A)

- I-1 is a desktop app at the pharmacy with a camera: it reads the robot's QR, asks whether the robot may do `sc:medicine_pickup`, tells robot and employee allowed or not, the employee loads the medicine, and once the load is confirmed the app issues a short-lived payload credential.
- I-2 is a mobile app: the ward employee scans the robot's QR, the app checks the payload credential (`sc:medicine`, issued by the pharmacy), the robot hands over, the app revokes the payload credential. A refusal at I-2 is also signalled to the pharmacy employee.
- The staff app is browser-based, on ordinary phones and desktops.

### Where the two agree, and what our backend already covers

Both describe the same sequence: sign in, identify the robot by its QR, authorise, load, issue, carry, scan at drop-off, check, confirm receipt, revoke. Our services are the backend both UIs would call:

| UI step | Backend today |
|---|---|
| Staff sign-in | Not ours: certificate platform (Martin) |
| Authorise robot at I-1 / I-2 | `POST /pickup`, `POST /dropoff` call the engine at `I-1` / `I-2` |
| Issue payload on confirmed load | `POST /pickup` |
| Check payload at drop-off | `POST /dropoff` (signature, expiry, not revoked, right robot) |
| Receipt checkmark revokes | `POST /dropoff`, revoke by proxy over MQTT; the retained revoked list is Martin's "shared database" |
| Refusal shown to the pharmacy | Not built (pickup could listen for a refusal topic) |

### Built: first version (`ui/`)

The two screens below exist as a first version in [`ui/`](../ui/README.md) (Next.js, matching the credential-lifecycle demo UI), on the two check endpoints and the contents claim. Robot id is typed instead of scanned, the token is handed between desks through the browser instead of the robot, and there is no sign-in yet.

### How I see it

One small web app, in Martin's stack (Nuxt with the crt-demo design system), so it can live next to the certificate platform and reuse its sign-in. Two screens, chosen by the signed-in person's role:

1. Pickup desk (pharmacist, desktop at I-1)
   - Scan or type the robot's id.
   - Check: "Robot SC-M1 / SN-2026-000123 may collect medicine" or the refusal with the engine's reason.
   - Choose the contents (the virtual medication list), load, press "Loaded".
   - The app issues the token and puts it on the robot; it shows the token's id and expiry.
2. Drop-off desk (doctor, phone at I-2)
   - Scan the robot's QR; the app fetches the token from the robot.
   - Shows what the robot carries, who loaded it and when, and whether it is valid for this robot.
   - "Received" checkmark: revoke by proxy, then a confirmation. A refusal names the reason (expired, already received, wrong robot, not authorised).

### Gaps the UI needs closed in the backend first

1. Check before commit. Done: `POST /pickup/check` and `POST /dropoff/check` answer without issuing or revoking; `POST /pickup` and `POST /dropoff` stay the commit.
2. Contents in the token. Done: `POST /pickup` takes a `contents` list (the medication), carried in the token as the `contents` claim and shown at drop-off. Still to add: who loaded it, once sign-in exists.
3. Token on the robot. "Puts it on the robot" and "scan the robot's QR, the JSON comes out" mean robot-service has to store the payload token and hand it over at drop-off. Today the token travels in the HTTP body. This is a robot-service change, kept separate from the trusted-verifier task.
4. Who signed in. Once the certificate platform is the OpenID provider, pickup and drop-off should accept its sign-in and record who issued and who received.

### Open questions for the team

- Desktop app with a camera at I-1 (Frank) or a phone scan at both points? One web app can do both.
- Does Martin build the issuing platform (his offer) on top of our pickup/drop-off services, or do we build the UI and he provides sign-in?
- Is the robot's QR at drop-off the same one the gate reads (its DID endpoint), and does the token travel over that same endpoint?
