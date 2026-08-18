import { paradymFetch, walletPath } from "../client.ts";
import { config } from "../config.ts";

function short(t: string | undefined) {
  if (!t) return "(none)";
  const m = t.match(/types\/([^-]+)-/);
  return m ? m[1] : t;
}

async function main() {
  console.log("=== TASK-AUTH TYPE CHECK ===\n");

  // Credential template
  const cred = await paradymFetch<{ type: string }>(
    walletPath(`/templates/credentials/sd-jwt-vc/${config.taskAuthTemplateId}`)
  );

  // Gate presentation templates
  const g1 = await paradymFetch<{ credentials?: Array<{ type: string; attributes?: any; trustedIssuers?: string[] }> }>(
    walletPath(`/templates/presentations/${config.gate1TemplateId}`)
  );
  const g2 = await paradymFetch<{ credentials?: Array<{ type: string; attributes?: any; trustedIssuers?: string[] }> }>(
    walletPath(`/templates/presentations/${config.gate2TemplateId}`)
  );

  const credType = cred.type;
  const g1Type = g1.credentials?.[0]?.type;
  const g2Type = g2.credentials?.[0]?.type;

  console.log("CREDENTIAL type :", short(credType), "\n   full:", credType);
  console.log("ENV taskAuthType:", short(config.taskAuthType));
  console.log("GATE-1 asks for :", short(g1Type));
  console.log("GATE-2 asks for :", short(g2Type));

  console.log("\n=== MATCH CHECK ===");
  const credVsEnv = credType === config.taskAuthType;
  const g1Match = g1Type === credType;
  const g2Match = g2Type === credType;
  console.log(credVsEnv ? "✅ credential type == .env type" : "❌ credential type != .env type");
  console.log(g1Match ? "✅ GATE-1 matches credential" : "❌ GATE-1 mismatch (regenerate gate templates)");
  console.log(g2Match ? "✅ GATE-2 matches credential" : "❌ GATE-2 mismatch (regenerate gate templates)");

  console.log("\n=== GATE-1 POLICY (what it asks) ===");
  console.log(JSON.stringify(g1.credentials?.[0]?.attributes, null, 2));
  console.log("trustedIssuers:", JSON.stringify(g1.credentials?.[0]?.trustedIssuers ?? []));

  console.log("\n=== .env IDs ===");
  console.log("taskAuthTemplateId:", config.taskAuthTemplateId);
  console.log("gate1TemplateId   :", config.gate1TemplateId);
  console.log("gate2TemplateId   :", config.gate2TemplateId);
  console.log("trustedEntityId   :", config.trustedEntityId);

  if (g1Match && g2Match && credVsEnv) {
    console.log("\n✅ ALL TYPES MATCH — if demo still fails, restart containers (docker compose down && up) so they pick up the new .env, and delete old wallet cards.");
  } else {
    console.log("\n❌ MISMATCH FOUND — fix order:");
    console.log("   1. set .env PARADYM_TASKAUTH_TYPE =", credType);
    console.log("   2. pnpm task-setup   (regenerate gate templates)");
    console.log("   3. put new gate ids in .env");
    console.log("   4. docker compose down && docker compose up --build");
    console.log("   5. delete old wallet cards, re-run demo");
  }
}

main().catch((err) => {
  console.error("❌ Check failed:\n", err.message);
  process.exit(1);
});
