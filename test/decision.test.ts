// decision-service contract tests. Validation is cheap; the happy path needs the
// policy engine reachable and is skipped (not failed) when the engine is down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, up, jpost, jget } from "./_helpers.ts";

test("decision: GET /health", async (t) => {
  if (!(await up(BASE.decision))) return t.skip("decision not running");
  const { status, json } = await jget(`${BASE.decision}/health`);
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test("decision: POST /decision rejects missing pointId with 400", async (t) => {
  if (!(await up(BASE.decision))) return t.skip("decision not running");
  const { status } = await jpost(`${BASE.decision}/decision`, {});
  assert.equal(status, 400);
});

test("decision: POST /decision returns a well-formed decision when the engine is up", async (t) => {
  if (!(await up(BASE.decision))) return t.skip("decision not running");
  const now = Math.floor(Date.now() / 1000);
  const body = {
    pointId: "G-1",
    session: {
      status: "verified",
      credentials: [
        {
          isValid: true,
          issuer: "did:web:metadata.paradym.id:ef433d64-2c1b-4761-907d-3535885857c8",
          presentedAttributes: { action: "sc:zone_access", scope: "1", exp: now + 3600 },
        },
      ],
    },
  };
  const { status, json } = await jpost(`${BASE.decision}/decision`, body);
  if (status === 502) return t.skip("policy engine (5174) not reachable from decision-service");
  assert.equal(status, 200);
  assert.equal(typeof json.allowed, "boolean", "returns an allowed boolean");
  assert.ok("decision" in json, "returns a decision field");
  assert.ok(Array.isArray(json.determiningPolicies), "returns determiningPolicies[]");
});

test("decision: the payload comes from what the caller sends: none, a token that does not verify, or nothing (the baseline)", async (t) => {
  if (!(await up(BASE.decision))) return t.skip("decision not running");
  const ask = (body: object) => jpost(`${BASE.decision}/decision`, { action: "sc:medicine_pickup", ...body });
  const baseline = await ask({ pointId: "I-2" });
  if (baseline.status === 502) return t.skip("policy engine not reachable from decision-service");
  assert.equal(baseline.json.payload, "baseline");

  const forged = await ask({ pointId: "I-2", payload: { token: "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln" } });
  assert.equal(forged.status, 200);
  assert.ok(forged.json.payload.startsWith("invalid-token:"), forged.json.payload);
  assert.equal(forged.json.allowed, false, "a handover with no valid payload is refused");

  const none = await ask({ pointId: "I-1", payload: "none" });
  assert.equal(none.json.payload, "none");

  assert.equal((await ask({ pointId: "I-1", payload: { held: { origin: "I-1" } } })).status, 400);
  assert.equal((await ask({ pointId: "I-1", payload: 42 })).status, 400);
  assert.equal((await ask({ pointId: "I-1", deliverTo: 2 })).status, 400);
});
