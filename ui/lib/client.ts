// Browser-side helpers shared by the two desks.

export const DEFAULT_ROBOT = "urn:stormcatch:robot:SC-M1:SN-2026-000123";

// The pilot's medication is virtual; these are quick picks for the pickup desk, free text works too.
export const MEDICATION_PRESETS = ["Paracetamol 500 mg x 20", "Amoxicillin 250 mg x 21", "Insulin pen x 2", "Morphine 10 mg/ml x 5 ampoules", "Saline 0.9% 500 ml x 2"];

export type CallResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; message: string };

// Sentences for the refusal codes the services answer with, worded for the person at the desk.
const REASONS: Record<string, string> = {
  malformed: "This is not a payload token.",
  "invalid-signature": "The token was not signed by the pharmacy. It may have been altered.",
  expired: "The payload token has expired. Return the robot to the pharmacy.",
  revoked: "This payload was already received. The token cannot be used again.",
  "robot-mismatch": "This token was issued to a different robot.",
  "not-authorised": "The policy engine does not allow this robot at this point.",
  "revoke-unconfirmed": "The pharmacy did not confirm the receipt in time. Nothing was recorded; try again.",
  "service-down": "The service is not reachable.",
};

export async function call<T>(path: string, body: unknown): Promise<CallResult<T>> {
  try {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, status: r.status, data: json as T };
    const reason = typeof json.reason === "string" ? REASONS[json.reason] : undefined;
    const message = reason ?? (r.status === 403 && json.decision ? REASONS["not-authorised"] : undefined) ?? json.error ?? `Request failed (${r.status}).`;
    return { ok: false, status: r.status, message };
  } catch {
    return { ok: false, status: 0, message: "The desk could not reach its own server." };
  }
}

// Stand-in for the robot carrying the token: the pickup desk keeps the last token in this browser, and the drop-off desk can load it. In the pilot the token goes onto the robot and the drop-off desk reads it from there.
export type CarriedPayload = { robotId: string; token: string; jti: string; contents: string[]; issuedAt: string };
const CARRIED_KEY = "interaction-points:last-payload";

export function saveCarried(p: CarriedPayload): void {
  try {
    localStorage.setItem(CARRIED_KEY, JSON.stringify(p));
  } catch {
    // storage unavailable (private window): the token can still be copied by hand
  }
}

export function loadCarried(): CarriedPayload | null {
  try {
    const raw = localStorage.getItem(CARRIED_KEY);
    return raw ? (JSON.parse(raw) as CarriedPayload) : null;
  } catch {
    return null;
  }
}

export const formatTime = (epochSeconds: number) => new Date(epochSeconds * 1000).toLocaleString();
