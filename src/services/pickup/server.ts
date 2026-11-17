import express from "express";
import type { Request, Response } from "express";
import { issuerToken } from "../../payload/index.ts";
import { mountDocs } from "../_docs.ts";
import { authorisePoint } from "../_authorise.ts";
import { pickupOpenapi } from "./openapi.ts";

// pickup-service: the manned start of a delivery (pharmacist). Authorises the robot through the decision-service, then, once loading is confirmed, asks the central server (the issuer) for the task token. Pickup holds no signing key and revokes nothing. The person signing in at the desk is Martin's onboarding platform; this service receives only the robot id and what is loaded.
const PORT = Number(process.env.PICKUP_PORT ?? 4005);
// Unset, the service listens on every interface, which the containers need. On a shared box, PICKUP_HOST=127.0.0.1 keeps it off the network: the service has no authentication.
const HOST = process.env.PICKUP_HOST;
// The engine's pharmacy pickup counter.
const POINT_ID = process.env.PICKUP_POINT_ID ?? "I-1";
// The ward handover a task ends at unless the desk names another (I-3 for the clean-room route).
const DEFAULT_TO = process.env.PICKUP_DEFAULT_TO ?? "I-2";
const CENTRAL_URL = process.env.CENTRAL_URL ?? "http://localhost:4007";

const token = await issuerToken();

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => res.json({ service: "pickup", ok: true }));

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
  const { robotId, items } = req.body ?? {};
  const to = typeof req.body?.to === "string" && req.body.to ? req.body.to : DEFAULT_TO;
  if (typeof robotId !== "string" || !robotId || !Array.isArray(items)) {
    res.status(400).json({ error: "robotId and items are required" });
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
    console.log("[pickup] denied:", { robotId, decision: auth.decision, determining: auth.determiningPolicies });
    res.status(403).json({ error: "robot not authorised", decision: auth.decision, determiningPolicies: auth.determiningPolicies });
    return;
  }

  // The central server validates the items and the route; its 4xx answers reach the desk unchanged.
  let r: globalThis.Response;
  try {
    r = await fetch(`${CENTRAL_URL}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ robotId, from: POINT_ID, to, items, type: "medicine-delivery" }),
    });
  } catch {
    res.status(502).json({ error: `the central server at ${CENTRAL_URL} is not reachable`, reason: "central-down" });
    return;
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    res.status(r.status === 401 ? 502 : r.status).json(r.status === 401 ? { error: "the central server refused this desk's issuer token", reason: "issuer-token" } : body);
    return;
  }
  console.log("[pickup] issued:", { robotId, taskId: body.task?.id, to, jti: body.jti });
  res.json(body);
});

mountDocs(app, pickupOpenapi);
app.listen({ port: PORT, host: HOST }, () => console.log(`pickup-service listening on http://localhost:${PORT}`));
