import { issueTaskAuth } from "../credentials/task-auth-flow.ts";
import { config } from "../config.ts";
import { paradymFetch, walletPath } from "../client.ts";
import { startWebhookServer, waitForVerification, waitForIssuance } from "../webhook/server.ts";

const PORT = 3000;

async function main() {
  startWebhookServer(PORT, () => {});
  console.log("🌐 Webhook server started\n");

  // Issue a scope "1" credential
  console.log("═══ ISSUE (scope: \"1\") ═══");
  const offer = await issueTaskAuth("sc:zone_access", "1");
  console.log("   Scan to load the scope-1 credential:\n   " + offer.offerUri);
  console.log("\n⏳ Waiting for accept...");
  await waitForIssuance(offer.id);
  console.log("   ✅ Accepted.");

  console.log("\n═══ VERIFY at gate-2 (requires scope \"2\") ═══");
  const v = await paradymFetch<{ id: string; authorizationRequestUri: string }>(
    walletPath("/openid4vc/verification/request"),
    { method: "POST", body: JSON.stringify({ presentationTemplateId: config.gate2TemplateId }) }
  );
  console.log("   Present the scope-1 credential:\n   " + v.authorizationRequestUri);
  console.log("   (If the wallet has no matching credential, it won't present — that's a deny.)");

  let verified = false;
  let scopePresented: unknown = undefined;
  try {
    const r = await waitForVerification(v.id, 45000);
    verified = r.verified;
    scopePresented = r.attributes.scope;
    console.log(`\n   → verified: ${verified} | scope presented: ${scopePresented}`);
  } catch {
    console.log("\n   → no presentation received (wallet had no scope-\"2\" credential)");
  }
  // ... VERDICT block ...

  console.log("\n   ── VERDICT ──");
  if (verified) {
    console.log("   ⚠️  Exact value NOT enforced — scope \"1\" passed a scope-\"2\" gate.");
  } else {
    console.log("   Exact value enforced — scope \"1\" correctly denied at a scope-\"2\" gate.");
    console.log("      → A no-presentation timeout must be treated as DENY.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Failed:\n", err.message);
  process.exit(1);
});