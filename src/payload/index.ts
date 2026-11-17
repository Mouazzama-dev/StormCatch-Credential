import { randomBytes } from "node:crypto";
import path from "node:path";
import { FileBlacklist } from "./blacklist.ts";
import type { Blacklist } from "./blacklist.ts";
import { devFileOnce } from "./devfile.ts";
import { JwtPayloadBackend, loadJwtKeys } from "./jwt.ts";
import { ActivityLog, TaskStore } from "./tasks.ts";
import type { PayloadBackend } from "./types.ts";

export type { IssueOptions, PayloadBackend, Task, TaskClaims, TaskItem, VerifyResult } from "./types.ts";

// Dev state (keypair, issuer token, blacklist) lives here, gitignored.
const DATA_DIR = process.env.PAYLOAD_DATA_DIR ?? ".payload";
// Matches the baseline payload expiry the decision-service sends the engine (now + 7200).
const TTL_SECONDS = Number(process.env.PAYLOAD_TTL_SECONDS ?? 7200);
// Who issues task tokens: the central server. Verifiers refuse a token from any other issuer.
export const ISSUER_ID = process.env.ISSUER_ID ?? "urn:stormcatch:central";

// The issuer's blacklist: the local file the central server revokes into.
export function issuerBlacklist(): FileBlacklist {
  return new FileBlacklist(process.env.PAYLOAD_BLACKLIST_FILE ?? path.join(DATA_DIR, "blacklist.json"));
}

// The central server's task record and activity log, next to its blacklist.
export const taskStore = () => new TaskStore(process.env.TASKS_FILE ?? path.join(DATA_DIR, "tasks.json"));
export const activityLog = () => new ActivityLog(process.env.ACTIVITY_FILE ?? path.join(DATA_DIR, "activity.jsonl"));

// The shared secret the pickup desk sends to the central server to ask for a token. Set ISSUER_TOKEN on both; on a dev machine one is generated and shared through the data dir.
export async function issuerToken(): Promise<string> {
  if (process.env.ISSUER_TOKEN) return process.env.ISSUER_TOKEN;
  return (await devFileOnce(path.join(DATA_DIR, "dev-issuer-token"), async () => randomBytes(24).toString("base64url"), "issuer token (no ISSUER_TOKEN set)")).trim();
}

// The shared secret both desks send with the events they report for the activity log. Separate from the issuer token, so drop-off can report without being able to mint.
export async function deskToken(): Promise<string> {
  if (process.env.DESK_TOKEN) return process.env.DESK_TOKEN;
  return (await devFileOnce(path.join(DATA_DIR, "dev-desk-token"), async () => randomBytes(24).toString("base64url"), "desk token (no DESK_TOKEN set)")).trim();
}

// The one place a backend is chosen. "vc" is the Paradym seam: not built for the pilot.
export async function payloadBackend(blacklist: Blacklist): Promise<PayloadBackend> {
  const kind = process.env.PAYLOAD_BACKEND ?? "jwt";
  if (kind === "jwt") {
    return new JwtPayloadBackend(await loadJwtKeys(path.join(DATA_DIR, "dev-keys.json")), blacklist, TTL_SECONDS, ISSUER_ID);
  }
  throw new Error(`PAYLOAD_BACKEND=${kind} is not implemented (only "jwt")`);
}
