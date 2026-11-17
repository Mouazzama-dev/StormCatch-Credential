import { randomUUID, timingSafeEqual } from "node:crypto";
import express from "express";
import type { Request, Response } from "express";
import { activityLog, deskToken, issuerBlacklist, issuerToken, payloadBackend, taskStore } from "../../payload/index.ts";
import { routeOf, toPointId } from "../../payload/points.ts";
import { readItems, MAX_ITEMS } from "../../payload/tasks.ts";
import type { TaskRecord, TaskStatus } from "../../payload/tasks.ts";
import { connectBroker, serveRevocations } from "../../payload/revocation.ts";
import { mountDocs } from "../_docs.ts";
import { centralOpenapi } from "./openapi.ts";

// central-service: the issuer of task tokens and the record of what happened. The pharmacy plans a task ahead (POST /tasks, through the pickup desk), the pickup desk has it issued once the load is confirmed (POST /tasks/:id/issue), and drop-off has it revoked over MQTT on receipt. Planning and issuing need the issuer token (the pickup desk); the desks report their checks with the desk token; reading tasks and activity is open on the network, like the other services. On the pilot it runs on the always-on central server, next to the broker.
const PORT = Number(process.env.CENTRAL_PORT ?? 4007);
// Unset, the service listens on every interface. It mints tokens, so on a shared machine CENTRAL_HOST=127.0.0.1 and the issuer token keep it to the pickup desk.
const HOST = process.env.CENTRAL_HOST;

const issuerSecret = Buffer.from(await issuerToken());
const deskSecret = Buffer.from(await deskToken());
const blacklist = issuerBlacklist();
const payload = await payloadBackend(blacklist);
const tasks = taskStore();
const activity = activityLog();

const { revokeNow } = await serveRevocations(await connectBroker("central"), payload, blacklist, {
  onRevoked: (jti, robotId, reason) => {
    const r = tasks.byJti(jti);
    // A repeated request (drop-off missed the first answer) finds the task already received: nothing new happened.
    if (!r || r.status !== "issued") return;
    tasks.update(r.task.id, (x) => (x.status = "received"));
    activity.add({ event: "task.received", taskId: r.task.id, robotId, point: r.task.to, outcome: "ok", detail: `token revoked (${reason})` });
  },
  onRefused: (robotId, reason) => activity.add({ event: "revoke.refused", robotId, outcome: "refused", detail: reason }),
});

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => res.json({ service: "central", ok: true }));

function holds(req: Request, secret: Buffer): boolean {
  const given = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer /, ""));
  return given.length === secret.length && timingSafeEqual(given, secret);
}

function requireIssuer(req: Request, res: Response): boolean {
  if (holds(req, issuerSecret)) return true;
  res.status(401).json({ error: "the issuer token is missing or wrong", reason: "unauthorised" });
  return false;
}

// Plan a task: the pharmacy summons a robot for a delivery. Nothing is issued yet. One planned task per robot at a time, so the pickup desk knows which one the robot is here for.
app.post("/tasks", (req: Request, res: Response) => {
  if (!requireIssuer(req, res)) return;
  const { robotId, type, parentTaskId } = req.body ?? {};
  const from = typeof req.body?.from === "string" ? toPointId(req.body.from) : "";
  const to = typeof req.body?.to === "string" ? toPointId(req.body.to) : "";
  const items = readItems(req.body?.items);
  if (typeof robotId !== "string" || !robotId || !from || !to) {
    res.status(400).json({ error: "robotId, from and to are required" });
    return;
  }
  if (!items) {
    res.status(400).json({ error: `items must be 1 to ${MAX_ITEMS} entries of { name, quantity (1 to 1000), code? }` });
    return;
  }
  const gates = routeOf(from, to);
  if (!gates) {
    res.status(400).json({ error: `no route from ${from} to ${to}`, reason: "no-route" });
    return;
  }
  const planned = tasks.list({ robotId, status: "planned" })[0];
  if (planned) {
    res.status(409).json({ error: `this robot already has a planned task (${planned.task.id}); cancel it first`, reason: "already-planned", taskId: planned.task.id });
    return;
  }
  const now = new Date().toISOString();
  const record: TaskRecord = {
    robotId,
    status: "planned",
    task: {
      id: `task-${randomUUID()}`,
      type: typeof type === "string" && type ? type : "medicine-delivery",
      from,
      to,
      items,
      gates,
      parentTaskId: typeof parentTaskId === "string" && parentTaskId ? parentTaskId : null,
    },
    createdAt: now,
    updatedAt: now,
  };
  tasks.put(record);
  activity.add({ event: "task.planned", taskId: record.task.id, robotId, point: from, outcome: "ok", detail: `to ${to}, ${items.length} item(s)` });
  console.log("[central] planned:", { robotId, taskId: record.task.id, from, to, items: items.length });
  res.status(201).json(record);
});

