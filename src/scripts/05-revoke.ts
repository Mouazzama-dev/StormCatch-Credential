import { getIssuedCredentialId } from "../credentials/issue.ts";
import { revokeCredentials } from "../credentials/revoke.ts";

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error("❌ Usage: pnpm revoke <issuance-session-id>");
    console.error("   (The session id printed by 'pnpm issue')");
    process.exit(1);
  }

  console.log("STEP 05 — Revoking payload credential\n");

  const credentialId = await getIssuedCredentialId(sessionId);
  console.log("   issued credential id:", credentialId);

  await revokeCredentials([credentialId], true);

  console.log("\n✅ Credential revoked.");
  console.log("   The credential stays in the wallet, but verification will now FAIL.");
  console.log("   Run 'pnpm verify' again to confirm — status should no longer be 'verified'.");
}

main().catch((err) => {
  console.error("❌ Step 05 failed:\n", err.message);
  process.exit(1);
});