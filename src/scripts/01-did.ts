import { config } from "../config.ts";
import { getIssuerDid } from "../dids/index.ts";

async function main() {
  console.log("STEP 01 — Loading issuer DID\n");

  const did = await getIssuerDid(config.didId);

  console.log("✅ Issuer DID confirmed:");
  console.log("   internal id :", did.id);
  console.log("   did         :", did.did);
  console.log("   method      :", did.method);
}

main().catch((err) => {
  console.error("❌ Step 01 failed:\n", err.message);
  process.exit(1);
});