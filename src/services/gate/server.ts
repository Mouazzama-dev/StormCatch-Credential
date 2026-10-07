import express from "express";
import type { Request, Response } from "express";
import { paradymFetch, walletPath } from "../../client.ts";
import { config } from "../../config.ts";
import { mountDocs } from "../_docs.ts";
import { gateOpenapi } from "./openapi.ts";

// gate-service: the verifier (checkpoint). Creates a verification request, receives the
// presentation via webhook, then delegates the allow/deny decision to the policy engine
// (through the decision-service). Paradym handles signature + revocation (isValid); the
// engine handles policy (Layer 1 + trust + deny + Cedar).
//
// PHASE B: the presented issuer travels with the decision request. The
// openid4vc.verification.data webhook carries it per credential (credentials[].issuer, and
// iss inside presentedAttributes, read off a captured event on 2026-08-28); only the REST
// session record is shallow. So on a live run the decision-service screens the real issuer,
// and its anchored fallback fires only for a caller that sends none.
const PORT = Number(process.env.GATE_PORT ?? 4002);
// Unset, the service listens on every interface, which the containers need. On a shared box,
// GATE_HOST=127.0.0.1 keeps it off the network: the service has no authentication.
const HOST = process.env.GATE_HOST;
const DECISION_URL = process.env.DECISION_URL ?? "http://localhost:4003";

// Which presentation template each gate uses (ids from .env via config).
const GATE_TEMPLATES: Record<string, string> = {
  "G-1": config.gate1TemplateId,
  "G-2": config.gate2TemplateId,
};

// If no presentation arrives within this window, treat it as DENY. The window
// is armed by the first poll from the robot (it polls right after presenting),
// not by the session creation: the gate display creates sessions ahead of time
// and a code can sit on the panel for minutes before a robot reads it.
const DENY_TIMEOUT_MS = 45_000;

type Outcome =
  | { status: "pending"; startedAt: number; gate: string; polledAt?: number }
  | { status: "allowed"; attributes: Record<string, unknown>; determiningPolicies?: string[] }
  | { status: "denied"; reason: string; determiningPolicies?: string[] };

const results = new Map<string, Outcome>();

// Per-session bookkeeping. The e-paper encodes only the two uuids of the authorization
// request URI ("<invitation>/<request>"); byRequest maps the request uuid back to the
// session so the robot can resolve the exact URI and poll by session id.
type SessionMeta = { gate: string; createdAt: number; authorizationRequestUri: string; requestUuid?: string };
const sessions = new Map<string, SessionMeta>();
const byRequest = new Map<string, string>();
// Which event judged the session: the full "data" event may replace a judgement made
// from the shallow REST record, nothing else replaces a verdict.
const judgedFrom = new Map<string, "data" | "record">();
const SESSION_TTL_MS = 60 * 60_000;

// Paradym hands the request URI back URL-encoded inside the invitation link
// (".../invitation?request_uri=https%3A%2F%2F..."), so decode before matching.
function requestUuidOf(uri: string): string | undefined {
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    // keep the raw string; the match below simply fails
  }
  const m = /authorization-requests\/([0-9a-f-]{36})/i.exec(decoded);
  return m?.[1].toLowerCase();
}

// Accept a session id or a request uuid wherever a session is named.
function resolveSessionId(raw: string): string {
  return byRequest.get(raw.toLowerCase()) ?? raw;
}

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, meta] of sessions) {
    if (meta.createdAt > cutoff) continue;
    sessions.delete(id);
    results.delete(id);
    judgedFrom.delete(id);
    if (meta.requestUuid) byRequest.delete(meta.requestUuid);
  }
}, 10 * 60_000).unref();

const app = express();
app.use(express.json());

// The gate sits behind a public tunnel so Paradym can reach the webhook. Only that path,
// and only with the token in WEBHOOK_TOKEN, is served to tunnel traffic (cloudflared adds
// cf-ray to every request it forwards). Everything else stays LAN-only.
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN ?? "";
const WEBHOOK_PATH = WEBHOOK_TOKEN ? `/webhook/${WEBHOOK_TOKEN}` : "/webhook";
app.use((req: Request, res: Response, next) => {
  const viaTunnel = req.headers["cf-ray"] !== undefined;
  const allowed = (req.method === "POST" && req.path === WEBHOOK_PATH) || (req.method === "GET" && req.path === "/health");
  if (viaTunnel && !allowed) {
    res.status(403).json({ error: "not served over the tunnel" });
    return;
  }
  next();
});

app.get("/health", (_req: Request, res: Response) => res.json({ service: "gate", ok: true }));

