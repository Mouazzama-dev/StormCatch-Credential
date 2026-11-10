# Interaction points UI

The two desk screens of the medicine delivery pilot, built on the pickup and dropoff services. Next.js 14, its own package and workspace (like `robot-agent/`), not part of the service images.

| Screen | Point | Does |
|---|---|---|
| `/pickup` | I-1, pharmacy | Checks the robot (`POST /pickup/check`), lists the medication, issues the payload token on "Loaded" (`POST /pickup`) |
| `/dropoff` | I-2, ward | Shows what the robot carries (`POST /dropoff/check`), confirms receipt (`POST /dropoff`), which revokes the token at the pharmacy over MQTT |

The browser only talks to this app; its API routes (`app/api/`) forward to the services server-side, so the services need no CORS.

## Run

With the broker, pickup and dropoff running (see [docs/interaction-points.md](../docs/interaction-points.md)):

```sh
cd ui
pnpm install
pnpm dev
```

Open http://localhost:3000. `PICKUP_URL` and `DROPOFF_URL` point the app at other service addresses (defaults `http://localhost:4005` and `http://localhost:4006`).

## Stand-ins until the pilot pieces exist

- Robot id is typed; in the pilot the desk reads the robot's QR code.
- The token does not go onto the robot yet: the pickup desk keeps the last token in the browser, and the drop-off desk offers "Use the token from the last pickup" (or paste it).
- No sign-in: pharmacist and doctor sign-in comes from the certificate platform.

See "Gaps the UI needs closed" in [docs/interaction-points-next.md](../docs/interaction-points-next.md).
