import express from "express";
import type { Request, Response } from "express";

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
const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:5174";
const TRUSTED_TASKAUTH_ISSUER = "did:key:z6MkStormcatchIssue1";

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
    hasPayloadCredential: true,
    payloadExpiresAt: now + 7200,
    payloadIssuer: "did:key:z6MkAmcPharmacy00001",
  };
}

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
  const credential = session?.credentials?.[0];
  const presented = (credential?.presentedAttributes ?? {}) as Record<string, unknown>;
  const action = presented.action ?? req.body?.action;
  const scope = presented.scope ?? req.body?.scope;
  const validUntil = presented.exp ?? req.body?.validUntil;
  const issuer = credential?.issuer ?? req.body?.issuer;

  const now = Math.floor(Date.now() / 1000);
  const robot = baselineRobot(now);
  robot.hasTaskAuthorization = true;
  robot.taskAuthActions = action ? [String(action)] : [];
  robot.taskAuthScopes = scope !== undefined && scope !== null ? [String(scope)] : [];
  robot.taskAuthValidUntil = typeof validUntil === "number" ? validUntil : now + 3600;
  const presentedIssuer = typeof issuer === "string" && issuer.length > 0 ? issuer : null;
  robot.taskAuthIssuer = presentedIssuer ?? TRUSTED_TASKAUTH_ISSUER;

  // A presented birth certificate (optional) supplies the robot's real identity: the engine
  // derives serialNumber and model from what the credential carries, and the facility deny
  // list keys on that real serial. It arrives as another credential in the forwarded session
  // (vct urn:stormcatch:vct:birth-certificate), or as a flat { serial, model } for a direct
  // caller. Task-auth-only robots keep the pilot defaults - the birth certificate is optional (GT-6).
  const BIRTH_CERT_VCT = "urn:stormcatch:vct:birth-certificate";
  const credentials = (session?.credentials ?? []) as Array<Record<string, unknown>>;
  const birthCredential = credentials.find(
    (c) => c?.vct === BIRTH_CERT_VCT || c?.credentialType === BIRTH_CERT_VCT,
  );
  const birthClaims = ((birthCredential?.presentedAttributes as Record<string, unknown>) ??
    (req.body?.birthCert as Record<string, unknown> | undefined)) as Record<string, unknown> | undefined;
  if (birthClaims) {
    // crt-demo nests the birth-certificate fields under birthEK; accept flat claims too.
    const ek = ((birthClaims.birthEK as Record<string, unknown>) ?? birthClaims) ?? {};
    if (typeof ek.serial === "string" && ek.serial) robot.serialNumber = ek.serial;
    if (typeof ek.model === "string" && ek.model) robot.model = ek.model;
  }

  console.log("[decision] in:", { pointId, action, scope, validUntil, issuer: presentedIssuer ?? "(absent, defaulted)" }, "-> issuer:", robot.taskAuthIssuer, "scopes:", robot.taskAuthScopes, "actions:", robot.taskAuthActions, "validUntil:", robot.taskAuthValidUntil, "now:", now);

  const authorizeBody = {
    actionId: "passCheckpoint",
    robot,
    task: baselineTask(String(pointId), now),
    now,
    enabledPolicies: [],
    disabledConditions: [],
    breakCredential: false,
  };

  try {
    const r = await fetch(`${ENGINE_URL}/api/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      layer1: d.layer1,
      siteLists: d.siteLists,
      stages: d.stages,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.listen(PORT, () =>
  console.log(`decision-service listening on http://localhost:${PORT} (engine at ${ENGINE_URL})`)
);