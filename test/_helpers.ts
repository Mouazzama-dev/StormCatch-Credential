// Shared helpers for the test suite. Kept dependency-free (uses global fetch + node:test).
export const BASE = {
  facility: process.env.FACILITY_URL ?? "http://localhost:4001",
  gate: process.env.GATE_URL ?? "http://localhost:4002",
  decision: process.env.DECISION_URL ?? "http://localhost:4003",
  robot: process.env.ROBOT_URL ?? "http://localhost:4004",
  pickup: process.env.PICKUP_URL ?? "http://localhost:4005",
  central: process.env.CENTRAL_URL ?? "http://localhost:4007",
  dropoff: process.env.DROPOFF_URL ?? "http://localhost:4006",
};

// Is a service reachable? Used to skip integration tests gracefully when the stack is down.
export async function up(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function jpost(url: string, body?: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try { json = await r.json(); } catch { /* no body */ }
  return { status: r.status, json };
}

export async function jget(url: string) {
  const r = await fetch(url);
  let json: any = null;
  try { json = await r.json(); } catch { /* no body */ }
  return { status: r.status, json };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A fresh robot id per test, so the one-planned-task-per-robot rule never couples tests.
export const testRobot = () => `urn:stormcatch:robot:SC-M1:TEST-${Math.random().toString(36).slice(2, 10)}`;

// Plans a task at the pickup desk and has it issued, the way the desk does. Returns why not when a service is down or refuses.
export async function plannedAndIssued(robotId: string, to: string, items: unknown[]): Promise<{ ok: true; taskId: string; token: string; jti: string } | { ok: false; why: string }> {
  const planned = await jpost(`${BASE.pickup}/pickup/tasks`, { robotId, to, items });
  if (planned.status !== 201) return { ok: false, why: `plan ${planned.status} ${planned.json?.reason ?? ""}` };
  const issued = await jpost(`${BASE.pickup}/pickup`, { robotId, taskId: planned.json.task.id });
  if (issued.status !== 200) return { ok: false, why: `issue ${issued.status} ${issued.json?.reason ?? issued.json?.decision ?? ""}` };
  return { ok: true, taskId: planned.json.task.id, token: issued.json.token, jti: issued.json.jti };
}
