// The seam the central server, the desks and (later) the transit gates are written against. The pilot runs the JWT backend (./jwt.ts); a VC backend over src/templates/payload.ts + Paradym issuance can implement the same interface once Paradym issuance/verification is stable.
//
// The token is the task JWT agreed with Martin (2026-11-17): his claim structure, with the policy engine's point ids in `aud` and `task.gates` (see ./points.ts).

export type TaskItem = { code?: string; name: string; quantity: number };

export interface Task {
  id: string;
  // What the errand is, e.g. "medicine-delivery".
  type: string;
  // The class of goods, in the policy engine's vocabulary (its payloadType, e.g. "sc:medicine"). Absent on tokens issued before 2026-11-24.
  payloadType?: string;
  // Engine point ids: where the payload is loaded and where it is handed over.
  from: string;
  to: string;
  items: TaskItem[];
  // Every point on the route, in order; the token's `aud` is built from it.
  gates: string[];
  // Set on a detour task (pharmacy A out of stock, go to pharmacy B first); null otherwise.
  parentTaskId: string | null;
}

export interface TaskClaims {
  iss: string;
  // The robot the task was issued to.
  sub: string;
  // The points that may accept the token, as point URNs.
  aud: string[];
  jti: string;
  iat: number;
  nbf: number;
  exp: number;
  // Binds the token to the robot's PIC certificate (its SHA-256 thumbprint) once the desks can read that certificate. Absent until then.
  cnf?: { "x5t#S256": string };
  task: Task;
}

export type VerifyResult =
  | { ok: true; claims: TaskClaims }
  | { ok: false; reason: "malformed" | "invalid-signature" | "invalid-issuer" | "expired" | "not-yet-valid" | "wrong-point" | "revoked" };

export type IssueOptions = { cnfThumbprint?: string };

export interface PayloadBackend {
  issue(robotId: string, task: Task, options?: IssueOptions): Promise<{ token: string; jti: string }>;
  // Signature, issuer, time window and blacklist; with `audience`, also that the token names that point. Binding to a robot (sub == robotId) is the caller's check.
  verify(token: string, audience?: string): Promise<VerifyResult>;
  revoke(jti: string, reason?: string): Promise<void>;
}
