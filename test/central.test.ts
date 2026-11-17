// central-service contract tests: the issuer and the task record. Refusals and reads are tested directly; planning and issuing go through the pickup desk (pickup.test.ts, dropoff.test.ts), which holds the issuer token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, up, jget, jpost } from "./_helpers.ts";

const ROBOT = "urn:stormcatch:robot:SC-M1:SN-2026-000123";
const items = [{ name: "Paracetamol 500 mg", quantity: 20 }];

async function post(path: string, body: unknown, auth?: string) {
  const r = await fetch(`${BASE.central}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
  return r.status;
}

test("central: GET /health", async (t) => {
  if (!(await up(BASE.central))) return t.skip("central not running");
  const { status, json } = await jget(`${BASE.central}/health`);
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test("central: planning, issuing and cancelling need the issuer token", async (t) => {
  if (!(await up(BASE.central))) return t.skip("central not running");
  assert.equal(await post("/tasks", { robotId: ROBOT, from: "I-1", to: "I-2", items }), 401);
  assert.equal(await post("/tasks", { robotId: ROBOT, from: "I-1", to: "I-2", items }, "Bearer not-the-token"), 401);
  assert.equal(await post("/tasks/task-x/issue", { robotId: ROBOT }), 401);
  assert.equal(await post("/tasks/task-x/cancel", {}), 401);
});

test("central: reporting an event needs the desk token", async (t) => {
  if (!(await up(BASE.central))) return t.skip("central not running");
  assert.equal(await post("/activity", { event: "dropoff.check" }), 401);
  assert.equal((await jpost(`${BASE.central}/activity`, { event: "task.issued" })).status, 401);
});

test("central: tasks and activity can be read", async (t) => {
  if (!(await up(BASE.central))) return t.skip("central not running");
  const tasks = await jget(`${BASE.central}/tasks?status=planned`);
  assert.equal(tasks.status, 200);
  assert.ok(Array.isArray(tasks.json));
  assert.ok(tasks.json.every((r: any) => r.status === "planned"));
  assert.equal((await jget(`${BASE.central}/tasks/task-does-not-exist`)).status, 404);
  const activity = await jget(`${BASE.central}/activity?limit=5`);
  assert.equal(activity.status, 200);
  assert.ok(Array.isArray(activity.json) && activity.json.length <= 5);
});

test("central: GET /openapi.json is served", async (t) => {
  if (!(await up(BASE.central))) return t.skip("central not running");
  const { status, json } = await jget(`${BASE.central}/openapi.json`);
  assert.equal(status, 200);
  assert.ok(json.paths["/tasks/{id}/issue"], "documents /tasks/{id}/issue");
});
