import { createPayloadPresentationTemplate } from "../templates/presentation.ts";

async function main() {
  console.log("STEP 04a — Creating presentation template\n");

  const template = await createPayloadPresentationTemplate();

  console.log("✅ Presentation template created:");
  console.log("   id   :", template.id);
  console.log("   name :", template.name);
  console.log("\n👉 Save this in your .env:");
  console.log(`   PARADYM_PRESENTATION_TEMPLATE_ID=${template.id}`);
}

main().catch((err) => {
  console.error("❌ Step 04a failed:\n", err.message);
  process.exit(1);
});