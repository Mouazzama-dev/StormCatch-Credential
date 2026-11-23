import express from "express";
import type { Request, Response } from "express";
import { mountDocs } from "../_docs.ts";
import { decisionOpenapi } from "./openapi.ts";
import { anchoredBirthFacts, issuerKey, pickBirthCertificate, pickTaskAuth, robotUid } from "./credentials.ts";
import { NO_PAYLOAD, PayloadError, payloadFactsOf } from "./payload.ts";

// decision-service: adapter between the gate and the policy engine's HTTP API
// (@stormcatch/authoriser `pnpm api`, POST http://127.0.0.1:5174/api/authorize).
// It turns a friendly { pointId, action, scope, validUntil } into the engine's full
// robot/task AuthorizeBody and forwards it. The engine runs its FULL pipeline:
// Layer 1 + trust + deny + Cedar.
//
// PHASE B: identity/safety/manufacturer stay the pilot's compliant defaults; the taskAuth
// action/scope/expiry and the issuer come from the real presentation. They arrive either as
// the verification session the gate forwards (the shape agreed on 2026-08-28: the webhook's
// credential entries, issuer and presentedAttributes as Paradym sent them) or as flat fields.
// The openid4vc.verification.data webhook carries the issuer; only the REST session record is
// shallow. Both Paradym workspace issuers are anchored on the facility trust list for the
// three pilot actions since 2026-09-20 (PARADYM_PILOT_ISSUER_DID and
// PARADYM_FACILITY_ISSUER_DID; zone access alone before that), so the facility's live
// credentials permit and any other issuer is denied at trust.
//
// The session itself is not passed on: the engine's /api/authorize reads no session field, so
// the issuer is screened only because it is copied into taskAuthIssuer here.
//
// The fallback is the one-sided switch the engine's level-4 tests guard against: an absent
// issuer resolves to an anchored one here, which the engine's own session adapter refuses to
// do. It stays until a live run shows the issuer on every presentation, and it is named as a
// gap.
const PORT = Number(process.env.DECISION_PORT ?? 4003);
// Unset, the service listens on every interface, which the containers need. On a shared box,
// DECISION_HOST=127.0.0.1 keeps it off the network: the service has no authentication.
const HOST = process.env.DECISION_HOST;
const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:5174";
const ENGINE_TOKEN = process.env.ENGINE_TOKEN;
const TRUSTED_TASKAUTH_ISSUER = "did:key:z6MkStormcatchIssue1";
// Issuers whose birth certificates the decision service reads facts from: DIDs or
// `sha256:<hex>` leaf fingerprints, comma-separated. Empty (the default) reads none. An
// interim pin until the engine's trust list carries X.509 anchors and validates the chain.
const BIRTH_CERT_ANCHORS: readonly string[] = (process.env.BIRTH_CERT_ANCHORS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

function baselineRobot(now: number): Record<string, unknown> {
  return {
    hasOperatorCredential: true,
    manufacturerId: "did:key:z6MkAcmeRobotics001",
    operator: "external-fleet-nl",
    certifications: [],
    // The certifying body's DID, not its name: the engine's trust stage screens the safety
    // certification's certifier since 2026-09-20 and refuses any form that is not a DID. This
    // value is ACCEPTED_CERTIFIER in the engine's pilot vocabulary, anchored on the facility
    // trust list for (safetyCert, sc:safety).
    certifier: "did:key:z6MkEuRoboticsAuth01",
    qualityPass: true,
    qualificationValidUntil: now + 315360000,
    accessPassZones: ["meibergdreef-9"],
    clearanceLevel: 2,
    hasHazmat: false,
    hasCleaningCredential: true,
    hasChemicalHandling: false,
    ownerDid: "did:key:z6MkAcmeFleetOwner01",
    controllerDid: "did:key:z6MkAmcTeleops000001",
    serialNumber: "SN-2026-000123",
    model: "SC-M1",
    hasTaskAuthorization: false,
    taskAuthActions: [],
    taskAuthScopes: [],
    taskAuthValidUntil: 0,
    taskAuthIssuer: "",
    hasDisinfection: true,
    disinfectionExpiresAt: now + 900,
    disinfectionIssuer: "did:key:z6MkAmcDeconStation1",
    // The payload a robot on procedure A carries: medicine loaded at the pharmacy (I-1) for the ward (I-2). The engine screens the payload issuer by its class of goods (payloadType), so a payload without one is refused at trust. A stand-in like the rest of this baseline until the payload facts come from the robot's own task token.
    hasPayloadCredential: true,
    payloadExpiresAt: now + 7200,
    payloadIssuer: "did:key:z6MkAmcPharmacy00001",
    payloadType: "sc:medicine",
    payloadOrigin: "I-1",
    payloadDestination: "I-2",
  };
}

// The pharmacy counter, where the robot is loaded.
const PICKUP_POINT = "I-1";

// What a desk asserts with the request (engine Task, authorize 0.2.0): where the pickup desk sends the payload, and the drop-off desk's answer and why. Optional strings; the engine checks the vocabulary.
const DESK_FIELDS = ["deliverTo", "handoverAnswer", "refusalReason"] as const;

function baselineTask(pointId: string, now: number): Record<string, unknown> {
  return {
    pointId,
    location: "meibergdreef-9",
    assignedZones: ["meibergdreef-9"],
    createdAt: now - 600,
    deadline: now + 3600,
    trustedManufacturers: ["did:key:z6MkAcmeRobotics001"],
    acceptedCertifiers: ["did:key:z6MkEuRoboticsAuth01"],
    requiredClearance: 0,
    requiredCertifications: [],
    hazardClass: "",
    requiresChemicalAgents: false,
    zoneOccupied: false,
    requesterAuthority: "",
    emergencyDeclared: false,
    emergencyExpiresAt: 0,
  };
}

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => res.json({ service: "decision", ok: true }));

