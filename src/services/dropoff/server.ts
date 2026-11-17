import express from "express";
import type { Request, Response } from "express";
import { payloadBackend } from "../../payload/index.ts";
import type { TaskClaims } from "../../payload/index.ts";
import { pointUrn } from "../../payload/points.ts";
import { MqttBlacklist, connectBroker } from "../../payload/revocation.ts";
import { mountDocs } from "../_docs.ts";
import { authorisePoint } from "../_authorise.ts";
import { report } from "../_activity.ts";
import { dropoffOpenapi } from "./openapi.ts";

// dropoff-service: the manned end of a delivery (doctor). Checks the task token the robot carries (issued by the central server, addressed to this point, ending here), authorises the robot, then has the issuer revoke the token over MQTT so the payload cannot be handed over twice. "received" is answered only once the central server confirms the revoke. The token is checked before the engine is asked: it is local and cheap, and a forged or spent token needs no policy decision.
const PORT = Number(process.env.DROPOFF_PORT ?? 4006);
// Unset, the service listens on every interface, which the containers need. On a shared box, DROPOFF_HOST=127.0.0.1 keeps it off the network: the service has no authentication.
const HOST = process.env.DROPOFF_HOST;
// The engine's ward medicine handover; I-3 for the clean-room route (procedure B).
const POINT_ID = process.env.DROPOFF_POINT_ID ?? "I-2";

// How long drop-off waits for the central server to confirm a revoke before answering 504.
const REVOKE_TIMEOUT_MS = Number(process.env.REVOKE_TIMEOUT_MS ?? 5000);

const revocations = await MqttBlacklist.subscribe(await connectBroker("dropoff"));
const payload = await payloadBackend(revocations);

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => res.json({ service: "dropoff", ok: true }));

// Everything drop-off checks before a handover: token valid and not yet received, issued to this robot, robot authorised at this point. Shared by the read-only check and the receipt.
type Inspection = { ok: true; claims: TaskClaims } | { ok: false; status: number; body: Record<string, unknown> };

async function inspect(robotId: string, token: string): Promise<Inspection> {
  const v = await payload.verify(token, pointUrn(POINT_ID));
  if (!v.ok) {
    // A spent token is a conflict (already received), a token for another point a refusal, anything else an invalid token.
    const status = v.reason === "revoked" ? 409 : v.reason === "wrong-point" ? 403 : 401;
    // A revoked token was either received already or recalled by the pharmacy; the desk says which.
    const reason = v.reason === "revoked" && revocations.reasonOf(taskJtiOf(token) ?? "") === "recalled" ? "recalled" : v.reason;
    return { ok: false, status, body: { error: "task token rejected", reason } };
  }
  // The route passes through other points too; only the task's destination may take the payload.
  if (v.claims.task.to !== POINT_ID) {
    return { ok: false, status: 403, body: { error: `this task ends at ${v.claims.task.to}, not here (${POINT_ID})`, reason: "wrong-point" } };
  }
  if (v.claims.sub !== robotId) {
    return { ok: false, status: 403, body: { error: "task token was issued to another robot", reason: "robot-mismatch" } };
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
const describe = (c: TaskClaims) => ({ jti: c.jti, taskId: c.task.id, type: c.task.type, from: c.task.from, to: c.task.to, items: c.task.items, issuedAt: c.iat, expiresAt: c.exp });

function readBody(req: Request, res: Response): { robotId: string; token: string } | undefined {
  const { robotId, token } = req.body ?? {};
  if (typeof robotId !== "string" || !robotId || typeof token !== "string" || !token) {
    res.status(400).json({ error: "robotId and token are required" });
    return undefined;
  }
  return { robotId, token };
}

// Read-only: lets the desk show what the robot carries before anyone confirms receipt. Nothing is revoked.
// Every check, passed or refused, goes to the central server's activity log; the task id is read from the token when it got that far.
function reportCheck(event: string, robotId: string, token: string, result: Inspection): void {
  const taskId = result.ok ? result.claims.task.id : taskIdOf(token);
  const detail = result.ok ? "valid" : String(result.body.reason ?? result.body.error ?? result.status);
  report({ event, robotId, taskId, point: POINT_ID, outcome: result.ok ? "ok" : "refused", detail });
}

// The jti of a token whose signature already checked out (revoked tokens only reach here after it did), to look up why it was revoked.
function taskJtiOf(token: string): string | undefined {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).jti;
  } catch {
    return undefined;
  }
}

// The task id of a token that failed a check, read without trusting it, for the log only.
function taskIdOf(token: string): string | undefined {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).task?.id;
  } catch {
    return undefined;
  }
}

app.post("/dropoff/check", async (req: Request, res: Response) => {
  const body = readBody(req, res);
  if (!body) return;
  const result = await inspect(body.robotId, body.token);
  reportCheck("dropoff.check", body.robotId, body.token, result);
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
  if (!result.ok) reportCheck("dropoff.receive", body.robotId, body.token, result);
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
    report({ event: "dropoff.receive", robotId: body.robotId, taskId: claims.task.id, point: POINT_ID, outcome: "refused", detail: "revoke-unconfirmed" });
    res.status(504).json({ error: "the central server did not confirm the revoke, retry the drop-off", reason: "revoke-unconfirmed" });
    return;
  }
  console.log("[dropoff] received:", { robotId: body.robotId, taskId: claims.task.id, jti: claims.jti });
  res.json({ status: "received", ...describe(claims) });
});

mountDocs(app, dropoffOpenapi);
app.listen({ port: PORT, host: HOST }, () => console.log(`dropoff-service listening on http://localhost:${PORT}`));
