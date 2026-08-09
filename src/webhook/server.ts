import express from "express";

export interface VerificationResult {
  event: string;
  sessionId: string;
  raw: unknown;
}

// Extract a clean pass/fail + disclosed attributes from a verification.data event
export function summarizeVerification(body: any) {
  const v = body?.payload?.openId4VcVerification;
  if (!v) return null;

  const cred = v.credentials?.[0];
  return {
    sessionId: v.id,
    status: v.status, // "verified" | "error" | ...
    isValid: cred?.isValid ?? false,
    issuer: cred?.issuer,
    attributes: cred?.presentedAttributes ?? {},
  };
}

type ResultHandler = (result: VerificationResult) => void;

export function startWebhookServer(port: number, onResult: ResultHandler) {
  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.send("Stormcatch webhook receiver is running ✅");
  });

  app.post("/webhook", (req, res) => {
    const body = req.body;
    console.log("\n📩 Webhook received:");
    console.log(JSON.stringify(body, null, 2));

    const eventType = body?.eventType ?? "unknown";
    const verification = body?.payload?.openId4VcVerification;
    const sessionId =
      verification?.id ?? body?.payload?.openId4VcVerificationId ?? "unknown";

    onResult({
      event: eventType,
      sessionId,
      raw: body,
    });

    res.status(200).json({ received: true });
  });

  const server = app.listen(port, () => {
    console.log(`🌐 Webhook server listening on http://localhost:${port}`);
  });

  return server;
}