app.post("/decision", async (req: Request, res: Response) => {
  const { pointId, session } = req.body ?? {};
  if (!pointId) {
    res.status(400).json({ error: "pointId is required" });
    return;
  }

  // Prefer the presented claims from the forwarded session; fall back to the flat fields.
  // The task authorization is picked by its vct, not by position: since the birth
  // certificate bridge the holder may present two credentials in either order.
  const credential = pickTaskAuth(session);
  const presented = (credential?.presentedAttributes ?? {}) as Record<string, unknown>;
  const action = presented.action ?? req.body?.action;
  const scope = presented.scope ?? req.body?.scope;
  const validUntil = presented.exp ?? req.body?.validUntil;
  const issuer = credential?.issuer ?? presented.iss ?? req.body?.issuer;

  const now = Math.floor(Date.now() / 1000);
  const robot = baselineRobot(now);
  // The payload facts from what the caller sent (the robot's token, "none", or what it holds per the central server); without any, the baseline stand-in: procedure A, where the robot arrives at the pharmacy counter (I-1) empty, and the engine refuses a pickup by a robot that already holds a payload, and carries the baseline payload after loading.
  let payload;
  try {
    payload = await payloadFactsOf(req.body?.payload);
  } catch (e) {
    if (!(e instanceof PayloadError)) throw e;
    res.status(400).json({ error: e.message });
    return;
  }
  if (payload) Object.assign(robot, payload.facts);
  else if (pointId === PICKUP_POINT) Object.assign(robot, NO_PAYLOAD);
  const payloadSource = payload?.source ?? "baseline";
  const deskFields: Record<string, string> = {};
  for (const f of DESK_FIELDS) {
    const v = req.body?.[f];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string") {
      res.status(400).json({ error: `${f} must be a string` });
      return;
    }
    deskFields[f] = v;
  }
  robot.hasTaskAuthorization = true;
  robot.taskAuthActions = action ? [String(action)] : [];
  robot.taskAuthScopes = scope !== undefined && scope !== null ? [String(scope)] : [];
  robot.taskAuthValidUntil = typeof validUntil === "number" ? validUntil : now + 3600;
  // An ABSENT issuer falls back to the anchored one (the named gap above). A PRESENT issuer
  // that is not a DID string, an X.509 `{certificate, commonName}`, must not take that road:
  // it travels as its fingerprint, which no trust list entry matches today, so the trust
  // stage refuses it instead of the fallback vouching for it.
  const presentedIssuer =
    typeof issuer === "string" && issuer.length > 0 ? issuer : (issuerKey(credential) ?? null);
  robot.taskAuthIssuer = presentedIssuer ?? TRUSTED_TASKAUTH_ISSUER;

  // Serial and model come from the birth certificate when one is presented by an ANCHORED
  // issuer, from the baseline otherwise (no robot presents one at the pilot gate yet). The
  // platform's "verified" binds no issuer, so an unanchored certificate's facts are ignored,
  // not trusted. A presented certificate whose `birthEK` lacks a field keeps the baseline for
  // that field. The log says which facts were real, one line per decision.
  const birth = pickBirthCertificate(session);
  const { facts, issuer: birthIssuer, anchored } = anchoredBirthFacts(birth, BIRTH_CERT_ANCHORS);
  if (facts.serialNumber !== undefined) robot.serialNumber = facts.serialNumber;
  if (facts.model !== undefined) robot.model = facts.model;
  // `machineDid` is the one key Layer 1 reads as "which machine these documents are for";
  // it mints the birth certificate with that subject and the engine derives the uid back
  // out of it, so the principal Cedar sees is this robot and not the baseline one.
  const uid = robotUid(facts);
  if (uid !== undefined) robot.machineDid = uid;
  const identitySource = !birth
    ? "baseline (no birth certificate presented)"
    : !anchored
      ? `baseline (birth certificate presented by UNANCHORED issuer ${birthIssuer ?? "(absent)"}, facts ignored)`
      : `birth certificate from ${birthIssuer} (serial ${facts.serialNumber ? "read" : "MISSING, baseline kept"}, model ${facts.model ? "read" : "MISSING, baseline kept"}, uid ${uid ?? "not derived"})`;

  console.log("[decision] in:", { pointId, action, scope, validUntil, issuer: presentedIssuer ?? "(absent, defaulted)" }, "-> issuer:", robot.taskAuthIssuer, "scopes:", robot.taskAuthScopes, "actions:", robot.taskAuthActions, "validUntil:", robot.taskAuthValidUntil, "now:", now, "| identity:", identitySource, "serial:", robot.serialNumber, "model:", robot.model, "| payload:", payloadSource, robot.hasPayloadCredential ? `${robot.payloadType} ${robot.payloadOrigin}>${robot.payloadDestination}` : "none", Object.keys(deskFields).length ? deskFields : "");

  const authorizeBody = {
    actionId: "passCheckpoint",
    robot,
    task: { ...baselineTask(String(pointId), now), ...deskFields },
    now,
    enabledPolicies: [],
    disabledConditions: [],
    breakCredential: false,
    // Verification session passed through verbatim for the engine's real trust check.
    ...(session ? { session } : {}),
  };

  try {
    const r = await fetch(`${ENGINE_URL}/api/authorize`, {
            method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ENGINE_TOKEN ? { Authorization: `Bearer ${ENGINE_TOKEN}` } : {}),
      },
      body: JSON.stringify(authorizeBody),
    });
    if (!r.ok) {
      res.status(502).json({ error: `engine ${r.status}: ${await r.text()}` });
      return;
    }
    const d = (await r.json()) as {
      decision: string | null;
      determiningPolicies?: string[];
      layer1?: { ok: boolean; errors: string };
      siteLists?: { ok: boolean; errors: string };
      stages?: unknown;
    };
    console.log("[decision] engine:", d.decision, "| determining:", d.determiningPolicies, "| stages:", JSON.stringify(d.stages));
    res.json({
      allowed: d.decision === "permit",
      decision: d.decision,
      determiningPolicies: d.determiningPolicies ?? [],
      payload: payloadSource,
      layer1: d.layer1,
      siteLists: d.siteLists,
      stages: d.stages,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

mountDocs(app, decisionOpenapi);
app.listen({ port: PORT, host: HOST }, () =>
  console.log(`decision-service listening on http://localhost:${PORT} (engine at ${ENGINE_URL})`)
);