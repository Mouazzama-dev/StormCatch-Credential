import { createPayloadTemplate } from "../templates/payload.ts";

async function main() {
  console.log("STEP 02 — Creating payload credential template\n");

  const template = await createPayloadTemplate();

  console.log("✅ Template created:");
  console.log("   id         :", template.id);
  console.log("   name       :", template.name);
  console.log("   type       :", template.type);
  console.log("   revocable  :", template.revocable);
  console.log("\n👉 Save this in your .env:");
  console.log(`   PARADYM_PAYLOAD_TEMPLATE_ID=${template.id}`);
}

main().catch((err) => {
  console.error("❌ Step 02 failed:\n", err.message);
  process.exit(1);
});