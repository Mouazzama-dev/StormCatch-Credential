import { createTaskAuthPresentationTemplate } from "../credentials/task-auth-flow.ts";

async function main() {
  console.log("Creating gate presentation templates (one-time setup)\n");

  const gate2 = await createTaskAuthPresentationTemplate("2");
  const gate1 = await createTaskAuthPresentationTemplate("1");
  
  console.log("✅ Gate templates created:");
  console.log("\n👉 Save these in your .env:");
  console.log(`   PARADYM_GATE2_TEMPLATE_ID=${gate2.id}`);
  console.log(`   PARADYM_GATE1_TEMPLATE_ID=${gate1.id}`);
}

main().catch((err) => {
  console.error("❌ Failed:\n", err.message);
  process.exit(1);
});