// dropoff-service contract tests. Token rejection runs without the engine (the token is checked first); the receive path needs pickup, the central server, the decision-service and the engine, and is skipped (not failed) when any is down or denies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, up, jpost, jget } from "./_helpers.ts";

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

test("dropoff: pickup -> dropoff receives once, then refuses the same token", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  if (!(await up(BASE.dropoff))) return t.skip("dropoff not running");
  const items = [{ code: "PARACETAMOL-500", name: "Paracetamol 500 mg", quantity: 20 }];
  const picked = await jpost(`${BASE.pickup}/pickup`, { robotId: ROBOT, items });
  if (picked.status !== 200) return t.skip(`pickup did not issue (${picked.status})`);
  const { token, jti } = picked.json;

  const wrongRobot = await jpost(`${BASE.dropoff}/dropoff`, { robotId: "urn:stormcatch:robot:SC-M1:SN-OTHER", token });
  assert.equal(wrongRobot.status, 403);
  assert.equal(wrongRobot.json.reason, "robot-mismatch");

  // The check shows the payload and revokes nothing: asking twice gives the same answer.
  for (let i = 0; i < 2; i++) {
    const checked = await jpost(`${BASE.dropoff}/dropoff/check`, { robotId: ROBOT, token });
    if (checked.status === 502 || checked.status === 403) return t.skip(`dropoff not authorised (${checked.status})`);
    assert.equal(checked.status, 200);
    assert.equal(checked.json.status, "valid");
    assert.deepEqual(checked.json.items, items);
    assert.equal(checked.json.to, "I-2");
  }

  const first = await jpost(`${BASE.dropoff}/dropoff`, { robotId: ROBOT, token });
  assert.equal(first.status, 200);
  assert.equal(first.json.status, "received");
  assert.equal(first.json.jti, jti);
  assert.deepEqual(first.json.items, items);

  const second = await jpost(`${BASE.dropoff}/dropoff`, { robotId: ROBOT, token });
  assert.equal(second.status, 409);
  assert.equal(second.json.reason, "revoked");
  assert.equal((await jpost(`${BASE.dropoff}/dropoff/check`, { robotId: ROBOT, token })).status, 409, "a received token no longer checks as valid");
});

test("dropoff: a task for the clean-room ward (I-3) is refused at this ward (I-2)", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  if (!(await up(BASE.dropoff))) return t.skip("dropoff not running");
  const picked = await jpost(`${BASE.pickup}/pickup`, { robotId: ROBOT, to: "I-3", items: [{ name: "Saline 0.9% 500 ml", quantity: 2 }] });
  if (picked.status !== 200) return t.skip(`pickup did not issue (${picked.status})`);
  const r = await jpost(`${BASE.dropoff}/dropoff/check`, { robotId: ROBOT, token: picked.json.token });
  assert.equal(r.status, 403);
  assert.equal(r.json.reason, "wrong-point");
});

test("dropoff: GET /openapi.json is served", async (t) => {
  if (!(await up(BASE.dropoff))) return t.skip("dropoff not running");
  const { status, json } = await jget(`${BASE.dropoff}/openapi.json`);
  assert.equal(status, 200);
  assert.ok(json.paths["/dropoff"], "documents /dropoff");
});
