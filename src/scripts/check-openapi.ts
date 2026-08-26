// Drift guard: every route registered in a service must be documented in its
// OpenAPI spec, and vice versa. Reads the server source statically (no server is
// started) and imports each spec object. Exits non-zero on any mismatch.
import { readFileSync } from "node:fs";
import { facilityOpenapi } from "../services/facility/openapi.ts";
import { gateOpenapi } from "../services/gate/openapi.ts";
import { decisionOpenapi } from "../services/decision/openapi.ts";
import { robotOpenapi } from "../../robot-agent/src/openapi.ts";

const services = [
  { name: "facility", file: "src/services/facility/server.ts", spec: facilityOpenapi },
  { name: "gate", file: "src/services/gate/server.ts", spec: gateOpenapi },
  { name: "decision", file: "src/services/decision/server.ts", spec: decisionOpenapi },
  { name: "robot", file: "robot-agent/src/robot-service.ts", spec: robotOpenapi },
];

// /openapi.json and /docs are added by mountDocs, not part of the documented API.
const IGNORE = new Set(["GET /openapi.json", "GET /docs"]);

function routesFromSource(src: string): Set<string> {
  const set = new Set<string>();
  const re = /app\.(get|post|put|delete|patch)\(\s*["'`](\/[^"'`]*)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const method = m[1].toUpperCase();
    const path = m[2].replace(/:([A-Za-z0-9_]+)/g, "{$1}"); // :id -> {id}
    const key = `${method} ${path}`;
    if (!IGNORE.has(key)) set.add(key);
  }
  return set;
}

function routesFromSpec(spec: { paths?: Record<string, Record<string, unknown>> }): Set<string> {
  const set = new Set<string>();
  for (const [path, ops] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(ops)) set.add(`${method.toUpperCase()} ${path}`);
  }
  return set;
}

let drift = false;
for (const svc of services) {
  const code = routesFromSource(readFileSync(svc.file, "utf8"));
  const spec = routesFromSpec(svc.spec as never);
  const missingInSpec = [...code].filter((r) => !spec.has(r));
  const missingInCode = [...spec].filter((r) => !code.has(r));
  if (missingInSpec.length || missingInCode.length) {
    drift = true;
    console.log(`\n[${svc.name}] DRIFT:`);
    for (const r of missingInSpec) console.log(`   route in code, missing from spec: ${r}`);
    for (const r of missingInCode) console.log(`   path in spec, missing from code: ${r}`);
  } else {
    console.log(`[${svc.name}] ok (${code.size} routes documented)`);
  }
}

if (drift) {
  console.error("\nOpenAPI drift detected. Update the spec or the routes so they match.");
  process.exit(1);
}
console.log("\nAll service specs match their routes.");
