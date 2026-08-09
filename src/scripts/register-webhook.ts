import { listWebhooks, registerWebhook, deleteWebhook } from "../webhook/register.ts";

async function main() {
  const publicUrl = process.argv[2];
  if (!publicUrl) {
    console.error("❌ Usage: pnpm register-webhook <ngrok-https-url>");
    console.error("   Example: pnpm register-webhook https://gyration-pastel-professed.ngrok-free.dev");
    process.exit(1);
  }

  const webhookUrl = `${publicUrl.replace(/\/$/, "")}/webhook`;

  console.log("Registering webhook\n");

  // Clean up any previously registered webhooks (stale ngrok URLs)
  const existing = await listWebhooks();
  for (const wh of existing) {
    console.log("   Removing old webhook:", wh.url);
    await deleteWebhook(wh.id);
  }

  const webhook = await registerWebhook("Stormcatch verification receiver", webhookUrl);

  console.log("\n✅ Webhook registered:");
  console.log("   id     :", webhook.id);
  console.log("   url    :", webhook.url);
  console.log("   events :", webhook.events ?? "(all)");
}

main().catch((err) => {
  console.error("❌ Failed:\n", err.message);
  process.exit(1);
});