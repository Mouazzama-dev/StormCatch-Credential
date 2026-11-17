// pickup-service contract tests. Validation is cheap; issuing needs the decision-service and the policy engine, and is skipped (not failed) when either is down or denies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, up, jpost, jget } from "./_helpers.ts";

const ROBOT = "urn:stormcatch:robot:SC-M1:SN-2026-000123";

test("pickup: GET /health", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  const { status, json } = await jget(`${BASE.pickup}/health`);
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

const items = [{ code: "PARACETAMOL-500", name: "Paracetamol 500 mg", quantity: 20 }];

test("pickup: POST /pickup rejects missing robotId/items with 400", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  assert.equal((await jpost(`${BASE.pickup}/pickup`, {})).status, 400);
  assert.equal((await jpost(`${BASE.pickup}/pickup`, { robotId: ROBOT })).status, 400);
});

test("pickup: POST /pickup passes on the central server's refusal of malformed items or an unknown route", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  const bad = await jpost(`${BASE.pickup}/pickup`, { robotId: ROBOT, items: [{ name: "Paracetamol", quantity: 0 }] });
  if (bad.status === 502 || bad.status === 403) return t.skip(`pickup could not reach the issuer path (${bad.status})`);
  assert.equal(bad.status, 400);
  const noRoute = await jpost(`${BASE.pickup}/pickup`, { robotId: ROBOT, to: "I-4", items });
  assert.equal(noRoute.status, 400);
  assert.equal(noRoute.json.reason, "no-route");
});

test("pickup: POST /pickup/check answers for the point without issuing", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  assert.equal((await jpost(`${BASE.pickup}/pickup/check`, {})).status, 400);
  const { status, json } = await jpost(`${BASE.pickup}/pickup/check`, { robotId: ROBOT });
  if (status === 502) return t.skip("decision-service or policy engine not reachable");
  assert.equal(status, 200);
  assert.equal(typeof json.allowed, "boolean");
  assert.equal(typeof json.pointId, "string");
  assert.equal("token" in json, false, "a check issues nothing");
});

test("pickup: POST /pickup issues a token when the robot is authorised", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  const { status, json } = await jpost(`${BASE.pickup}/pickup`, { robotId: ROBOT, items });
  if (status === 502) return t.skip(`decision-service, engine or central server not reachable (${json.reason ?? json.error})`);
  if (status === 403) return t.skip(`engine denied the pickup point (${json.decision})`);
  assert.equal(status, 200);
  assert.equal(json.task.from, "I-1");
  assert.equal(json.task.to, "I-2");
  assert.deepEqual(json.task.items, items);
  assert.equal(json.token.split(".").length, 3, "token is a compact JWT");
  assert.match(json.jti, /^[0-9a-f-]{36}$/);
});

test("pickup: GET /openapi.json is served", async (t) => {
  if (!(await up(BASE.pickup))) return t.skip("pickup not running");
  const { status, json } = await jget(`${BASE.pickup}/openapi.json`);
  assert.equal(status, 200);
  assert.ok(json.paths["/pickup"], "documents /pickup");
});
