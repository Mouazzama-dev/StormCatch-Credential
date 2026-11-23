// The payload facts the engine screens (its payload frame: hasPayloadCredential, payloadType, payloadOrigin, payloadDestination, payloadExpiresAt, payloadIssuer), from what the caller sends as `payload`:
//   { token }  the robot's task token. Verified here (the central server's signature, issuer, time window); the facts are its claims. Revocation is the desks' check (drop-off holds the blacklist), not this service's.
//   "none"     the robot carries nothing.
//   { held }   what the robot carries, as the caller knows it from the central server's record (the pickup desk asking whether the robot is still out on a delivery).
// Absent, the caller has no payload to show (the gates on the boxes do not yet bring the robot's token), and the baseline stand-in applies.
//
// Who issued the payload, for the engine, is the pharmacy the load came from, not the central server: the engine anchors issuers by DID only, and procedure A has the pharmacy issue the payload. The central server is who signed the token, which is what is verified here.
import path from "node:path";
import { JwtPayloadBackend, loadJwtKeys } from "../../payload/jwt.ts";
import { ISSUER_ID } from "../../payload/index.ts";
import { payloadIssuerOf } from "../../payload/points.ts";
import { DEFAULT_PAYLOAD_TYPE } from "../../payload/tasks.ts";

export type PayloadFacts = {
  hasPayloadCredential: boolean;
  payloadExpiresAt: number;
  payloadIssuer: string;
  payloadType: string;
  payloadOrigin: string;
  payloadDestination: string;
};

export const NO_PAYLOAD: PayloadFacts = { hasPayloadCredential: false, payloadExpiresAt: 0, payloadIssuer: "", payloadType: "", payloadOrigin: "", payloadDestination: "" };

// Where the facts came from, for the log and the answer.
export type PayloadSource = "token" | "none" | "held" | "baseline" | `invalid-token:${string}`;

const carried = (type: string, origin: string, destination: string, expiresAt: number): PayloadFacts => ({
  hasPayloadCredential: true,
  payloadExpiresAt: expiresAt,
  payloadIssuer: payloadIssuerOf(origin) ?? "",
  payloadType: type,
  payloadOrigin: origin,
  payloadDestination: destination,
});

// The central server's public key, loaded on the first token (PAYLOAD_PUBLIC_KEY, or the dev keypair on one machine). A box that never sees a token never needs it.
let verifier: Promise<JwtPayloadBackend> | undefined;
const noBlacklist = { add: async () => {}, has: async () => false };
function tokenVerifier(): Promise<JwtPayloadBackend> {
  verifier ??= loadJwtKeys(path.join(process.env.PAYLOAD_DATA_DIR ?? ".payload", "dev-keys.json")).then((keys) => new JwtPayloadBackend({ publicKey: keys.publicKey }, noBlacklist, 0, ISSUER_ID));
  return verifier;
}

export class PayloadError extends Error {}

// The facts for `payload` as the caller sent it, or undefined when it sent none (the caller then keeps the baseline). A token that does not verify counts as no payload: the engine then refuses a handover and allows a pickup, which is what a forged or expired token deserves.
export async function payloadFactsOf(raw: unknown): Promise<{ facts: PayloadFacts; source: PayloadSource } | undefined> {
  if (raw === undefined || raw === null) return undefined;
  if (raw === "none") return { facts: NO_PAYLOAD, source: "none" };
  if (typeof raw === "object" && typeof (raw as any).token === "string") {
    const v = await (await tokenVerifier()).verify((raw as any).token);
    if (!v.ok) return { facts: NO_PAYLOAD, source: `invalid-token:${v.reason}` };
    const t = v.claims.task;
    return { facts: carried(t.payloadType ?? DEFAULT_PAYLOAD_TYPE, t.from, t.to, v.claims.exp), source: "token" };
  }
  const held = typeof raw === "object" ? (raw as any).held : undefined;
  if (held && typeof held === "object") {
    const { payloadType, origin, destination, expiresAt } = held;
    if (typeof origin !== "string" || typeof destination !== "string" || typeof expiresAt !== "number") {
      throw new PayloadError("payload.held needs origin, destination and expiresAt (epoch seconds)");
    }
    return { facts: carried(typeof payloadType === "string" && payloadType ? payloadType : DEFAULT_PAYLOAD_TYPE, origin, destination, expiresAt), source: "held" };
  }
  throw new PayloadError('payload must be { token }, "none" or { held }');
}
