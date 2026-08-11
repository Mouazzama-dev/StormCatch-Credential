import { createTrustedEntity } from "../trust/trusted-entity.ts";

async function main() {
  const issuerDid = process.argv[2];
  if (!issuerDid) {
    console.error("❌ Usage: pnpm trust-setup <your-issuer-did:web:...>");
    console.error("   Find it in dashboard → Trust → My Identifiers");
    process.exit(1);
  }

  console.log("Creating trusted entity for issuer:", issuerDid, "\n");

  const entity = await createTrustedEntity("Stormcatch Hospital (trusted issuer)", [issuerDid]);

  console.log("✅ Trusted entity created:");
  console.log("   id   :", entity.id);
  console.log("   name :", entity.name);
  console.log("\n👉 Save this in your .env:");
  console.log(`   PARADYM_TRUSTED_ENTITY_ID=${entity.id}`);
}

main().catch((err) => {
  console.error("❌ Failed:\n", err.message);
  process.exit(1);
});