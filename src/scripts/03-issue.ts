import { issuePayload } from "../credentials/issue.ts";

async function main() {
  const payloadType = process.argv[2] ?? "sc:medicine";

  console.log(`STEP 03 — Issuing payload credential (payload_type: ${payloadType})\n`);

  const offer = await issuePayload(payloadType);

  console.log("✅ Issuance offer created:");
  console.log("   session id :", offer.id);
  console.log("\n👉 Open this URL in a browser to get a QR code,");
  console.log("   then scan it with the Paradym Wallet app:\n");
  console.log("   " + offer.offerUri);
}

main().catch((err) => {
  console.error("❌ Step 03 failed:\n", err.message);
  process.exit(1);
});

