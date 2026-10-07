import { listWebhooks, registerWebhook, deleteWebhook } from "../webhook/register.ts";

const WEBHOOK_NAME = "Stormcatch verification receiver";

async function main() {
  const publicUrl = process.argv[2];
  if (!publicUrl) {
    console.error("❌ Usage: pnpm register-webhook <ngrok-https-url>");
    console.error("   Example: pnpm register-webhook https://gyration-pastel-professed.ngrok-free.dev");
    process.exit(1);
  }

  const webhookUrl = `${publicUrl.replace(/\/$/, "")}/webhook`;

  console.log("Registering webhook\n");

  // Remove only the receivers this script created (stale quick-tunnel URLs). The gate
  // wallet is shared with the account owner, whose other webhooks must stay.
  const existing = await listWebhooks();
  for (const wh of existing) {
    const ours = wh.name === WEBHOOK_NAME || /\.trycloudflare\.com\//.test(wh.url);
    if (!ours) {
      console.log("   Keeping foreign webhook:", wh.url);
      continue;
    }
    console.log("   Removing old webhook:", wh.url);
    await deleteWebhook(wh.id);
  }

  // Only the two events the gate acts on. "verified" is deliberately left out: its
  // REST record is shallow (no issuer) and would override the "data" judgement.
  const webhook = await registerWebhook(WEBHOOK_NAME, webhookUrl, [
    "openid4vc.verification.data",
    "openid4vc.verification.failed",
  ]);

  console.log("\n✅ Webhook registered:");
  console.log("   id     :", webhook.id);
  console.log("   url    :", webhook.url);
  console.log("   events :", webhook.events ?? "(all)");
}

main().catch((err) => {
  console.error("❌ Failed:\n", err.message);
  process.exit(1);
});