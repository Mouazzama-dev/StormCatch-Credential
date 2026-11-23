// dropoff-service contract tests. Token rejection runs without the engine (the token is checked first); the receive path needs pickup, the central server, the decision-service and the engine, and is skipped (not failed) when any is down or denies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, up, jpost, jget, plannedAndIssued, sleep, testRobot } from "./_helpers.ts";

const ROBOT = "urn:stormcatch:robot:SC-M1:SN-2026-000123";

test("dropoff: GET /health", async (t) => {
  if (!(await up(BASE.dropoff))) return t.skip("dropoff not running");
  const { status, json } = await jget(`${BASE.dropoff}/health`);
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test("dropoff: POST /dropoff rejects missing robotId/token with 400", async (t) => {
  if (!(await up(BASE.dropoff))) return t.skip("dropoff not running");
  assert.equal((await jpost(`${BASE.dropoff}/dropoff`, {})).status, 400);
  assert.equal((await jpost(`${BASE.dropoff}/dropoff`, { robotId: ROBOT })).status, 400);
});

test("dropoff: POST /dropoff rejects a malformed token with 401", async (t) => {
  if (!(await up(BASE.dropoff))) return t.skip("dropoff not running");
  const { status, json } = await jpost(`${BASE.dropoff}/dropoff`, { robotId: ROBOT, token: "not-a-jwt" });
  assert.equal(status, 401);
  assert.equal(json.reason, "malformed");
});

test("dropoff: plan -> issue -> check -> receive once, then refuse the same token; the timeline records it", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  if (!(await up(BASE.dropoff))) return t.skip("dropoff not running");
  const robotId = testRobot();
  const items = [{ code: "PARACETAMOL-500", name: "Paracetamol 500 mg", quantity: 20 }];
  const got = await plannedAndIssued(robotId, "I-2", items);
  if (!got.ok) return t.skip(`could not plan and issue (${got.why})`);
  const { token, jti, taskId } = got;

  const wrongRobot = await jpost(`${BASE.dropoff}/dropoff`, { robotId: testRobot(), token });
  assert.equal(wrongRobot.status, 403);
  assert.equal(wrongRobot.json.reason, "robot-mismatch");

  // The check shows the payload and revokes nothing: asking twice gives the same answer.
  for (let i = 0; i < 2; i++) {
    const checked = await jpost(`${BASE.dropoff}/dropoff/check`, { robotId, token });
    if (checked.status === 502 || checked.status === 403) return t.skip(`dropoff not authorised (${checked.status})`);
    assert.equal(checked.status, 200);
    assert.equal(checked.json.status, "valid");
    assert.equal(checked.json.taskId, taskId);
    assert.deepEqual(checked.json.items, items);
    assert.equal(checked.json.to, "I-2");
  }

  const first = await jpost(`${BASE.dropoff}/dropoff`, { robotId, token });
  assert.equal(first.status, 200);
  assert.equal(first.json.status, "received");
  assert.equal(first.json.jti, jti);

  const second = await jpost(`${BASE.dropoff}/dropoff`, { robotId, token });
  assert.equal(second.status, 409);
  assert.equal(second.json.reason, "revoked");
  assert.equal((await jpost(`${BASE.dropoff}/dropoff/check`, { robotId, token })).status, 409, "a received token no longer checks as valid");

  // The desks report fire and forget: give the last reports a moment to land.
  await sleep(300);
  const record = await jget(`${BASE.central}/tasks/${taskId}`);
  assert.equal(record.json.status, "received");
  const events = record.json.activity.map((e: any) => `${e.event}:${e.outcome}`);
  for (const e of ["task.planned:ok", "task.issued:ok", "dropoff.check:ok", "task.received:ok", "dropoff.receive:refused"]) {
    assert.ok(events.includes(e), `timeline has ${e}: ${events}`);
  }
});

test("dropoff: a task for the clean-room ward (I-3) is refused at this ward (I-2)", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  if (!(await up(BASE.dropoff))) return t.skip("dropoff not running");
  const robotId = testRobot();
  const got = await plannedAndIssued(robotId, "I-3", [{ name: "Saline 0.9% 500 ml", quantity: 2 }]);
  if (!got.ok) return t.skip(`could not plan and issue (${got.why})`);
  const r = await jpost(`${BASE.dropoff}/dropoff/check`, { robotId, token: got.token });
  assert.equal(r.status, 403);
  assert.equal(r.json.reason, "wrong-point");
});

