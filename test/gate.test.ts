// gate-service contract tests (cheap - no Paradym transaction).
// The happy-path verify (which hits Paradym + the webhook) is covered in e2e.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, up, jpost, jget } from "./_helpers.ts";

test("gate: GET /health", async (t) => {
  if (!(await up(BASE.gate))) return t.skip("gate not running");
  const { status, json } = await jget(`${BASE.gate}/health`);
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test("gate: POST /verify with an unconfigured gate returns 400", async (t) => {
  if (!(await up(BASE.gate))) return t.skip("gate not running");
  const { status } = await jpost(`${BASE.gate}/verify`, { gate: "ZZZ-not-a-gate" });
  assert.equal(status, 400);
});

test("gate: GET /result/:id for an unknown session returns 404", async (t) => {
  if (!(await up(BASE.gate))) return t.skip("gate not running");
  const { status } = await jget(`${BASE.gate}/result/does-not-exist`);
  assert.equal(status, 404);
});

test("gate: GET /openapi.json is served", async (t) => {
  if (!(await up(BASE.gate))) return t.skip("gate not running");
  const { status, json } = await jget(`${BASE.gate}/openapi.json`);
  assert.equal(status, 200);
  assert.ok(json.paths["/verify"], "documents /verify");
});

test("gate: tunnel traffic reaches /health and the webhook only", async (t) => {
  if (!(await up(BASE.gate))) return t.skip("gate not running");
  const viaTunnel = { "cf-ray": "test-ray" };
  const health = await fetch(`${BASE.gate}/health`, { headers: viaTunnel });
  assert.equal(health.status, 200);
  const result = await fetch(`${BASE.gate}/result/does-not-exist`, { headers: viaTunnel });
  assert.equal(result.status, 403);
  const openapi = await fetch(`${BASE.gate}/openapi.json`, { headers: viaTunnel });
  assert.equal(openapi.status, 403);
});
