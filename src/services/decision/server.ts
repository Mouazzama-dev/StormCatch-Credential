import express from "express";
import type { Request, Response } from "express";

// decision-service: adapter between the gate and the policy engine's HTTP API
// (@stormcatch/authoriser `pnpm api`, POST http://127.0.0.1:5174/api/authorize).
// It turns a friendly { pointId, action, scope, validUntil } into the engine's full
// robot/task AuthorizeBody and forwards it. The engine runs its FULL pipeline:
// Layer 1 + trust + deny + Cedar.
//
// PHASE A: identity/safety/manufacturer/issuer are the pilot's compliant defaults; only
// the taskAuth action/scope/expiry come from the real presentation. taskAuthIssuer is
// defaulted to the engine's anchored issuer so the trust stage passes (the real Paradym
// did:web issuer is not in the pilot trust list -- screening it is a later phase).
const PORT = Number(process.env.DECISION_PORT ?? 4003);
const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:5174";
const ENGINE_TOKEN = process.env.ENGINE_TOKEN;
const TRUSTED_TASKAUTH_ISSUER = "did:key:z6MkStormcatchIssue1";

function baselineRobot(now: number): Record<string, unknown> {
  return {
    hasOperatorCredential: true,
    manufacturerId: "did:key:z6MkAcmeRobotics001",
    operator: "external-fleet-nl",
    certifications: [],
    certifier: "EU Robotics Authority",
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
    acceptedCertifiers: ["EU Robotics Authority"],
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
  const { pointId, action, scope, validUntil } = req.body ?? {};
  if (!pointId) {
    res.status(400).json({ error: "pointId is required" });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const robot = baselineRobot(now);
  robot.hasTaskAuthorization = true;
  robot.taskAuthActions = action ? [String(action)] : [];
  robot.taskAuthScopes = scope !== undefined && scope !== null ? [String(scope)] : [];
  robot.taskAuthValidUntil = typeof validUntil === "number" ? validUntil : now + 3600;
  robot.taskAuthIssuer = TRUSTED_TASKAUTH_ISSUER;

  console.log("[decision] in:", { pointId, action, scope, validUntil }, "-> scopes:", robot.taskAuthScopes, "actions:", robot.taskAuthActions, "validUntil:", robot.taskAuthValidUntil, "now:", now);

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