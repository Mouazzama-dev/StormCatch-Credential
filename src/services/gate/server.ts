import express from "express";
import type { Request, Response } from "express";
import { paradymFetch, walletPath } from "../../client.ts";
import { config } from "../../config.ts";

// gate-service: the verifier (checkpoint). Creates a verification request,
// receives the presentation result via webhook, runs the decision pipeline
// (trust / deny / policy / identity), and exposes the outcome via GET /result/:id.
// trust/deny/identity are assumption-based sockets for now (RDI/MIL fill later).
const PORT = Number(process.env.GATE_PORT ?? 4002);

// Which presentation template each gate uses (ids come from .env via config).
const GATE_TEMPLATES: Record<string, string> = {
  "G-1": config.gate1TemplateId,
  "G-2": config.gate2TemplateId,
};

// What each gate requires (facility policy, assumption-based for now).
const GATE_POLICY: Record<string, { action: string; scope: string }> = {
  "G-1": { action: "sc:zone_access", scope: "1" },
  "G-2": { action: "sc:zone_access", scope: "2" },
};

// If no presentation arrives within this window, treat it as DENY
// (wallet had no matching credential -> silent no-presentation).
const DENY_TIMEOUT_MS = 45_000;

type Outcome =
  | { status: "pending"; startedAt: number; gate: string }
  | { status: "allowed"; attributes: Record<string, unknown>; checks: Record<string, boolean> }
  | { status: "denied"; reason: string; checks?: Record<string, boolean> };

const results = new Map<string, Outcome>();

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => res.json({ service: "gate", ok: true }));

// ── Decision pipeline sockets (assumption-based; RDI/MIL fill these later) ──
function trustListCheck(_issuer: unknown): boolean {
  return true; // TODO: real trust list — issuer authorised for (frame, value)
}
function denyListCheck(_attributes: Record<string, unknown>): boolean {
  return false; // TODO: real deny list — return true if denied
}
function identityCheck(_attributes: Record<string, unknown>): boolean {
  return true; // TODO: MIL identity governance
}
function policyCheck(gate: string, attributes: Record<string, unknown>): boolean {
  const p = GATE_POLICY[gate];
  if (!p) return false;
  return attributes.action === p.action && attributes.scope === p.scope;
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

    // ── Decision pipeline ──
    const checks = {
      verified: cred?.isValid ?? false,
      trust: trustListCheck(cred?.issuer),
      notDenied: !denyListCheck(attributes),
      policy: policyCheck(gate, attributes),
      identity: identityCheck(attributes),
    };
    const allowed = Object.values(checks).every(Boolean);

    results.set(
      sessionId,
      allowed
        ? { status: "allowed", attributes, checks }
        : { status: "denied", reason: "policy", checks }
    );
    console.log(`[${gate}] ${allowed ? "ALLOW" : "DENY"} session=${sessionId}`, checks);
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