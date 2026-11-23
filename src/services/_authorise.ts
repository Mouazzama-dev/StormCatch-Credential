// Asks the decision-service (and through it the policy engine) whether a manned interaction point may serve a robot. Shared by pickup and drop-off.
//
// The points are the engine's own interaction points (topology.ts): I-1 the pharmacy pickup counter, I-2 / I-3 the ward medicine handover (I-3 in the clean room). The robot's task authorisation is the medicine errand, sc:medicine_pickup with no scope: I-1 refuses anything else and the handover points accept it. POINT_AUTH_ACTION / POINT_AUTH_SCOPE override it. The desks send what the engine screens of the payload: the robot's task token at a handover, at the pickup counter whether the robot is still out on a delivery (the central server's record), plus what the desk asserts (where the payload goes, the nurse's answer). The robot id is not sent: the decision-service reads identity from a presented birth certificate only, and the manned points receive none yet (person sign-in and the robot's presentation there are Martin's onboarding platform).
const DECISION_URL = process.env.DECISION_URL ?? "http://localhost:4003";
const ACTION = process.env.POINT_AUTH_ACTION ?? "sc:medicine_pickup";
// Unset, no scope travels (JSON.stringify drops it): the medicine errand has none.
const SCOPE = process.env.POINT_AUTH_SCOPE;

export type Authorisation = { allowed: boolean; decision: string | null; determiningPolicies: string[] };

// What a desk adds to the request (decision-service /decision): the payload the robot carries, and the engine Task fields a desk asserts.
export type PointRequest = {
  payload?: { token: string } | "none" | { held: { payloadType?: string; origin: string; destination: string; expiresAt: number } };
  deliverTo?: string;
  handoverAnswer?: "sc:accepted" | "sc:refused";
  refusalReason?: string;
};

export async function authorisePoint(pointId: string, request: PointRequest = {}): Promise<Authorisation> {
  const res = await fetch(`${DECISION_URL}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pointId, action: ACTION, scope: SCOPE, ...request }),
  });
  if (!res.ok) throw new Error(`decision-service ${res.status}: ${await res.text()}`);
  const d = (await res.json()) as { allowed: boolean; decision?: string | null; determiningPolicies?: string[] };
  return { allowed: d.allowed, decision: d.decision ?? null, determiningPolicies: d.determiningPolicies ?? [] };
}
