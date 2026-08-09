import { createTaskAuthTemplate } from "../templates/task-auth.ts";

async function main() {
  console.log("Creating TaskAuthorization credential template\n");

  const template = await createTaskAuthTemplate();

  console.log("✅ Template created:");
  console.log("   id   :", template.id);
  console.log("   type :", template.type);
  console.log("\n👉 Save these in your .env:");
  console.log(`   PARADYM_TASKAUTH_TEMPLATE_ID=${template.id}`);
  console.log(`   PARADYM_TASKAUTH_TYPE=${template.type}`);
}

main().catch((err) => {
  console.error("❌ Failed:\n", err.message);
  process.exit(1);
});