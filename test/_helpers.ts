// Shared helpers for the test suite. Kept dependency-free (uses global fetch + node:test).
export const BASE = {
  facility: process.env.FACILITY_URL ?? "http://localhost:4001",
  gate: process.env.GATE_URL ?? "http://localhost:4002",
  decision: process.env.DECISION_URL ?? "http://localhost:4003",
  robot: process.env.ROBOT_URL ?? "http://localhost:4004",
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
