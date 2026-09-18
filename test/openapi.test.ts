// OFFLINE test - no running services needed. Validates every service's OpenAPI
// document is well-formed and documents the routes we expect. Safe for CI.
import { test } from "node:test";
import assert from "node:assert/strict";

import { facilityOpenapi } from "../src/services/facility/openapi.ts";
import { gateOpenapi } from "../src/services/gate/openapi.ts";
import { decisionOpenapi } from "../src/services/decision/openapi.ts";
import { robotOpenapi } from "../robot-agent/src/openapi.ts";

const specs: Record<string, { spec: any; expect: string[] }> = {
  facility: { spec: facilityOpenapi, expect: ["GET /health", "POST /issue", "GET /issuance/{id}", "POST /revoke"] },
  gate: { spec: gateOpenapi, expect: ["GET /health", "POST /verify", "POST /webhook", "GET /result/{id}"] },
  decision: { spec: decisionOpenapi, expect: ["GET /health", "POST /decision"] },
  robot: { spec: robotOpenapi, expect: ["GET /health", "POST /reset", "POST /accept", "POST /present"] },
};

for (const [name, { spec, expect }] of Object.entries(specs)) {
  test(`openapi/${name}: well-formed OpenAPI 3 document`, () => {
    assert.match(String(spec.openapi), /^3\./, "openapi version should be 3.x");
    assert.ok(spec.info?.title, "info.title present");
    assert.ok(spec.paths && typeof spec.paths === "object", "paths present");
  });

  test(`openapi/${name}: documents the expected operations`, () => {
    const documented = new Set<string>();
    for (const [p, ops] of Object.entries(spec.paths as Record<string, object>)) {
      for (const method of Object.keys(ops)) documented.add(`${method.toUpperCase()} ${p}`);
    }
    for (const op of expect) {
      assert.ok(documented.has(op), `${name} spec should document ${op}`);
    }
  });
}
