// pickup-service contract tests. Validation is cheap; planning and issuing need the central server, the decision-service and the policy engine, and are skipped (not failed) when any is down or denies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, up, jpost, jget, testRobot } from "./_helpers.ts";

const items = [{ code: "PARACETAMOL-500", name: "Paracetamol 500 mg", quantity: 20 }];

test("pickup: GET /health", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  const { status, json } = await jget(`${BASE.pickup}/health`);
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test("pickup: missing fields are refused with 400", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  const robotId = testRobot();
  assert.equal((await jpost(`${BASE.pickup}/pickup`, {})).status, 400);
  assert.equal((await jpost(`${BASE.pickup}/pickup`, { robotId })).status, 400, "Loaded needs the task id");
  assert.equal((await jpost(`${BASE.pickup}/pickup/tasks`, { robotId, items })).status, 400, "planning needs a destination");
  assert.equal((await jpost(`${BASE.pickup}/pickup/check`, {})).status, 400);
});

test("pickup: plan, check finds the planned task, Loaded issues it once", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  const robotId = testRobot();
  const planned = await jpost(`${BASE.pickup}/pickup/tasks`, { robotId, to: "I-2", items });
  if (planned.status === 502) return t.skip(`central server not reachable (${planned.json.reason})`);
  assert.equal(planned.status, 201);
  assert.equal(planned.json.status, "planned");
  assert.deepEqual(planned.json.task.gates, ["I-1", "G-1", "G-2", "G-3", "I-2"]);
  const taskId = planned.json.task.id;

  assert.equal((await jpost(`${BASE.pickup}/pickup/tasks`, { robotId, to: "I-2", items })).json.reason, "already-planned");

  const checked = await jpost(`${BASE.pickup}/pickup/check`, { robotId });
  if (checked.status === 502) return t.skip("decision-service or policy engine not reachable");
  assert.equal(checked.status, 200);
  assert.equal(checked.json.task?.task.id, taskId, "the check returns the robot's planned task");
  if (!checked.json.allowed) return t.skip(`engine denied the pickup point (${checked.json.decision})`);

  const loaded = [{ ...items[0], quantity: 18 }];
  const issued = await jpost(`${BASE.pickup}/pickup`, { robotId, taskId, items: loaded });
  assert.equal(issued.status, 200);
  assert.equal(issued.json.token.split(".").length, 3, "token is a compact JWT");
  assert.deepEqual(issued.json.task.items, loaded, "the items as loaded replace the planned ones");

  const again = await jpost(`${BASE.pickup}/pickup`, { robotId, taskId });
  assert.equal(again.status, 409);
  assert.equal(again.json.reason, "not-planned");

  const record = await jget(`${BASE.central}/tasks/${taskId}`);
  assert.equal(record.json.status, "issued");
  const events = record.json.activity.map((e: any) => e.event);
  assert.ok(events.includes("task.planned") && events.includes("task.issued"), `timeline has planned and issued: ${events}`);
});

test("pickup: a planned task can be cancelled, and the wrong robot cannot have it issued", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  const robotId = testRobot();
  const planned = await jpost(`${BASE.pickup}/pickup/tasks`, { robotId, to: "I-3", items });
  if (planned.status !== 201) return t.skip(`could not plan (${planned.status})`);
  const taskId = planned.json.task.id;
  const other = await jpost(`${BASE.pickup}/pickup`, { robotId: testRobot(), taskId });
  if (other.status === 502 || (other.status === 403 && other.json.decision)) return t.skip(`engine path not available (${other.status})`);
  assert.equal(other.status, 403);
  assert.equal(other.json.reason, "robot-mismatch");
  const cancelled = await jpost(`${BASE.pickup}/pickup/tasks/${taskId}/cancel`, {});
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.status, "cancelled");
  assert.equal((await jpost(`${BASE.pickup}/pickup`, { robotId, taskId })).json.reason, "not-planned");
});

test("pickup: malformed items and an unknown destination are refused when planning", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  const bad = await jpost(`${BASE.pickup}/pickup/tasks`, { robotId: testRobot(), to: "I-2", items: [{ name: "Paracetamol", quantity: 0 }] });
  if (bad.status === 502) return t.skip("central server not reachable");
  assert.equal(bad.status, 400);
  const noRoute = await jpost(`${BASE.pickup}/pickup/tasks`, { robotId: testRobot(), to: "I-4", items });
  assert.equal(noRoute.status, 400);
  assert.equal(noRoute.json.reason, "no-route");
});

test("pickup: GET /openapi.json is served", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  const { status, json } = await jget(`${BASE.pickup}/openapi.json`);
  assert.equal(status, 200);
  assert.ok(json.paths["/pickup/tasks"], "documents /pickup/tasks");
});
