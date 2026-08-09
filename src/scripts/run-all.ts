import { startWebhookServer, waitForVerification } from "../webhook/server.ts";
import { issuePayload, getIssuedCredentialId } from "../credentials/issue.ts";
import { requestVerification } from "../credentials/verify.ts";
import { revokeCredentials } from "../credentials/revoke.ts";

const PORT = 3000;

function pause(label: string) {
  console.log(`\n${label}`);
  console.log("   (Open the URL, scan with Paradym Wallet, and approve.)");
}

async function main() {
  // Start the webhook server (result listener) inside the pipeline
  startWebhookServer(PORT, () => {});
  console.log("🌐 Webhook server started on port", PORT);
  console.log("   (ngrok must be running and the webhook registered to this URL)\n");

  // ── STEP 1: Issue ──────────────────────────────────────────────
  console.log("═══ STEP 1: ISSUE ═══");
  const offer = await issuePayload("sc:medicine");
  console.log("✅ Credential offer created. Scan to load it into the wallet:");
  console.log("   " + offer.offerUri);
  console.log("\n⏸  Press ENTER once the credential is in your wallet...");
  await waitForEnter();

  const credentialId = await getIssuedCredentialId(offer.id);
  console.log("   issued credential id:", credentialId);

  // ── STEP 2: Verify (expect PASS) ───────────────────────────────
  console.log("\n═══ STEP 2: VERIFY (expecting PASS) ═══");
  const verify1 = await requestVerification();
  pause("Present the credential:");
  console.log("   " + verify1.authorizationRequestUri);
  const result1 = await waitForVerification(verify1.id);
  console.log(`\n   → verified: ${result1.verified} | payload_type: ${result1.attributes.payload_type}`);
  if (!result1.verified) throw new Error("Expected PASS but got fail");
  console.log("   ✅ As expected: credential is valid.");

  // ── STEP 3: Revoke ─────────────────────────────────────────────
  console.log("\n═══ STEP 3: REVOKE ═══");
  await revokeCredentials([credentialId], true);
  console.log("   ✅ Credential revoked (status list flipped).");

  // ── STEP 4: Verify again (expect FAIL) ─────────────────────────
  console.log("\n═══ STEP 4: VERIFY AGAIN (expecting FAIL) ═══");
  const verify2 = await requestVerification();
  pause("Present the SAME credential again:");
  console.log("   " + verify2.authorizationRequestUri);
  const result2 = await waitForVerification(verify2.id);
  console.log(`\n   → verified: ${result2.verified}`);
  if (result2.verified) throw new Error("Expected FAIL but got pass");
  console.log("   ✅ As expected: revoked credential no longer verifies.");

  console.log("\n🎉 Full lifecycle demonstrated: issue → verify → revoke → verify(fail)");
  process.exit(0);
}

// Minimal ENTER-key wait
function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

main().catch((err) => {
  console.error("\n❌ Pipeline failed:\n", err.message);
  process.exit(1);
});