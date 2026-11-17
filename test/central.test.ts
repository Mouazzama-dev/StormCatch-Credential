// central-service contract tests: the issuer. Refusals are tested directly; issuing goes through the pickup desk (pickup.test.ts, dropoff.test.ts), which holds the issuer token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, up, jget } from "./_helpers.ts";

const ROBOT = "urn:stormcatch:robot:SC-M1:SN-2026-000123";
const items = [{ name: "Paracetamol 500 mg", quantity: 20 }];

async function post(body: unknown, auth?: string) {
  const r = await fetch(`${BASE.central}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

test("central: GET /health", async (t) => {
  if (!(await up(BASE.central))) return t.skip("central not running");
  const { status, json } = await jget(`${BASE.central}/health`);
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test("central: POST /tasks without the issuer token is refused with 401", async (t) => {
  if (!(await up(BASE.central))) return t.skip("central not running");
  const body = { robotId: ROBOT, from: "I-1", to: "I-2", items };
  assert.equal((await post(body)).status, 401);
  assert.equal((await post(body, "Bearer not-the-token")).status, 401);
});

test("central: GET /openapi.json is served", async (t) => {
  if (!(await up(BASE.central))) return t.skip("central not running");
  const { status, json } = await jget(`${BASE.central}/openapi.json`);
  assert.equal(status, 200);
  assert.ok(json.paths["/tasks"], "documents /tasks");
});
