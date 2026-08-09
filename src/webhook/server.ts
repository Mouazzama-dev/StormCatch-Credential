import express from "express";

type PendingResolver = (verified: boolean, attributes: Record<string, unknown>) => void;
const pending = new Map<string, PendingResolver>();

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

export function startWebhookServer(
  port: number,
  onResult: ResultHandler,
  options: { verbose?: boolean } = {}
) {  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.send("Stormcatch webhook receiver is running ✅");
  });

  app.post("/webhook", (req, res) => {
    const body = req.body;
if (options.verbose) {
      console.log("\n📩 Webhook received:");
      console.log(JSON.stringify(body, null, 2));
    }
    const eventType = body?.eventType ?? "unknown";
    const verification = body?.payload?.openId4VcVerification;
    const sessionId =
      verification?.id ?? body?.payload?.openId4VcVerificationId ?? "unknown";

    onResult({
      event: eventType,
      sessionId,
      raw: body,
    });

    // Notify anyone waiting on this specific session's final result
    if (eventType === "openid4vc.verification.data") {
      const resolver = pending.get(sessionId);
      if (resolver) {
        pending.delete(sessionId);
        resolver(true, verification?.credentials?.[0]?.presentedAttributes ?? {});
      }
    }
    if (eventType === "openid4vc.verification.failed") {
      const resolver = pending.get(sessionId);
      if (resolver) {
        pending.delete(sessionId);
        resolver(false, {});
      }
    }
    // Notify anyone waiting on an issuance to complete
    if (eventType === "openid4vc.issuance.completed") {
      const issuanceId = body?.payload?.openId4VcIssuanceId;
      if (issuanceId) resolveIssuance(issuanceId);
    }
    res.status(200).json({ received: true });
  });

  const server = app.listen(port, () => {
    console.log(`🌐 Webhook server listening on http://localhost:${port}`);
  });

  return server;
}

// Wait for a verification result (data or failed) for a specific session.
// Resolves with { verified: boolean, attributes } once the webhook fires.
export function waitForVerification(
  sessionId: string,
  timeoutMs = 120000
): Promise<{ verified: boolean; attributes: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(sessionId);
      reject(new Error(`Timed out waiting for verification ${sessionId}`));
    }, timeoutMs);

    pending.set(sessionId, (verified, attributes) => {
      clearTimeout(timer);
      resolve({ verified, attributes });
    });
  });
}

const pendingIssuance = new Map<string, () => void>();

// Wait until an issuance session completes (credential accepted into wallet)
export function waitForIssuance(issuanceId: string, timeoutMs = 120000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingIssuance.delete(issuanceId);
      reject(new Error(`Timed out waiting for issuance ${issuanceId}`));
    }, timeoutMs);

    pendingIssuance.set(issuanceId, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Called by the webhook handler when an issuance completes
export function resolveIssuance(issuanceId: string) {
  const resolver = pendingIssuance.get(issuanceId);
  if (resolver) {
    pendingIssuance.delete(issuanceId);
    resolver();
  }
}