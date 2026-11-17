import mqtt from "mqtt";
import type { MqttClient } from "mqtt";
import type { Blacklist, FileBlacklist } from "./blacklist.ts";
import type { PayloadBackend } from "./types.ts";

// Revocation by proxy over MQTT. Only the issuer (the central server) revokes a task token: drop-off asks it to, and the central server announces every revoked jti as a RETAINED message, one topic per jti. Any verifier (drop-off now, the transit gates later) subscribes to those topics and so holds the blacklist without reaching the central server's store, which is how the list is shared across devices. The decisions behind this are in docs/interaction-points.md.
export const TOPIC_REVOKE_REQUEST = "stormcatch/payload/revoke-request";
export const TOPIC_REVOKED = "stormcatch/payload/revoked";

export type RevokeRequest = { token: string; robotId: string; reason: string };
type Revoked = { jti: string; reason: string; at: string };

// One login per service: the broker's ACL decides who may publish what (broker/acl). `role` is the username; its password comes from <ROLE>_MQTT_PASSWORD.
export async function connectBroker(role: "central" | "dropoff"): Promise<MqttClient> {
  const url = process.env.MQTT_URL ?? "mqtt://localhost:1883";
  const client = await mqtt.connectAsync(url, {
    clientId: `${role}-${process.pid}`,
    username: role,
    password: process.env[`${role.toUpperCase()}_MQTT_PASSWORD`],
    connectTimeout: 5000,
  });
  // mqtt.js reconnects on its own; say so instead of failing silently.
  client.on("offline", () => console.warn(`[${role}] MQTT broker ${url} offline, reconnecting`));
  client.on("error", (err) => console.error(`[${role}] MQTT error:`, err.message));
  return client;
}

// The verifier's copy of the blacklist, fed by the retained revoked/<jti> messages. It is read-only on purpose: a verifier never revokes, it asks the issuer (requestRevoke).
export class MqttBlacklist implements Blacklist {
  private readonly revoked = new Map<string, Revoked>();
  private readonly waiters = new Map<string, () => void>();

  private constructor(private readonly client: MqttClient) {
    client.on("message", (topic, message) => {
      if (!topic.startsWith(`${TOPIC_REVOKED}/`)) return;
      try {
        const entry = JSON.parse(message.toString()) as Revoked;
        this.revoked.set(entry.jti, entry);
        this.waiters.get(entry.jti)?.();
      } catch {
        console.warn(`[revocation] ignored an unreadable message on ${topic}`);
      }
    });
  }

  // Resolves once subscribed; the broker delivers the retained list right after.
  static async subscribe(client: MqttClient): Promise<MqttBlacklist> {
    const list = new MqttBlacklist(client);
    await client.subscribeAsync(`${TOPIC_REVOKED}/+`, { qos: 1 });
    return list;
  }

  async add(): Promise<void> {
    throw new Error("a verifier does not revoke: ask the issuer with requestRevoke");
  }

  async has(jti: string): Promise<boolean> {
    return this.revoked.has(jti);
  }

  // Ask the central server to revoke and wait for its revoked/<jti> announcement. Safe to repeat: it answers a repeat by announcing the same jti again.
  async requestRevoke(jti: string, request: RevokeRequest, timeoutMs: number): Promise<void> {
    if (this.revoked.has(jti)) return;
    const confirmed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(jti);
        reject(new Error(`the central server did not confirm the revoke of ${jti} within ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiters.set(jti, () => {
        clearTimeout(timer);
        this.waiters.delete(jti);
        resolve();
      });
    });
    await this.client.publishAsync(TOPIC_REVOKE_REQUEST, JSON.stringify(request), { qos: 1 });
    await confirmed;
  }
}

// The issuer's side, run by the central server. It revokes only what it can verify itself: the request carries the token, not a bare jti, so a client with broker access but without the token cannot revoke anyone's payload.
// What the central server does besides revoking: record it in the task store and the activity log.
export type RevocationHooks = {
  onRevoked?: (jti: string, robotId: string, reason: string) => void;
  onRefused?: (robotId: string, reason: string) => void;
};

export async function serveRevocations(client: MqttClient, payload: PayloadBackend, store: FileBlacklist, hooks: RevocationHooks = {}): Promise<void> {
  const announce = (entry: Revoked) =>
    client.publishAsync(`${TOPIC_REVOKED}/${entry.jti}`, JSON.stringify(entry), { qos: 1, retain: true });

  // The local file is the source of truth: re-announce it so a broker that lost its retained messages (restart without persistence) is whole again.
  for (const [jti, e] of Object.entries(store.entries())) await announce({ jti, reason: e.reason, at: e.at });

  client.on("message", async (topic, message) => {
    if (topic !== TOPIC_REVOKE_REQUEST) return;
    let req: RevokeRequest;
    try {
      req = JSON.parse(message.toString()) as RevokeRequest;
    } catch {
      console.warn("[central] ignored an unreadable revoke request");
      return;
    }
    const v = await payload.verify(req.token);
    let jti: string | undefined;
    if (v.ok && v.claims.sub === req.robotId) {
      jti = v.claims.jti;
      await payload.revoke(jti, req.reason);
    } else if (!v.ok && v.reason === "revoked") {
      // A repeat (drop-off missed the first answer). "revoked" is only returned once the signature has checked out, so the token's own jti can be read.
      jti = jtiOf(req.token);
    } else {
      const reason = v.ok ? "robot-mismatch" : v.reason;
      console.warn("[central] refused a revoke request:", reason);
      hooks.onRefused?.(req.robotId, reason);
      return;
    }
    const e = jti ? store.entries()[jti] : undefined;
    if (!jti || !e) return;
    await announce({ jti, reason: e.reason, at: e.at });
    console.log("[central] revoked:", { jti, reason: e.reason, robotId: req.robotId });
    hooks.onRevoked?.(jti, req.robotId, e.reason);
  });
  await client.subscribeAsync(TOPIC_REVOKE_REQUEST, { qos: 1 });
}

function jtiOf(token: string): string | undefined {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).jti;
  } catch {
    return undefined;
  }
}
