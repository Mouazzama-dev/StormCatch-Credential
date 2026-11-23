// The delivery codes the robot carries: the task tokens the central server issued for it at the pharmacy, kept in the robot's own wallet (Credo generic records, in the same Askar store as its credentials) until a ward takes the load or the pharmacy recalls it.
// The robot does not verify a token: it holds no key of the central server, and the ward checks every token anyway. It only reads the claims it needs to file the code (its task, its ward, its expiry) and refuses a code that was issued to another robot.
import type { Agent } from "@credo-ts/core";

// Which robot this service is. The pilot robot unless set; a token whose subject is another robot is not taken.
export const ROBOT_ID = process.env.ROBOT_ID ?? "urn:stormcatch:robot:SC-M1:SN-2026-000123";

const KIND = "task-token";

export type Carried = { taskId: string; jti: string; from: string; to: string; items: unknown[]; token: string; storedAt: string; expiresAt: string };

export class DeliveryError extends Error {
  constructor(readonly status: number, readonly reason: string, message: string) {
    super(message);
  }
}

// The claims of a task token, read without checking the signature (see above).
function claimsOf(token: unknown): { sub: string; jti: string; exp: number; task: { id: string; from: string; to: string; items: unknown[] } } {
  if (typeof token !== "string" || token.split(".").length !== 3) throw new DeliveryError(400, "malformed", "token must be a task token (a JWT)");
  let c: any;
  try {
    c = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    throw new DeliveryError(400, "malformed", "token payload is not JSON");
  }
  if (typeof c?.sub !== "string" || typeof c?.jti !== "string" || typeof c?.exp !== "number" || typeof c?.task?.id !== "string" || typeof c?.task?.to !== "string") {
    throw new DeliveryError(400, "malformed", "token lacks sub, jti, exp or task");
  }
  return c;
}

// Takes a delivery code on board. Carrying the same task again replaces its code.
export async function carry(agent: Agent, token: unknown): Promise<Carried> {
  const c = claimsOf(token);
  if (c.sub !== ROBOT_ID) throw new DeliveryError(409, "not-this-robot", `this code was issued to ${c.sub}, not to this robot (${ROBOT_ID})`);
  if (c.exp * 1000 <= Date.now()) throw new DeliveryError(409, "expired", "this code has expired");
  await drop(agent, c.task.id);
  const carried: Carried = {
    taskId: c.task.id,
    jti: c.jti,
    from: c.task.from,
    to: c.task.to,
    items: Array.isArray(c.task.items) ? c.task.items : [],
    token: token as string,
    storedAt: new Date().toISOString(),
    expiresAt: new Date(c.exp * 1000).toISOString(),
  };
  await agent.genericRecords.save({ content: carried, tags: { kind: KIND, taskId: c.task.id, to: c.task.to } });
  return carried;
}

// The codes on board, newest first, for one ward when `to` is given. Expired codes are dropped on the way: no ward would take them.
export async function carried(agent: Agent, to?: string): Promise<Carried[]> {
  const records = await agent.genericRecords.findAllByQuery(to ? { kind: KIND, to } : { kind: KIND });
  const live: Carried[] = [];
  for (const r of records) {
    const c = r.content as unknown as Carried;
    if (new Date(c.expiresAt).getTime() <= Date.now()) await agent.genericRecords.deleteById(r.id);
    else live.push(c);
  }
  return live.sort((a, b) => b.storedAt.localeCompare(a.storedAt));
}

// Drops a task's code: the ward took the load or refused it, or the pharmacy recalled it. True when there was one.
export async function drop(agent: Agent, taskId: string): Promise<boolean> {
  const records = await agent.genericRecords.findAllByQuery({ kind: KIND, taskId });
  for (const r of records) await agent.genericRecords.deleteById(r.id);
  return records.length > 0;
}
