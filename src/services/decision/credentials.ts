// Which credential in a forwarded verification session is which, and what the decision
// service reads out of each. Shared by the gate (which picks the task authorization for its
// flat fields) and the decision service (which builds the engine's robot from both).
//
// A presentation carried one credential until 2026-10-09; from the birth-certificate bridge
// (Phase 3b) on, the robot presents its identity credential beside the task authorization,
// and `credentials[0]` is whichever the holder put first. So the pick is by `vct`, the type
// claim Paradym copies into presentedAttributes, never by position.

export type SessionCredential = {
  isValid?: boolean;
  issuer?: unknown;
  presentedAttributes?: Record<string, unknown>;
  [k: string]: unknown;
};

// The task authorization's vct is a Paradym metadata URL whose last segment ends in
// "StormcatchTaskAuthorization"; the id in front of it differs per workspace, so the match
// is on the suffix. The birth certificate's vct is the URN the crt-demo bridge issues
// (sample of 2026-10-08).
export const TASK_AUTH_VCT_SUFFIX = "StormcatchTaskAuthorization";
export const BIRTH_CERTIFICATE_VCT = "urn:stormcatch:vct:birth-certificate";

function attrs(c: SessionCredential | undefined): Record<string, unknown> {
  const a = c?.presentedAttributes;
  return a && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, unknown>) : {};
}

function vctOf(c: SessionCredential): string {
  const v = attrs(c).vct;
  return typeof v === "string" ? v : "";
}

export function credentialsOf(session: unknown): SessionCredential[] {
  const list = (session as { credentials?: unknown } | null | undefined)?.credentials;
  return Array.isArray(list) ? (list as SessionCredential[]) : [];
}

// By vct suffix first; else the first credential that carries an `action` claim, which no
// other pilot credential has; else the first credential, which is what every caller read
// before there were two.
export function pickTaskAuth(session: unknown): SessionCredential | undefined {
  const list = credentialsOf(session);
  return (
    list.find((c) => vctOf(c).endsWith(TASK_AUTH_VCT_SUFFIX)) ??
    list.find((c) => typeof attrs(c).action === "string") ??
    list[0]
  );
}

export function pickBirthCertificate(session: unknown): SessionCredential | undefined {
  return credentialsOf(session).find((c) => vctOf(c) === BIRTH_CERTIFICATE_VCT);
}

// The robot facts the engine reads off a birth certificate, in the engine's names. The
// sample nests the build facts under `birthEK`; its top-level `serialNumber` is the EK
// certificate's own serial and is NOT the robot's, so it is never read here. A field that is
// missing or not a non-empty string stays absent: the caller decides what an absent fact
// means, this function does not invent one.
//
// Identity (`machineDid`, the uid the engine screens and the deny list matches on) is not
// derived yet: the credential has no per-robot `id`, only an X.509 subject DN that is the
// same on every robot. Which claim stands for the robot (`hwUuid`, `tpmEkHash`, other) is
// asked of the bridge's author on 2026-10-09; until answered the uid stays unset.
export type BirthFacts = { serialNumber?: string; model?: string };

export function birthFacts(c: SessionCredential | undefined): BirthFacts {
  const ek = attrs(c).birthEK;
  if (!ek || typeof ek !== "object" || Array.isArray(ek)) return {};
  const e = ek as Record<string, unknown>;
  const out: BirthFacts = {};
  if (typeof e.serial === "string" && e.serial !== "") out.serialNumber = e.serial;
  if (typeof e.model === "string" && e.model !== "") out.model = e.model;
  return out;
}
