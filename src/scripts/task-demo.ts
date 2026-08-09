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

  // Two gates: one requiring scope >= 2, one requiring scope >= 1
  const gate2 = await createTaskAuthPresentationTemplate(2);
  const gate1 = await createTaskAuthPresentationTemplate(1);
  console.log("Gate (min scope 2):", gate2.id);
  console.log("Gate (min scope 1):", gate1.id);

  // ── ISSUE scope-2 credential ──
  console.log("\n═══ ISSUE (sc:zone_access, scope: 2) ═══");
  const offer2 = await issueTaskAuth("sc:zone_access", 2);
  console.log("   Scan to load the scope-2 credential:");
  console.log("   " + offer2.offerUri);
  console.log("\n⏳ Waiting for you to scan and accept...");
  await waitForIssuance(offer2.id);
  console.log("   ✅ Scope-2 credential accepted.");
  const cred2Id = await getIssuedCredentialId(offer2.id);

  // ── VERIFY scope-2 at gate-2 (expect PASS) ──
  console.log("\n═══ VERIFY: scope-2 credential at gate-2 (expecting PASS) ═══");
  const p2 = await verifyWith(gate2.id);
  console.log("   Present the scope-2 credential:\n   " + p2.authorizationRequestUri);
  const rp2 = await waitForVerification(p2.id);
  console.log(`\n   → verified: ${rp2.verified} | action: ${rp2.attributes.action} | scope: ${rp2.attributes.scope}`);
  if (!rp2.verified) throw new Error("Expected PASS: scope 2 at gate-2");
  console.log("   ✅ Authorized for zone level 2.");

  // ── ISSUE scope-1 credential ──
  console.log("\n═══ ISSUE (sc:zone_access, scope: 1) ═══");
  const offer1 = await issueTaskAuth("sc:zone_access", 1);
  console.log("   Scan to load the scope-1 credential:");
  console.log("   " + offer1.offerUri);
  console.log("\n⏳ Waiting for you to scan and accept...");
  await waitForIssuance(offer1.id);
  console.log("   ✅ Scope-1 credential accepted.");

  // ── TEST A: scope-1 at gate-2 (expect FAIL — insufficient) ──
  console.log("\n═══ TEST A: scope-1 credential at gate-2 (expecting FAIL — insufficient) ═══");
  const a = await verifyWith(gate2.id);
  console.log("   Present the SCOPE-1 credential:\n   " + a.authorizationRequestUri);
  const ra = await waitForVerification(a.id);
  console.log(`\n   → verified: ${ra.verified}`);
  if (ra.verified) throw new Error("Expected FAIL: scope 1 should not satisfy gate-2");
  console.log("   ✅ As expected: scope 1 is insufficient for a zone-level-2 gate.");
  console.log("      (Failure is from the scope policy — nothing is revoked yet.)");

  // ── TEST B: same scope-1 at gate-1 (expect PASS — sufficient) ──
  console.log("\n═══ TEST B: same scope-1 credential at gate-1 (expecting PASS) ═══");
  const b = await verifyWith(gate1.id);
  console.log("   Present the SAME scope-1 credential:\n   " + b.authorizationRequestUri);
  const rb = await waitForVerification(b.id);
  console.log(`\n   → verified: ${rb.verified} | scope: ${rb.attributes.scope}`);
  if (!rb.verified) throw new Error("Expected PASS: scope 1 at gate-1");
  console.log("   ✅ As expected: same credential is valid at a zone-level-1 gate.");

  // ── REVOKE TEST (last, so no earlier test is affected) ──
  console.log("\n═══ REVOKE: scope-2 credential, then verify (expecting FAIL — revoked) ═══");
  await revokeCredentials([cred2Id], true);
  console.log("   ✅ Scope-2 authorization revoked.");
  const rv = await verifyWith(gate2.id);
  console.log("   Present the SCOPE-2 credential again:\n   " + rv.authorizationRequestUri);
  const rrv = await waitForVerification(rv.id);
  console.log(`\n   → verified: ${rrv.verified}`);
  if (rrv.verified) throw new Error("Expected FAIL: scope-2 credential was revoked");
  console.log("   ✅ As expected: revoked authorization no longer grants access.");
  console.log("      (This failure is from revocation — distinct from the scope failure above.)");

  console.log("\n🎉 TaskAuth demo complete:");
  console.log("   • scope-2: PASS at gate-2");
  console.log("   • scope-1: FAIL at gate-2 (insufficient), PASS at gate-1");
  console.log("   • scope-2: revoked → FAIL");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ Task demo failed:\n", err.message);
  process.exit(1);
});