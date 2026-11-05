// Generates a JUnit test report per component (and the end-to-end block) under reports/.
// Each file in test/ is one component; e2e.test.ts is the end-to-end block.
//
// Offline components (credentials, openapi) run anywhere. The service-contract components
// (facility, gate, decision, robot) need their service running, and e2e needs the full stack
// plus RUN_E2E=1; without those they report failures. For a full green report, bring the
// stack up first (docker compose up, or pnpm facility|gate|decision|robot + the engine, and
// RUN_E2E=1 for the e2e block), then run this.
//
// Usage: node scripts/test-report.mjs            (or: pnpm test:report)
//        node scripts/test-report.mjs credentials openapi   (only these components)
import { spawnSync } from "node:child_process";
import { readdirSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const only = process.argv.slice(2);
const testDir = path.join(root, "test");
mkdirSync(path.join(root, "reports"), { recursive: true });

const files = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.ts"))
  .filter((f) => only.length === 0 || only.includes(f.replace(/\.test\.ts$/, "")))
  .sort();

if (files.length === 0) {
  console.error(`No matching test files in ${path.relative(root, testDir)}/.`);
  process.exit(1);
}

const num = (out, re) => (out.match(re) ?? [])[1] ?? "?";
let anyFail = false;
const rows = [];

for (const file of files) {
  const name = file.replace(/\.test\.ts$/, "");
  const dest = path.join("reports", `${name}.junit.xml`);
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(
    process.execPath,
    [
      "--import", "tsx", "--test",
      "--test-reporter=junit", `--test-reporter-destination=${dest}`,
      "--test-reporter=spec", "--test-reporter-destination=stdout",
      path.join("test", file),
    ],
    { cwd: root, encoding: "utf8" },
  );
  const out = (result.stdout ?? "") + (result.stderr ?? "");
  process.stdout.write(result.stdout ?? "");
  const pass = num(out, /[ℹ#]\s*pass\s+(\d+)/);
  const fail = num(out, /[ℹ#]\s*fail\s+(\d+)/);
  const skip = num(out, /[ℹ#]\s*skipped?\s+(\d+)/);
  if (result.status !== 0 || Number(fail) > 0) anyFail = true;
  rows.push({ name, pass, fail, skip, dest });
}

console.log("\n\n=== Component report summary ===");
console.log("| Component | Pass | Fail | Skip | Report |");
console.log("| --- | --- | --- | --- | --- |");
for (const r of rows) console.log(`| ${r.name} | ${r.pass} | ${r.fail} | ${r.skip} | ${r.dest} |`);
console.log(`\nReports written to reports/. ${anyFail ? "Some components failed (bring the stack up for a full green run)." : "All green."}`);

process.exit(anyFail ? 1 : 0);
