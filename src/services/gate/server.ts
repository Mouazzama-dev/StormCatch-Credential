import express from "express";
import type { Request, Response } from "express";
import { paradymFetch, walletPath } from "../../client.ts";
import { config } from "../../config.ts";

// gate-service: the verifier (checkpoint). Creates a verification request, receives the
// presentation via webhook, then delegates the allow/deny decision to the policy engine
// (through the decision-service). Paradym handles signature + revocation (isValid); the
// engine handles policy (Layer 1 + trust + deny + Cedar).
const PORT = Number(process.env.GATE_PORT ?? 4002);
const DECISION_URL = process.env.DECISION_URL ?? "http://localhost:4003";

// Which presentation template each gate uses (ids from .env via config).
const GATE_TEMPLATES: Record<string, string> = {
  "G-1": config.gate1TemplateId,
  "G-2": config.gate2TemplateId,
};

// If no presentation arrives within this window, treat it as DENY.
const DENY_TIMEOUT_MS = 45_000;

type Outcome =
  | { status: "pending"; startedAt: number; gate: string }
  | { status: "allowed"; attributes: Record<string, unknown>; determiningPolicies?: string[] }
  | { status: "denied"; reason: string; determiningPolicies?: string[] };

const results = new Map<string, Outcome>();

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => res.json({ service: "gate", ok: true }));

// Ask the policy engine (via decision-service) whether this presentation passes the gate.
async function decideViaEngine(
  gate: string,
  attributes: Record<string, unknown>
): Promise<Outcome> {
  const res = await fetch(`${DECISION_URL}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pointId: gate,
      action: attributes.action,
      scope: attributes.scope,
      validUntil: attributes.exp,
    }),
  });
  if (!res.ok) throw new Error(`decision-service ${res.status}: ${await res.text()}`);
  const d = (await res.json()) as {
    allowed: boolean;
    decision?: string;
    determiningPolicies?: string[];
  };
  return d.allowed
    ? { status: "allowed", attributes, determiningPolicies: d.determiningPolicies }
    : { status: "denied", reason: d.decision ?? "policy", determiningPolicies: d.determiningPolicies };
}

// Start a verification at a gate. Returns the URI the robot scans.
app.post("/verify", async (req: Request, res: Response) => {
  const gate = (req.body?.gate ?? "G-1") as string;
  const templateId = GATE_TEMPLATES[gate];
  if (!templateId) {
    res.status(400).json({ error: `No presentation template configured for gate ${gate}` });
    return;
  }
  try {
    const request = await paradymFetch<{ id: string; authorizationRequestUri: string }>(
      walletPath("/openid4vc/verification/request"),
      { method: "POST", body: JSON.stringify({ presentationTemplateId: templateId }) }
    );
    results.set(request.id, { status: "pending", startedAt: Date.now(), gate });
    res.json({ sessionId: request.id, gate, authorizationRequestUri: request.authorizationRequestUri });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Paradym posts verification events here (register this URL via ngrok -> gate port).
app.post("/webhook", (req: Request, res: Response) => {
  const body = req.body;
  const eventType = body?.eventType ?? "unknown";
  const v = body?.payload?.openId4VcVerification;
  const sessionId = v?.id ?? body?.payload?.openId4VcVerificationId;

  if (sessionId && eventType === "openid4vc.verification.data") {
    const cred = v?.credentials?.[0];
    const attributes = (cred?.presentedAttributes ?? {}) as Record<string, unknown>;
    const existing = results.get(sessionId);
    const gate = existing && "gate" in existing ? existing.gate : "G-1";

    // Paradym has already verified signature + revocation status (isValid).
    if (!(cred?.isValid ?? false)) {
      results.set(sessionId, { status: "denied", reason: "not-verified" });
      console.log(`[${gate}] DENY (not-verified) session=${sessionId}`);
    } else {
      // Delegate the policy decision to the engine (async; updates results when done).
      decideViaEngine(gate, attributes)
        .then((outcome) => {
          results.set(sessionId, outcome);
          const detail =
            outcome.status === "allowed" ? outcome.determiningPolicies
            : outcome.status === "denied" ? outcome.reason
            : "";
          console.log(`[${gate}] ${outcome.status.toUpperCase()} session=${sessionId}`, detail ?? "");
        })
        .catch((err) => {
          results.set(sessionId, { status: "denied", reason: `decision-error: ${err.message}` });
          console.log(`[${gate}] DENY (decision-error) session=${sessionId}: ${err.message}`);
        });
    }
  }

  if (sessionId && eventType === "openid4vc.verification.failed") {
    results.set(sessionId, { status: "denied", reason: "verification.failed" });
    console.log(`DENY (verification.failed) session=${sessionId}`);
  }

  res.status(200).json({ received: true });
});

// Poll the outcome. Applies the no-presentation-timeout = DENY rule.
app.get("/result/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const entry = results.get(id);
  if (!entry) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  if (entry.status === "pending") {
    if (Date.now() - entry.startedAt > DENY_TIMEOUT_MS) {
      const denied = { status: "denied" as const, reason: "no-presentation" };
      results.set(id, denied);
      res.json(denied);
      return;
    }
    res.json({ status: "pending" });
    return;
  }
  res.json(entry);
});

app.listen(PORT, () => {
  console.log(`gate-service listening on http://localhost:${PORT}`);
});