import { paradymFetch, walletPath } from "../client.ts";
import { createTaskAuthTemplate } from "../templates/task-auth.ts";
import { issueTaskAuth, createTaskAuthPresentationTemplate } from "../credentials/task-auth-flow.ts";
import { getIssuedCredentialId } from "../credentials/issue.ts";
import { revokeCredentials } from "../credentials/revoke.ts";
import { requestVerification } from "../credentials/verify.ts";
import { startWebhookServer, waitForVerification, waitForIssuance } from "../webhook/server.ts";
import { config } from "../config.ts";

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

  if (!config.gate2TemplateId || !config.gate1TemplateId) {
    throw new Error("Gate templates missing — run `pnpm task-setup` first and add the IDs to .env");
  }

  const gate2 = { id: config.gate2TemplateId };
  const gate1 = { id: config.gate1TemplateId };
  console.log("Gate (scope \"2\"):", gate2.id);
  console.log("Gate (scope \"1\"):", gate1.id);
  console.log("\n⚠️  Delete any old Stormcatch task cards from the wallet before starting.");

  // ── ISSUE scope-1 credential (wallet now holds ONLY scope-1) ──
  console.log("\n═══ ISSUE (sc:zone_access, scope: \"1\") ═══");
  const offer1 = await issueTaskAuth("sc:zone_access", "1");
  console.log("   Scan to load the scope-1 credential:\n   " + offer1.offerUri);
  console.log("\n⏳ Waiting for you to scan and accept...");
  await waitForIssuance(offer1.id);
  console.log("   ✅ Scope-1 credential accepted.");

  // ── TEST A: scope-1 at gate-2 (expect DENY — no scope-"2" in wallet) ──
  console.log("\n═══ TEST A: gate-2 with only a scope-\"1\" credential (expecting DENY) ═══");
  const a = await verifyWith(gate2.id);
  console.log("   " + a.authorizationRequestUri);
  const deniedA = await expectDeny(a.id);
  if (!deniedA) throw new Error("Expected DENY: no scope-\"2\" credential should satisfy gate-2");
  console.log("   ✅ As expected: no scope-\"2\" match, nothing presented — denied.");

  // ── TEST B: scope-1 at gate-1 (expect PASS) ──
  console.log("\n═══ TEST B: gate-1 with the scope-\"1\" credential (expecting PASS) ═══");
  const b = await verifyWith(gate1.id);
  console.log("   " + b.authorizationRequestUri);
  const rb = await waitForVerification(b.id);
  console.log(`\n   → verified: ${rb.verified} | scope: ${rb.attributes.scope}`);
  if (!rb.verified) throw new Error("Expected PASS: scope \"1\" at gate-1");
  console.log("   ✅ As expected: scope-\"1\" credential valid at a scope-\"1\" gate.");

  // ── ISSUE scope-2 credential (wallet now also holds scope-2) ──
  console.log("\n═══ ISSUE (sc:zone_access, scope: \"2\") ═══");
  const offer2 = await issueTaskAuth("sc:zone_access", "2");
  console.log("   Scan to load the scope-2 credential:\n   " + offer2.offerUri);
  console.log("\n⏳ Waiting for you to scan and accept...");
  await waitForIssuance(offer2.id);
  console.log("   ✅ Scope-2 credential accepted.");
  const cred2Id = await getIssuedCredentialId(offer2.id);

  // ── TEST C: scope-2 at gate-2 (expect PASS) ──
  console.log("\n═══ TEST C: gate-2 with the scope-\"2\" credential (expecting PASS) ═══");
  const c = await verifyWith(gate2.id);
  console.log("   " + c.authorizationRequestUri);
  const rc = await waitForVerification(c.id);
  console.log(`\n   → verified: ${rc.verified} | action: ${rc.attributes.action} | scope: ${rc.attributes.scope}`);
  if (!rc.verified) throw new Error("Expected PASS: scope \"2\" at gate-2");
  console.log("   ✅ As expected: scope-\"2\" credential valid at a scope-\"2\" gate.");

  // ── REVOKE: scope-2, then gate-2 again (expect DENY) ──
  console.log("\n═══ REVOKE: scope-2 credential, then gate-2 again (expecting DENY) ═══");
  await revokeCredentials([cred2Id], true);
  console.log("   ✅ Scope-2 authorization revoked.");
  const rv = await verifyWith(gate2.id);
  console.log("   " + rv.authorizationRequestUri);
  const deniedRevoke = await expectDeny(rv.id);
  if (!deniedRevoke) throw new Error("Expected DENY: scope-\"2\" credential was revoked");
  console.log("   ✅ As expected: revoked authorization no longer grants access.");

  console.log("\n🎉 TaskAuth demo complete:");
  console.log("   • scope-\"1\": DENY at gate-2 (no match), PASS at gate-1");
  console.log("   • scope-\"2\": PASS at gate-2");
  console.log("   • scope-\"2\": revoked → DENY at gate-2");
  process.exit(0);
}

// Returns true if the verification was denied — either an explicit failure,
// or no presentation at all (wallet had no matching credential → timeout).
async function expectDeny(sessionId: string, timeoutMs = 45000): Promise<boolean> {
  try {
    const r = await waitForVerification(sessionId, timeoutMs);
    if (!r.verified) {
      console.log("   → verified: false (explicit failure)");
      return true;
    }
    console.log(`   → verified: true | scope: ${r.attributes.scope}`);
    return false; // unexpectedly passed
  } catch {
    console.log("   → no presentation received (no matching credential → deny)");
    return true;
  }
}

main().catch((err) => {
  console.error("\n❌ Task demo failed:\n", err.message);
  process.exit(1);
});