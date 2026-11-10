import express from "express";
import type { Request, Response } from "express";
import { payloadBackend } from "../../payload/index.ts";
import type { PayloadClaims } from "../../payload/index.ts";
import { MqttBlacklist, connectBroker } from "../../payload/revocation.ts";
import { mountDocs } from "../_docs.ts";
import { authorisePoint } from "../_authorise.ts";
import { dropoffOpenapi } from "./openapi.ts";

// dropoff-service: the manned end of a delivery (doctor). Checks the payload token the robot carries, authorises the robot, then has the issuer (pickup) revoke the token over MQTT so the payload cannot be handed over twice. "received" is answered only once pickup confirms the revoke. The token is checked before the engine is asked: it is local and cheap, and a forged or spent token needs no policy decision.
const PORT = Number(process.env.DROPOFF_PORT ?? 4006);
// Unset, the service listens on every interface, which the containers need. On a shared box, DROPOFF_HOST=127.0.0.1 keeps it off the network: the service has no authentication.
const HOST = process.env.DROPOFF_HOST;
// The engine's ward medicine handover; I-3 for the clean-room route (procedure B).
const POINT_ID = process.env.DROPOFF_POINT_ID ?? "I-2";

// How long drop-off waits for pickup to confirm a revoke before answering 504.
const REVOKE_TIMEOUT_MS = Number(process.env.REVOKE_TIMEOUT_MS ?? 5000);

const revocations = await MqttBlacklist.subscribe(await connectBroker("dropoff"));
const payload = await payloadBackend(revocations);

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => res.json({ service: "dropoff", ok: true }));

// Everything drop-off checks before a handover: token valid and not yet received, issued to this robot, robot authorised at this point. Shared by the read-only check and the receipt.
type Inspection = { ok: true; claims: PayloadClaims } | { ok: false; status: number; body: Record<string, unknown> };

async function inspect(robotId: string, token: string): Promise<Inspection> {
  const v = await payload.verify(token);
  if (!v.ok) {
    // A spent token is a conflict (already received), anything else an invalid token.
    return { ok: false, status: v.reason === "revoked" ? 409 : 401, body: { error: "payload token rejected", reason: v.reason } };
  }
  if (v.claims.sub !== robotId) {
    return { ok: false, status: 403, body: { error: "payload token was issued to another robot", reason: "robot-mismatch" } };
  }
  let auth;
  try {
    auth = await authorisePoint(POINT_ID);
  } catch (err) {
    return { ok: false, status: 502, body: { error: (err as Error).message } };
  }
  if (!auth.allowed) {
    console.log("[dropoff] denied:", { robotId, jti: v.claims.jti, decision: auth.decision, determining: auth.determiningPolicies });
    return { ok: false, status: 403, body: { error: "robot not authorised", reason: "not-authorised", decision: auth.decision, determiningPolicies: auth.determiningPolicies } };
  }
  return { ok: true, claims: v.claims };
}

// What the desk shows of a payload.
const describe = (c: PayloadClaims) => ({ jti: c.jti, payloadType: c.payload_type, contents: c.contents ?? [], issuedAt: c.iat, expiresAt: c.exp });

function readBody(req: Request, res: Response): { robotId: string; token: string } | undefined {
  const { robotId, token } = req.body ?? {};
  if (typeof robotId !== "string" || !robotId || typeof token !== "string" || !token) {
    res.status(400).json({ error: "robotId and token are required" });
    return undefined;
  }
  return { robotId, token };
}

// Read-only: lets the desk show what the robot carries before anyone confirms receipt. Nothing is revoked.
app.post("/dropoff/check", async (req: Request, res: Response) => {
  const body = readBody(req, res);
  if (!body) return;
  const result = await inspect(body.robotId, body.token);
  if (!result.ok) {
    res.status(result.status).json(result.body);
    return;
  }
  res.json({ status: "valid", ...describe(result.claims) });
});

app.post("/dropoff", async (req: Request, res: Response) => {
  const body = readBody(req, res);
  if (!body) return;
  const result = await inspect(body.robotId, body.token);
  if (!result.ok) {
    res.status(result.status).json(result.body);
    return;
  }
  const { claims } = result;

  try {
    await revocations.requestRevoke(claims.jti, { token: body.token, robotId: body.robotId, reason: "received" }, REVOKE_TIMEOUT_MS);
  } catch (err) {
    // Not received: the token is still live, so the same drop-off can simply be retried.
    console.warn("[dropoff] revoke not confirmed:", (err as Error).message);
    res.status(504).json({ error: "pickup did not confirm the revoke, retry the drop-off", reason: "revoke-unconfirmed" });
    return;
  }
  console.log("[dropoff] received:", { robotId: body.robotId, payloadType: claims.payload_type, jti: claims.jti });
  res.json({ status: "received", ...describe(claims) });
});

mountDocs(app, dropoffOpenapi);
app.listen({ port: PORT, host: HOST }, () => console.log(`dropoff-service listening on http://localhost:${PORT}`));
