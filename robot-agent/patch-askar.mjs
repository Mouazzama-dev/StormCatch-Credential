// Fix: @credo-ts/askar .mjs named-imports the mutable `askar` singleton from the
// CJS-only @openwallet-foundation/askar-shared. Node snapshots that named import as
// `undefined` (register() reassigns exports.askar after eval, which ESM never sees),
// so every KMS crypto call throws "Cannot read ... keyGetJwkSecret". NativeAskar.instance
// is a live class-static getter, so we rewrite bare `askar.X` -> `NativeAskar.instance.X`
// and make sure NativeAskar is imported. Idempotent.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "node_modules", "@credo-ts", "askar", "build");
const CALL = /\baskar\.([A-Za-z])/g;
let patched = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!p.endsWith(".mjs")) continue;
    let src = readFileSync(p, "utf8");
    if (!CALL.test(src)) continue;
    CALL.lastIndex = 0;
    let out = src.replace(CALL, "NativeAskar.instance.$1");
    if (!/\bNativeAskar\b/.test(src) || !/import\s*\{[^}]*\bNativeAskar\b[^}]*\}\s*from\s*"@openwallet-foundation\/askar-shared"/.test(out)) {
      out = `import { NativeAskar as __NA } from "@openwallet-foundation/askar-shared";\nconst NativeAskar = __NA;\n` + out;
    }
    if (out !== src) { writeFileSync(p, out); patched++; console.log("  patched", p.split("/@credo-ts/")[1]); }
  }
}
walk(root);
console.log(`askar KMS ESM-interop patch: ${patched} file(s) fixed.`);
