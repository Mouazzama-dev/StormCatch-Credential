// Which credential in a forwarded verification session is which, and what the decision
// service reads out of each. Shared by the gate (which picks the task authorization for its
// flat fields) and the decision service (which builds the engine's robot from both).
//
// A presentation carried one credential until 2026-10-09; from the birth-certificate bridge
// (Phase 3b) on, the robot presents its identity credential beside the task authorization,
// and `credentials[0]` is whichever the holder put first. So the pick is by `vct`, the type
// claim Paradym copies into presentedAttributes, never by position.

import { createHash, X509Certificate } from "node:crypto";

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

// The issuer of a credential as one comparable string: a DID as Paradym sends it, or for an
// X.509 issuer (`{certificate, commonName}`) the SHA-256 fingerprint of the certificate's
// DER, `sha256:<hex>`, the same value `openssl x509 -fingerprint -sha256` prints without the
// colons. The commonName is never used: any certificate can carry any name.
export function issuerKey(c: SessionCredential | undefined): string | undefined {
  const issuer = c?.issuer;
  if (typeof issuer === "string") return issuer.length > 0 ? issuer : undefined;
  if (!issuer || typeof issuer !== "object") return undefined;
  const pem = (issuer as { certificate?: unknown }).certificate;
  if (typeof pem !== "string") return undefined;
  const body = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  if (body === "") return undefined;
  const der = Buffer.from(body, "base64");
  return `sha256:${createHash("sha256").update(der).digest("hex")}`;
}

// A trust anchor that names a root certificate rather than one signing cert: the base64 of
// an X.509 root (DER or PEM). It trusts ANY leaf that chains to that root, so a rotated
// crt-demo signing certificate keeps working without re-pinning. The crt-demo root signs
// end-entity certs directly (CA:TRUE, pathlen 0), so one issued-by plus one signature check
// is the whole chain.
export const X509_ROOT_PREFIX = "x509root:";

// The credential's own signing certificate (the end-entity leaf Paradym reports as the
// issuer) as a PEM, or undefined when the issuer is a DID or carries no certificate.
function leafCertPem(c: SessionCredential | undefined): string | undefined {
  const issuer = c?.issuer;
  if (!issuer || typeof issuer !== "object") return undefined;
  const pem = (issuer as { certificate?: unknown }).certificate;
  return typeof pem === "string" && pem.includes("BEGIN CERTIFICATE") ? pem : undefined;
}

// True when the credential's leaf certificate is issued by, and validly signed under, one of
// the `x509root:` anchors, and is itself within its validity window. A malformed leaf or
// anchor is skipped, never thrown: one bad entry must not disable the rest of the list.
function chainsToAnchoredRoot(c: SessionCredential | undefined, anchors: readonly string[]): boolean {
  const pem = leafCertPem(c);
  if (pem === undefined) return false;
  let leaf: X509Certificate;
  try {
    leaf = new X509Certificate(pem);
  } catch {
    return false;
  }
  const now = Date.now();
  if (now < Date.parse(leaf.validFrom) || now > Date.parse(leaf.validTo)) return false;
  for (const anchor of anchors) {
    if (!anchor.startsWith(X509_ROOT_PREFIX)) continue;
    try {
      const root = new X509Certificate(Buffer.from(anchor.slice(X509_ROOT_PREFIX.length), "base64"));
      if (leaf.checkIssued(root) && leaf.verify(root.publicKey)) return true;
    } catch {
      // Ignore this anchor and try the next one.
    }
  }
  return false;
}

// Facts are read only from a credential whose issuer is anchored, because the platform's
// "verified" binds no issuer: a presentation template without a trusted entity accepts any
// signer, and a self-signed birth certificate would otherwise choose its own serial and walk
// past a deny entry on the real one. An issuer is anchored two ways, and the list may hold
// either or both: an exact DID or `sha256:<hex>` leaf fingerprint (the interim pin), or an
// `x509root:` anchor its leaf chains to. An empty list reads nothing.
export function anchoredBirthFacts(
  c: SessionCredential | undefined,
  anchors: readonly string[],
): { facts: BirthFacts; issuer: string | undefined; anchored: boolean } {
  const issuer = issuerKey(c);
  const exact = issuer !== undefined && anchors.includes(issuer);
  const anchored = exact || chainsToAnchoredRoot(c, anchors);
  return { facts: anchored ? birthFacts(c) : {}, issuer, anchored };
}

export function birthFacts(c: SessionCredential | undefined): BirthFacts {
  const ek = attrs(c).birthEK;
  if (!ek || typeof ek !== "object" || Array.isArray(ek)) return {};
  const e = ek as Record<string, unknown>;
  const out: BirthFacts = {};
  if (typeof e.serial === "string" && e.serial !== "") out.serialNumber = e.serial;
  if (typeof e.model === "string" && e.model !== "") out.model = e.model;
  return out;
}

// The robot's identity as the engine's uid, from the pair that keys the robot everywhere in
// the certificate model (the robot-provisioning draft of 2026-10-09: "certificates link to
// the robot record", keyed SerialNumber + ModelCode). A URN, because the birth-certificate
// schema requires the subject id to be a URI; the two parts are percent-encoded so a serial
// with a slash or a space cannot forge another robot's name. Undefined when either part is
// missing: half an identity is no identity, and the engine's absent-uid path handles it.
export const ROBOT_URN_PREFIX = "urn:stormcatch:robot:";

export function robotUid(facts: BirthFacts): string | undefined {
  if (facts.serialNumber === undefined || facts.model === undefined) return undefined;
  return `${ROBOT_URN_PREFIX}${encodeURIComponent(facts.model)}:${encodeURIComponent(facts.serialNumber)}`;
}