test("dropoff: a recalled delivery is refused as recalled, and can't be recalled twice", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  if (!(await up(BASE.dropoff))) return t.skip("dropoff not running");
  const robotId = testRobot();
  const got = await plannedAndIssued(robotId, "I-2", [{ name: "Insulin pen", quantity: 2 }]);
  if (!got.ok) return t.skip(`could not plan and issue (${got.why})`);
  const recalled = await jpost(`${BASE.pickup}/pickup/tasks/${got.taskId}/recall`, { reason: "robot broke down" });
  assert.equal(recalled.status, 200);
  assert.equal(recalled.json.status, "recalled");
  // The recall travels over MQTT like a receipt: give drop-off a moment to hear it.
  await sleep(500);
  const r = await jpost(`${BASE.dropoff}/dropoff/check`, { robotId, token: got.token });
  assert.equal(r.status, 409);
  assert.equal(r.json.reason, "recalled");
  const again = await jpost(`${BASE.pickup}/pickup/tasks/${got.taskId}/recall`, {});
  assert.equal(again.status, 409);
  assert.equal(again.json.reason, "not-issued");
  const record = await jget(`${BASE.central}/tasks/${got.taskId}`);
  assert.ok(record.json.activity.some((e: any) => e.event === "task.recalled" && e.detail === "robot broke down"));
});

test("dropoff: POST /dropoff checks the answer before the token: a refusal needs one of the four reasons, an acceptance takes none", async (t) => {
  if (!(await up(BASE.dropoff))) return t.skip("dropoff not running");
  const token = "not-a-jwt";
  for (const body of [
    { robotId: ROBOT, token, answer: "maybe" },
    { robotId: ROBOT, token, answer: "refused" },
    { robotId: ROBOT, token, answer: "refused", reason: "sc:too_cold" },
    { robotId: ROBOT, token, reason: "sc:late" },
  ]) {
    assert.equal((await jpost(`${BASE.dropoff}/dropoff`, body)).status, 400, JSON.stringify(body));
  }
});

test("dropoff: the ward refuses a delivery: the token is revoked, the task becomes refused, the same token is turned away as refused", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  if (!(await up(BASE.dropoff))) return t.skip("dropoff not running");
  const robotId = testRobot();
  const got = await plannedAndIssued(robotId, "I-2", [{ name: "Insulin pen", quantity: 2 }]);
  if (!got.ok) return t.skip(`could not plan and issue (${got.why})`);
  const checked = await jpost(`${BASE.dropoff}/dropoff/check`, { robotId, token: got.token });
  if (checked.status === 502 || checked.status === 403) return t.skip(`dropoff not authorised (${checked.status})`);
  assert.equal(checked.json.payloadType, "sc:medicine", "the token carries the goods class");

  // The desk may leave out the sc: prefix; the answer comes back in the engine's spelling.
  const refused = await jpost(`${BASE.dropoff}/dropoff`, { robotId, token: got.token, answer: "refused", reason: "damaged" });
  assert.equal(refused.status, 200);
  assert.equal(refused.json.status, "refused");
  assert.equal(refused.json.reason, "sc:damaged");
  assert.equal(refused.json.returnTo, "I-1");

  const again = await jpost(`${BASE.dropoff}/dropoff`, { robotId, token: got.token });
  assert.equal(again.status, 409);
  assert.equal(again.json.reason, "refused");

  await sleep(300);
  const record = await jget(`${BASE.central}/tasks/${got.taskId}`);
  assert.equal(record.json.status, "refused");
  assert.ok(record.json.activity.some((e: any) => e.event === "task.refused" && e.outcome === "refused" && e.detail.startsWith("sc:damaged")), "timeline records the refusal and its reason");
  assert.ok(!record.json.activity.some((e: any) => e.event === "task.received"), "a refused delivery is not received");
});

test("dropoff: GET /openapi.json is served", async (t) => {
  if (!(await up(BASE.dropoff))) return t.skip("dropoff not running");
  const { status, json } = await jget(`${BASE.dropoff}/openapi.json`);
  assert.equal(status, 200);
  assert.ok(json.paths["/dropoff"], "documents /dropoff");
});
