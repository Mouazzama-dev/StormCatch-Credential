import express from "express";
import type { Request, Response } from "express";
import { issuerBlacklist, payloadBackend } from "../../payload/index.ts";
import { connectBroker, serveRevocations } from "../../payload/revocation.ts";
import { mountDocs } from "../_docs.ts";
import { authorisePoint } from "../_authorise.ts";
import { pickupOpenapi } from "./openapi.ts";

// pickup-service: the manned start of a delivery (pharmacist). Authorises the robot through the decision-service, then hands it the payload as a signed token. The person signing in at the point is Martin's onboarding platform; this service receives only the robot id and what is loaded. It is also the only service that revokes a payload: drop-off asks it to over MQTT (src/payload/revocation.ts).
const PORT = Number(process.env.PICKUP_PORT ?? 4005);
// Unset, the service listens on every interface, which the containers need. On a shared box, PICKUP_HOST=127.0.0.1 keeps it off the network: the service has no authentication.
const HOST = process.env.PICKUP_HOST;
// The engine's pharmacy pickup counter.
const POINT_ID = process.env.PICKUP_POINT_ID ?? "I-1";

const blacklist = issuerBlacklist();
const payload = await payloadBackend(blacklist);
await serveRevocations(await connectBroker("pickup"), payload, blacklist);

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => res.json({ service: "pickup", ok: true }));

// The contents list as the desk sends it: at most MAX_CONTENTS non-empty strings, or absent.
const MAX_CONTENTS = 20;
function readContents(raw: unknown): string[] | undefined | null {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_CONTENTS) return null;
  const items = raw.map((x) => (typeof x === "string" ? x.trim() : ""));
  return items.every((x) => x.length > 0) ? items : null;
}

// Read-only: may this robot collect here? Lets the desk show allowed or refused before anything is loaded; nothing is issued.
app.post("/pickup/check", async (req: Request, res: Response) => {
  const { robotId } = req.body ?? {};
  if (typeof robotId !== "string" || !robotId) {
    res.status(400).json({ error: "robotId is required" });
    return;
  }
  try {
    const auth = await authorisePoint(POINT_ID);
    res.json({ pointId: POINT_ID, ...auth });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.post("/pickup", async (req: Request, res: Response) => {
  const { robotId, payloadType } = req.body ?? {};
  const contents = readContents(req.body?.contents);
  if (typeof robotId !== "string" || !robotId || typeof payloadType !== "string" || !payloadType) {
    res.status(400).json({ error: "robotId and payloadType are required" });
    return;
  }
  if (contents === null) {
    res.status(400).json({ error: `contents must be a list of at most ${MAX_CONTENTS} non-empty strings` });
    return;
  }

  let auth;
  try {
    auth = await authorisePoint(POINT_ID);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
    return;
  }
  if (!auth.allowed) {
    console.log("[pickup] denied:", { robotId, payloadType, decision: auth.decision, determining: auth.determiningPolicies });
    res.status(403).json({ error: "robot not authorised", decision: auth.decision, determiningPolicies: auth.determiningPolicies });
    return;
  }

  const { token, jti } = await payload.issue(payloadType, robotId, contents);
  console.log("[pickup] issued:", { robotId, payloadType, items: contents?.length ?? 0, jti });
  res.json({ token, jti });
});

mountDocs(app, pickupOpenapi);
app.listen({ port: PORT, host: HOST }, () => console.log(`pickup-service listening on http://localhost:${PORT}`));
