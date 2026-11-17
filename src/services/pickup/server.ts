import express from "express";
import type { Request, Response } from "express";
import { issuerToken } from "../../payload/index.ts";
import { mountDocs } from "../_docs.ts";
import { authorisePoint } from "../_authorise.ts";
import { report } from "../_activity.ts";
import { pickupOpenapi } from "./openapi.ts";

// pickup-service: the manned start of a delivery (pharmacist). The pharmacy plans a task for a robot ahead (summons it), checks the robot with the policy engine when it arrives, and once the load is confirmed has the central server issue the task token. Pickup holds no signing key and revokes nothing; planning and issuing go to the central server with the issuer token. The person signing in at the desk is Martin's onboarding platform; this service receives only the robot id and what is loaded.
const PORT = Number(process.env.PICKUP_PORT ?? 4005);
// Unset, the service listens on every interface, which the containers need. On a shared box, PICKUP_HOST=127.0.0.1 keeps it off the network: the service has no authentication.
const HOST = process.env.PICKUP_HOST;
// The engine's pharmacy pickup counter.
const POINT_ID = process.env.PICKUP_POINT_ID ?? "I-1";
const CENTRAL_URL = process.env.CENTRAL_URL ?? "http://localhost:4007";

const token = await issuerToken();

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => res.json({ service: "pickup", ok: true }));

// Calls the central server and hands its answer back to the desk unchanged, except that a refused issuer token or an unreachable server become a 502 the desk can name.
async function central(res: Response, path: string, body?: unknown): Promise<{ status: number; json: any } | undefined> {
  let r: globalThis.Response;
  try {
    r = await fetch(`${CENTRAL_URL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    res.status(502).json({ error: `the central server at ${CENTRAL_URL} is not reachable`, reason: "central-down" });
    return undefined;
  }
  const json = await r.json().catch(() => ({}));
  if (r.status === 401) {
    res.status(502).json({ error: "the central server refused this desk's issuer token", reason: "issuer-token" });
    return undefined;
  }
  return { status: r.status, json };
}

// Plan a task: the pharmacy summons a robot for a delivery from this counter.
app.post("/pickup/tasks", async (req: Request, res: Response) => {
  const { robotId, to, items } = req.body ?? {};
  if (typeof robotId !== "string" || !robotId || typeof to !== "string" || !to || !Array.isArray(items)) {
    res.status(400).json({ error: "robotId, to and items are required" });
    return;
  }
  const r = await central(res, "/tasks", { robotId, from: POINT_ID, to, items, type: "medicine-delivery" });
  if (r) res.status(r.status).json(r.json);
});

app.post("/pickup/tasks/:id/recall", async (req: Request, res: Response) => {
  const r = await central(res, `/tasks/${encodeURIComponent(String(req.params.id))}/recall`, req.body ?? {});
  if (r) res.status(r.status).json(r.json);
});

app.post("/pickup/tasks/:id/cancel", async (req: Request, res: Response) => {
  const r = await central(res, `/tasks/${encodeURIComponent(String(req.params.id))}/cancel`, {});
  if (r) res.status(r.status).json(r.json);
});

// May this robot collect here, and what is it here for? Answers the engine's decision and the robot's planned task (or none); nothing is issued.
app.post("/pickup/check", async (req: Request, res: Response) => {
  const { robotId } = req.body ?? {};
  if (typeof robotId !== "string" || !robotId) {
    res.status(400).json({ error: "robotId is required" });
    return;
  }
  let auth;
  try {
    auth = await authorisePoint(POINT_ID);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
    return;
  }
  let task = null;
  let taskError: string | undefined;
  try {
    const r = await fetch(`${CENTRAL_URL}/tasks?robotId=${encodeURIComponent(robotId)}&status=planned`);
    task = r.ok ? ((await r.json()) as unknown[])[0] ?? null : null;
    if (!r.ok) taskError = `central server answered ${r.status}`;
  } catch {
    taskError = "the central server is not reachable";
  }
  report({ event: "pickup.check", robotId, point: POINT_ID, taskId: (task as any)?.task?.id, outcome: auth.allowed ? "ok" : "refused", detail: `${auth.decision ?? "no decision"}${auth.determiningPolicies.length ? ` (${auth.determiningPolicies.join(", ")})` : ""}` });
  res.json({ pointId: POINT_ID, ...auth, task, ...(taskError ? { taskError } : {}) });
});

// Loaded: issue the token for the robot's planned task, with the items as actually loaded.
app.post("/pickup", async (req: Request, res: Response) => {
  const { robotId, taskId, items } = req.body ?? {};
  if (typeof robotId !== "string" || !robotId || typeof taskId !== "string" || !taskId) {
    res.status(400).json({ error: "robotId and taskId are required" });
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
    report({ event: "pickup.issue", robotId, taskId, point: POINT_ID, outcome: "refused", detail: `robot not authorised (${auth.decision ?? "no decision"})` });
    res.status(403).json({ error: "robot not authorised", decision: auth.decision, determiningPolicies: auth.determiningPolicies });
    return;
  }

  // The central server checks the task (planned, for this robot) and the items; its answers reach the desk unchanged.
  const r = await central(res, `/tasks/${encodeURIComponent(taskId)}/issue`, { robotId, ...(items !== undefined ? { items } : {}) });
  if (!r) return;
  if (r.status !== 200) report({ event: "pickup.issue", robotId, taskId, point: POINT_ID, outcome: "refused", detail: r.json?.reason ?? `central ${r.status}` });
  else console.log("[pickup] issued:", { robotId, taskId, jti: r.json.jti });
  res.status(r.status).json(r.json);
});

mountDocs(app, pickupOpenapi);
app.listen({ port: PORT, host: HOST }, () => console.log(`pickup-service listening on http://localhost:${PORT}`));
