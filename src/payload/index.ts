import path from "node:path";
import { FileBlacklist } from "./blacklist.ts";
import type { Blacklist } from "./blacklist.ts";
import { JwtPayloadBackend, loadJwtKeys } from "./jwt.ts";
import type { PayloadBackend } from "./types.ts";

export type { PayloadBackend, PayloadClaims, VerifyResult } from "./types.ts";

// Dev state (keypair, blacklist) lives here, gitignored.
const DATA_DIR = process.env.PAYLOAD_DATA_DIR ?? ".payload";
// Matches the baseline payload expiry the decision-service sends the engine (now + 7200).
const TTL_SECONDS = Number(process.env.PAYLOAD_TTL_SECONDS ?? 7200);

// The issuer's blacklist: the local file pickup revokes into.
export function issuerBlacklist(): FileBlacklist {
  return new FileBlacklist(process.env.PAYLOAD_BLACKLIST_FILE ?? path.join(DATA_DIR, "blacklist.json"));
}

// The one place a backend is chosen. "vc" is the Paradym seam: not built for the pilot.
export async function payloadBackend(blacklist: Blacklist): Promise<PayloadBackend> {
  const kind = process.env.PAYLOAD_BACKEND ?? "jwt";
  if (kind === "jwt") {
    return new JwtPayloadBackend(await loadJwtKeys(path.join(DATA_DIR, "dev-keys.json")), blacklist, TTL_SECONDS);
  }
  throw new Error(`PAYLOAD_BACKEND=${kind} is not implemented (only "jwt")`);
}
