import { paradymFetch, walletPath } from "../client.ts";
import { createTaskAuthTemplate } from "../templates/task-auth.ts";
import { issueTaskAuth, createTaskAuthPresentationTemplate } from "../credentials/task-auth-flow.ts";
import { getIssuedCredentialId } from "../credentials/issue.ts";
import { revokeCredentials } from "../credentials/revoke.ts";
import { requestVerification } from "../credentials/verify.ts";
import { startWebhookServer, waitForVerification, waitForIssuance } from "../webhook/server.ts";

const PORT = 3000;

// Small helper to verify against a specific presentation template id
async function verifyWith(presentationTemplateId: string) {
  return paradymFetch<{ id: string; authorizationRequestUri: string }>(
    walletPath("/openid4vc/verification/request"),
    { method: "POST", body: JSON.stringify({ presentationTemplateId }) }
  );
}

async function main() {
  startWebhookServer(PORT, () => {});
  console.log("🌐 Webhook server started on port", PORT, "\n");

  // Presentation template requiring scope >= 2 (gate for zone level 2)
  const gate = await createTaskAuthPresentationTemplate(2);
  console.log("Gate presentation template (min scope 2):", gate.id);

  // ── ISSUE: zone access at scope 2 ──
  console.log("\n═══ ISSUE (action: sc:zone_access, scope: 2) ═══");
  const offer = await issueTaskAuth("sc:zone_access", 2);
  console.log("   Scan to load the credential:");
  console.log("   " + offer.offerUri);
  console.log("\n⏳ Waiting for you to scan and accept...");
  await waitForIssuance(offer.id);
  console.log("   ✅ Credential accepted.");

  const credentialId = await getIssuedCredentialId(offer.id);

  // ── VERIFY at gate (expect PASS: scope 2 >= 2) ──
  console.log("\n═══ VERIFY at gate — min scope 2 (expecting PASS) ═══");
  const v1 = await verifyWith(gate.id);
  console.log("   Present the credential:");
  console.log("   " + v1.authorizationRequestUri);
  const r1 = await waitForVerification(v1.id);
  console.log(`\n   → verified: ${r1.verified} | action: ${r1.attributes.action} | scope: ${r1.attributes.scope}`);
  if (!r1.verified) throw new Error("Expected PASS at scope-2 gate");
  console.log("   ✅ Authorized for zone level 2.");

  // ── REVOKE ──
  console.log("\n═══ REVOKE ═══");
  await revokeCredentials([credentialId], true);
  console.log("   ✅ Authorization revoked.");

  // ── VERIFY again (expect FAIL) ──
  console.log("\n═══ VERIFY again (expecting FAIL) ═══");
  const v2 = await verifyWith(gate.id);
  console.log("   Present the same credential:");
  console.log("   " + v2.authorizationRequestUri);
  const r2 = await waitForVerification(v2.id);
  console.log(`\n   → verified: ${r2.verified}`);
  if (r2.verified) throw new Error("Expected FAIL after revoke");
  console.log("   ✅ Revoked authorization no longer grants access.");

  console.log("\n🎉 TaskAuth lifecycle: issue → gate verify → revoke → verify(fail)");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ Task demo failed:\n", err.message);
  process.exit(1);
});