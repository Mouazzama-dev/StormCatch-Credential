# Interaction points: box test plan and UI plan

Two plans for what comes after the first cut described in [interaction-points.md](./interaction-points.md): how to test pickup and drop-off on the pilot hardware (central server, desk laptops, janus and bishop), and what the user interface for the two points should look like.

## Part 1: testing on the boxes

### Where things run

| Device | Role | Status |
|---|---|---|
| Central server (always-on Raspberry Pi) | MQTT broker and the central service (the token issuer); possibly the engine and decision-service | Ordered (Frank, 2026-11-13). Until it arrives, the developer's own machine is the central server. |
| Desk laptop(s) | pickup and drop-off services and the desk screens (credential-lifecycle-ui); QR by webcam or keyboard-style scanner | Any laptop on the test network |
| janus (`sc-dev-cm5-janus`) | engine :5175, decision-service :4003, gate :4002 | Decision and engine on loopback only |
| bishop (`sc-dev-pi5-bishop`) | the robot: robot-service :4004, camera, QR reader | Available |

Today everything runs on the developer's machine and works end to end. The pilot boxes are on Frank's network and are reached through Cloudflare, so they cannot connect to a broker on a developer's laptop: the box stages below start when the central server Pi is in place.

### Before any stage

1. The central server Pi is delivered and on the test network, and stays online (#device-status).
2. Frank and Rocco know and agree: ports 1883 (broker), 4005 and 4006 (pickup, drop-off).
3. The path from the desk to the policy engine is agreed with Rocco: engine and decision-service on the central server, or janus's decision-service opened to the network with a token. Today janus's only listens on loopback.
4. The pickup/drop-off work is committed; what runs on a device is exactly that commit (`git archive`), in its own folder, never inside the pilot's checkout.

### Stage 1: broker on the central server

Goal: the services and the real engine work with the broker on its pilot host.

1. Start Mosquitto on the central server with the repo's `broker/` config (Docker, or the `mosquitto` package with a box-local config) and the two passwords, and start `pnpm central` there with `ISSUER_TOKEN` and the signing key.
2. On a desk laptop, start pickup, drop-off and the UI with `MQTT_URL=mqtt://<central server>:1883`, `CENTRAL_URL=http://<central server>:4007`, the same `ISSUER_TOKEN`, the public key, and `DECISION_URL` pointing at the agreed decision-service.
3. Run `node --import tsx --test test/payload.test.ts test/pickup.test.ts test/dropoff.test.ts` on the laptop.

Pass: 19 tests, 0 skipped; the decision log shows `pilot:I-1` and `pilot:I-2` permits for our calls.

### Stage 2: bishop plays the robot

Goal: the robot side works over the network. bishop asks for a payload at pickup, keeps the token, and hands it over at drop-off.

1. Bind pickup and drop-off on the laptop to the network (`PICKUP_HOST=0.0.0.0`, `DROPOFF_HOST=0.0.0.0`). They have no authentication, so only for the length of the test.
2. From bishop: `POST http://<laptop>:4005/pickup` with bishop's robot id, keep the token, then `POST :4006/dropoff` with it, then the same drop-off again.

Pass: pickup 200, drop-off 200 `received`, repeat 409 `revoked`. The token travels by hand (curl), not inside robot-service yet; see "Gaps" in Part 2.

### Stage 3: pickup and drop-off on different laptops

Goal: the revoke by proxy really crosses devices: pickup on one laptop, drop-off on another, the broker on the central server between them. Pass: the receipt at drop-off is confirmed by pickup on the other laptop, and a restarted drop-off still refuses the used token (it relearns the revoked list from the broker).

### Stage 4: part of the pilot (later)

The broker started and kept up by the central server's provisioning, like the gate on janus. That changes the pilot's files (`pilot/`), so it is done with Rocco and Frank, after stages 1 to 3 pass.

### Clean up after each run

Stop the services, remove `.payload/` (dev keys and blacklist) on the laptops and the broker's data on the central server, and restore loopback binding.

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

### Built: first version (credential-lifecycle-ui)

The two screens below exist as a first version in the developer and test UI, [credential-lifecycle-ui](https://github.com/Stormcatch/credential-lifecycle-ui) (pages Pickup and Drop-off), next to the phase test pages, on the two check endpoints and the task token. The robot id is typed or scanned with a keyboard-style scanner, the token is handed between desks through the browser instead of the robot, and there is no sign-in yet.

### How I see it

One small web app, in Martin's stack (Nuxt with the crt-demo design system), so it can live next to the certificate platform and reuse its sign-in. Two screens, chosen by the signed-in person's role:

1. Pickup desk (pharmacist, desktop at I-1)
   - Scan or type the robot's id.
   - Check: "Robot SC-M1 / SN-2026-000123 may collect medicine" or the refusal with the engine's reason.
   - Choose the destination ward and the items with quantities (the virtual medication), load, press "Loaded".
   - The app issues the token and puts it on the robot; it shows the token's id and expiry.
2. Drop-off desk (doctor, phone at I-2)
   - Scan the robot's QR; the app fetches the token from the robot.
   - Shows what the robot carries, who loaded it and when, and whether it is valid for this robot.
   - "Received" checkmark: revoke by proxy, then a confirmation. A refusal names the reason (expired, already received, wrong robot, not authorised).

### Gaps the UI needs closed in the backend first

1. Check before commit. Done: `POST /pickup/check` and `POST /dropoff/check` answer without issuing or revoking; `POST /pickup` and `POST /dropoff` stay the commit.
2. Contents in the token. Done: the task token (Martin's format) carries `task.items` with code, name and quantity, shown at drop-off. Still to add: who loaded it, once sign-in exists.
3. Token on the robot. "Puts it on the robot" and "scan the robot's QR, the JSON comes out" mean robot-service has to store the payload token and hand it over at drop-off. Today the token travels in the HTTP body. This is a robot-service change, kept separate from the trusted-verifier task.
4. Who signed in. Once the certificate platform is the OpenID provider, pickup and drop-off should accept its sign-in and record who issued and who received.

### Decided in the team meeting (2026-11-10)

- The desks are laptops. The robot's QR code is read with the webcam or with a barcode scanner that types like a keyboard; the robot id field takes either. No Raspberry Pi per desk.
- Onboarding (hospital, KYC, robot certificates) stays in Martin's app. Tasks, the policy engine and the MQTT revocation are this work, so the parts of Martin's demo after onboarding move here: creating a task (robot, from, to, medication) and the activity log are built (decisions 15 and 16 in [interaction-points.md](./interaction-points.md)); the gate's check of the task token is still to do.
- Terminology (Frank): every point a robot interacts with is an interaction point; a gate is an interaction point without a person, a "dumb" one.
- Not for the pilot: the simplified screens for non-technical users, Martin's deep links, and the extra security levels (counters, online-only). One app or separate modules is for the team to decide after the pilot.

### Open questions for the team

- Settled with Martin (2026-11-17): one token format (his task JWT with the engine's point ids), plain ES256 signing, the central server as issuer, and the retained MQTT list as the gate store. See decisions 3, 11 to 14 in [interaction-points.md](./interaction-points.md).
- Is the robot's QR at drop-off the same one the gate reads (its DID endpoint), and does the token travel over that same endpoint?