// Ask the policy engine (via decision-service) whether this presentation passes the gate.
async function decideViaEngine(
  gate: string,
  verification: any
): Promise<Outcome> {
  const cred = verification?.credentials?.[0];
  const attributes = (cred?.presentedAttributes ?? {}) as Record<string, unknown>;
  // The presented issuer: Paradym's per-credential issuer when present, else the iss claim.
  // A missing or empty value stays absent on the wire.
  const issuerRaw = typeof cred?.issuer === "string" && cred.issuer.length > 0 ? cred.issuer : attributes.iss;
  const issuer = typeof issuerRaw === "string" && issuerRaw.length > 0 ? issuerRaw : undefined;
  const res = await fetch(`${DECISION_URL}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // JSON.stringify drops an undefined issuer, so an absent issuer stays absent on the
    // wire rather than travelling as null or "".
    body: JSON.stringify({
      pointId: gate,
      // Forward the verification session verbatim (issuer + presentedAttributes + raw) and
      // the flat fields, so both decision-service contracts are served.
      session: {
        status: verification?.status ?? "verified",
        credentials: verification?.credentials ?? [],
      },
      action: attributes.action,
      scope: attributes.scope,
      validUntil: attributes.exp,
      issuer,
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
    const requestUuid = requestUuidOf(request.authorizationRequestUri);
    sessions.set(request.id, { gate, createdAt: Date.now(), authorizationRequestUri: request.authorizationRequestUri, requestUuid });
    if (requestUuid) byRequest.set(requestUuid, request.id);
    results.set(request.id, { status: "pending", startedAt: Date.now(), gate });
    res.json({ sessionId: request.id, gate, authorizationRequestUri: request.authorizationRequestUri });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// The robot reader decodes "<invitation>/<request>" off the e-paper and resolves it here
// to the session and the exact authorization request URI, client_id included.
app.get("/request/:uuid", (req: Request, res: Response) => {
  const sessionId = byRequest.get(String(req.params.uuid).toLowerCase());
  const meta = sessionId ? sessions.get(sessionId) : undefined;
  if (!sessionId || !meta) {
    res.status(404).json({ error: "unknown request" });
    return;
  }
  res.json({ sessionId, gate: meta.gate, authorizationRequestUri: meta.authorizationRequestUri });
});

// Judge one verified session: Paradym has already checked signature + revocation
// (isValid); the policy decision is delegated to the engine (async; results updated when done).
// A verdict is final once stored. The one exception: the full "data" event may replace a
// judgement made from the shallow REST record (source "record"), because that record has
// no issuer and would turn a valid presentation into a trust DENY.
function judgeVerification(sessionId: string, verification: any, source: "data" | "record"): void {
  const cred = verification?.credentials?.[0];
  const existing = results.get(sessionId);
  const gate = sessions.get(sessionId)?.gate ?? (existing && "gate" in existing ? existing.gate : "G-1");

  if (existing && existing.status !== "pending") {
    const replaceable = judgedFrom.get(sessionId) === "record" && source === "data";
    if (!replaceable) {
      console.log(`[${gate}] verdict kept (${existing.status}), ${source} event ignored session=${sessionId}`);
      return;
    }
  }
  judgedFrom.set(sessionId, source);

  if (!(cred?.isValid ?? false)) {
    results.set(sessionId, { status: "denied", reason: "not-verified" });
    console.log(`[${gate}] DENY (not-verified) session=${sessionId}`);
    return;
  }
  decideViaEngine(gate, verification)
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

// Paradym sends "verified" and "data" for the same session, "verified" first. "data" carries
// the full credential (issuer included); the REST record behind "verified" is shallow and
// would turn an ALLOW into a trust DENY. So "verified" waits this long for "data" before it
// falls back to the record. The receiver asks for data + failed only, but the subscription
// filter has not been seen to take effect, so every event type must be safe here.
const VERIFIED_GRACE_MS = Number(process.env.VERIFIED_GRACE_MS ?? 3000);

function handleWebhook(req: Request, res: Response): void {
  const body = req.body;
  const eventType = body?.eventType ?? "unknown";
  const v = body?.payload?.openId4VcVerification;
  const sessionId = v?.id ?? body?.payload?.openId4VcVerificationId;
  console.log(`[webhook] ${eventType} session=${sessionId ?? "?"} creds=${v?.credentials?.length ?? "-"} issuer=${v?.credentials?.[0]?.issuer ?? v?.credentials?.[0]?.issuerId ?? "-"}`);

  if (sessionId && eventType === "openid4vc.verification.data") {
    judgeVerification(sessionId, v, "data");
  } else if (sessionId && eventType === "openid4vc.verification.verified" && !judgedFrom.has(sessionId)) {
    setTimeout(() => {
      if (judgedFrom.has(sessionId)) return;
      paradymFetch<any>(walletPath(`/openid4vc/verification/${sessionId}`))
        .then((record) => {
          if (judgedFrom.has(sessionId)) {
            console.log(`[webhook] verified record ignored, data already judged session=${sessionId}`);
            return;
          }
          judgeVerification(sessionId, record, "record");
        })
        .catch((err) => {
          if (judgedFrom.has(sessionId)) return;
          results.set(sessionId, { status: "denied", reason: `session-fetch-error: ${err.message}` });
          console.log(`DENY (session-fetch-error) session=${sessionId}: ${err.message}`);
        });
    }, VERIFIED_GRACE_MS).unref();
  } else if (sessionId && eventType === "openid4vc.verification.failed") {
    const existing = results.get(sessionId);
    if (!existing || existing.status === "pending") {
      results.set(sessionId, { status: "denied", reason: "verification.failed" });
      console.log(`DENY (verification.failed) session=${sessionId}`);
    }
  }

  res.status(200).json({ received: true });
}

app.post(WEBHOOK_PATH, handleWebhook);
if (WEBHOOK_TOKEN) {
  // The bare path stays for LAN tests; the tunnel guard above keeps it off the tunnel.
  app.post("/webhook", handleWebhook);
}

// Poll the outcome. Applies the no-presentation-timeout = DENY rule.
// `?observer=1` (the gate display) reads without arming the timeout.
app.get("/result/:id", (req: Request, res: Response) => {
  const id = resolveSessionId(String(req.params.id));
  const entry = results.get(id);
  if (!entry) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  if (entry.status === "pending") {
    const observer = req.query.observer === "1";
    if (!observer && entry.polledAt === undefined) {
      entry.polledAt = Date.now();
    }
    if (entry.polledAt !== undefined && Date.now() - entry.polledAt > DENY_TIMEOUT_MS) {
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
mountDocs(app, gateOpenapi);
app.listen({ port: PORT, host: HOST }, () => {
  console.log(`gate-service listening on http://localhost:${PORT}`);
});