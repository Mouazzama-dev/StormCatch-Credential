// robot-service (headless Credo holder) contract tests. All cheap - no Paradym
// transaction. The accept/present happy path is covered in e2e.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, up, jpost, jget } from "./_helpers.ts";

test("robot: GET /health", async (t) => {
  if (!(await up(BASE.robot))) return t.skip("robot-service not running");
  const { status, json } = await jget(`${BASE.robot}/health`);
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test("robot: POST /accept rejects missing offerUri with 400", async (t) => {
  if (!(await up(BASE.robot))) return t.skip("robot-service not running");
  const { status } = await jpost(`${BASE.robot}/accept`, {});
  assert.equal(status, 400);
});

test("robot: POST /present rejects missing requestUri with 400", async (t) => {
  if (!(await up(BASE.robot))) return t.skip("robot-service not running");
  const { status } = await jpost(`${BASE.robot}/present`, {});
  assert.equal(status, 400);
});

test("robot: POST /reset clears the wallet and reports a count", async (t) => {
  if (!(await up(BASE.robot))) return t.skip("robot-service not running");
  const { status, json } = await jpost(`${BASE.robot}/reset`, {});
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(typeof json.cleared, "number");
});

test("robot: GET /openapi.json is served", async (t) => {
  if (!(await up(BASE.robot))) return t.skip("robot-service not running");
  const { status, json } = await jget(`${BASE.robot}/openapi.json`);
  assert.equal(status, 200);
  assert.ok(json.paths["/present"], "documents /present");
});
