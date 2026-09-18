// facility-service contract tests (cheap - no Paradym transaction).
// The happy-path issue (which does hit Paradym) is covered in e2e.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, up, jpost, jget } from "./_helpers.ts";

test("facility: GET /health", async (t) => {
  if (!(await up(BASE.facility))) return t.skip("facility not running");
  const { status, json } = await jget(`${BASE.facility}/health`);
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test("facility: POST /issue rejects missing action/scope with 400", async (t) => {
  if (!(await up(BASE.facility))) return t.skip("facility not running");
  const { status } = await jpost(`${BASE.facility}/issue`, {});
  assert.equal(status, 400);
});

test("facility: POST /revoke rejects empty credentialIds with 400", async (t) => {
  if (!(await up(BASE.facility))) return t.skip("facility not running");
  const { status } = await jpost(`${BASE.facility}/revoke`, { credentialIds: [] });
  assert.equal(status, 400);
});

test("facility: GET /openapi.json is served", async (t) => {
  if (!(await up(BASE.facility))) return t.skip("facility not running");
  const { status, json } = await jget(`${BASE.facility}/openapi.json`);
  assert.equal(status, 200);
  assert.ok(json.paths["/issue"], "documents /issue");
});
