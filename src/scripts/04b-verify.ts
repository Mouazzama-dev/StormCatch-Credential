import { requestVerification } from "../credentials/verify.ts";

async function main() {
  console.log("STEP 04b — Creating verification request (OID4VP)\n");

  const request = await requestVerification();

  console.log("✅ Verification request created:");
  console.log("   session id :", request.id);
  console.log("\nFull response (to spot the scannable URL field):");
  console.log(JSON.stringify(request, null, 2));

  console.log("\n👉 Open the request URI in a browser to get a QR code,");
  console.log("   then scan it with the Paradym Wallet to present your credential.");
  console.log("   The result will arrive on your webhook (watch the webhook terminal).");
}

main().catch((err) => {
  console.error("❌ Step 04b failed:\n", err.message);
  process.exit(1);
});