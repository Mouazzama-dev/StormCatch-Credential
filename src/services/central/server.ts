import { randomUUID, timingSafeEqual } from "node:crypto";
import express from "express";
import type { Request, Response } from "express";
import { issuerBlacklist, issuerToken, payloadBackend } from "../../payload/index.ts";
import type { TaskItem } from "../../payload/index.ts";
import { routeOf, toPointId } from "../../payload/points.ts";
import { connectBroker, serveRevocations } from "../../payload/revocation.ts";
import { mountDocs } from "../_docs.ts";
import { centralOpenapi } from "./openapi.ts";

// central-service: the issuer of task tokens. It holds the signing key and the blacklist, mints a token when the pickup desk confirms a load (POST /tasks, authenticated with the shared ISSUER_TOKEN), and revokes over MQTT when drop-off confirms receipt. On the pilot it runs on the always-on central server, next to the broker.
const PORT = Number(process.env.CENTRAL_PORT ?? 4007);
// Unset, the service listens on every interface. It mints tokens, so on a shared machine CENTRAL_HOST=127.0.0.1 and the issuer token keep it to the pickup desk.
const HOST = process.env.CENTRAL_HOST;
const MAX_ITEMS = 20;

const token = Buffer.from(await issuerToken());
const blacklist = issuerBlacklist();
const payload = await payloadBackend(blacklist);
await serveRevocations(await connectBroker("central"), payload, blacklist);

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => res.json({ service: "central", ok: true }));

function authorised(req: Request): boolean {
  const given = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer /, ""));
  return given.length === token.length && timingSafeEqual(given, token);
}

// The items as the desk sends them: 1 to MAX_ITEMS of { name, quantity, code? }, or null when malformed.
function readItems(raw: unknown): TaskItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) return null;
  const items: TaskItem[] = [];
  for (const x of raw) {
    const name = typeof x?.name === "string" ? x.name.trim() : "";
    const quantity = x?.quantity;
    if (!name || name.length > 100 || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) return null;
    if (x.code !== undefined && (typeof x.code !== "string" || x.code.length === 0 || x.code.length > 64)) return null;
    items.push({ ...(x.code ? { code: x.code } : {}), name, quantity });
  }
  return items;
}

app.post("/tasks", async (req: Request, res: Response) => {
  if (!authorised(req)) {
    res.status(401).json({ error: "the issuer token is missing or wrong", reason: "unauthorised" });
    return;
  }
  const { robotId, type, cnfThumbprint, parentTaskId } = req.body ?? {};
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
  const task = {
    id: `task-${randomUUID()}`,
    type: typeof type === "string" && type ? type : "medicine-delivery",
    from,
    to,
    items,
    gates,
    parentTaskId: typeof parentTaskId === "string" && parentTaskId ? parentTaskId : null,
  };
  const issued = await payload.issue(robotId, task, typeof cnfThumbprint === "string" && cnfThumbprint ? { cnfThumbprint } : {});
  console.log("[central] issued:", { robotId, taskId: task.id, from, to, items: items.length, jti: issued.jti });
  res.json({ ...issued, task });
});

mountDocs(app, centralOpenapi);
app.listen({ port: PORT, host: HOST }, () => console.log(`central-service listening on http://localhost:${PORT}`));