// Issue the token for a planned task, once the pharmacist confirms the load. The desk may send the items as actually loaded; they replace the planned ones.
app.post("/tasks/:id/issue", async (req: Request, res: Response) => {
  if (!requireIssuer(req, res)) return;
  const id = String(req.params.id);
  const record = tasks.get(id);
  if (!record) {
    res.status(404).json({ error: `no task ${id}`, reason: "no-task" });
    return;
  }
  const { robotId, cnfThumbprint } = req.body ?? {};
  if (record.robotId !== robotId) {
    res.status(403).json({ error: "this task was planned for another robot", reason: "robot-mismatch" });
    return;
  }
  if (record.status !== "planned") {
    res.status(409).json({ error: `this task is ${record.status}, not planned`, reason: "not-planned" });
    return;
  }
  const items = req.body?.items === undefined ? record.task.items : readItems(req.body.items);
  if (!items) {
    res.status(400).json({ error: `items must be 1 to ${MAX_ITEMS} entries of { name, quantity (1 to 1000), code? }` });
    return;
  }
  const task = { ...record.task, items };
  const issued = await payload.issue(robotId, task, typeof cnfThumbprint === "string" && cnfThumbprint ? { cnfThumbprint } : {});
  tasks.update(id, (r) => {
    r.status = "issued";
    r.task = task;
    r.jti = issued.jti;
  });
  activity.add({ event: "task.issued", taskId: id, robotId, point: task.from, outcome: "ok", detail: `token ${issued.jti}, ${items.length} item(s)` });
  console.log("[central] issued:", { robotId, taskId: id, jti: issued.jti });
  res.json({ ...issued, task });
});

// Cancel a planned task. An issued task is ended by receipt (or, later, by a detour revoking it), not here.
app.post("/tasks/:id/cancel", (req: Request, res: Response) => {
  if (!requireIssuer(req, res)) return;
  const id = String(req.params.id);
  const record = tasks.get(id);
  if (!record) {
    res.status(404).json({ error: `no task ${id}`, reason: "no-task" });
    return;
  }
  if (record.status !== "planned") {
    res.status(409).json({ error: `only a planned task can be cancelled; this one is ${record.status}`, reason: "not-planned" });
    return;
  }
  const updated = tasks.update(id, (r) => (r.status = "cancelled"));
  activity.add({ event: "task.cancelled", taskId: id, robotId: record.robotId, outcome: "ok" });
  res.json(updated);
});

// Recall a delivery that is on its way (robot broken, wrong load, code lost): its token is revoked like a receipt, so no ward can accept it any more. Only the issuer's side (issuer token) can recall.
app.post("/tasks/:id/recall", async (req: Request, res: Response) => {
  if (!requireIssuer(req, res)) return;
  const id = String(req.params.id);
  const record = tasks.get(id);
  if (!record) {
    res.status(404).json({ error: `no task ${id}`, reason: "no-task" });
    return;
  }
  if (record.status !== "issued" || !record.jti) {
    res.status(409).json({ error: `only a delivery on its way can be recalled; this one is ${record.status}`, reason: "not-issued" });
    return;
  }
  const why = typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim().slice(0, 200) : undefined;
  await revokeNow(record.jti, "recalled");
  const updated = tasks.update(id, (r) => (r.status = "recalled"));
  activity.add({ event: "task.recalled", taskId: id, robotId: record.robotId, point: record.task.from, outcome: "ok", detail: why ?? "recalled by the pharmacy" });
  console.log("[central] recalled:", { taskId: id, jti: record.jti });
  res.json(updated);
});

const STATUSES: TaskStatus[] = ["planned", "issued", "received", "cancelled", "recalled"];

app.get("/tasks", (req: Request, res: Response) => {
  const robotId = typeof req.query.robotId === "string" ? req.query.robotId : undefined;
  const status = STATUSES.find((s) => s === req.query.status);
  res.json(tasks.list({ robotId, status }));
});

app.get("/tasks/:id", (req: Request, res: Response) => {
  const record = tasks.get(String(req.params.id));
  if (!record) {
    res.status(404).json({ error: "no such task", reason: "no-task" });
    return;
  }
  res.json({ ...record, activity: activity.list({ taskId: record.task.id }) });
});

app.get("/activity", (req: Request, res: Response) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const robotId = typeof req.query.robotId === "string" ? req.query.robotId : undefined;
  res.json(activity.list({ robotId, limit }));
});

// The desks report their checks here (desk token). Only desk events are taken: central records its own.
app.post("/activity", (req: Request, res: Response) => {
  if (!holds(req, deskSecret)) {
    res.status(401).json({ error: "the desk token is missing or wrong", reason: "unauthorised" });
    return;
  }
  const { event, taskId, robotId, point, outcome, detail } = req.body ?? {};
  const str = (v: unknown, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);
  if (!str(event, 64) || !/^(pickup|dropoff)\./.test(event)) {
    res.status(400).json({ error: "event must start with pickup. or dropoff." });
    return;
  }
  activity.add({
    event,
    taskId: str(taskId, 100),
    robotId: str(robotId, 200),
    point: str(point, 20),
    outcome: outcome === "ok" || outcome === "refused" ? outcome : undefined,
    detail: str(detail, 300),
  });
  res.status(204).end();
});

mountDocs(app, centralOpenapi);
app.listen({ port: PORT, host: HOST }, () => console.log(`central-service listening on http://localhost:${PORT}`));
