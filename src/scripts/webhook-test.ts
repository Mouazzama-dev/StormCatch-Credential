import { startWebhookServer, summarizeVerification } from "../webhook/server.ts";

const PORT = 3000;


startWebhookServer(PORT, (result) => {
  console.log(`\n✅ Event: ${result.event} | session: ${result.sessionId}`);

  if (result.event === "openid4vc.verification.data") {
    const summary = summarizeVerification(result.raw);
    console.log("   ── Verification summary ──");
    console.log("   status     :", summary?.status);
    console.log("   valid      :", summary?.isValid);
    console.log("   payload    :", summary?.attributes?.payload_type);
    console.log("   issuer     :", summary?.issuer);
  }
});

console.log("\n👉 ngrok wale URL ko browser mein khol — 'running ✅' dikhna chahiye.");
console.log("   (Ye server chalta rahega; band karne ko Ctrl+C)\n");