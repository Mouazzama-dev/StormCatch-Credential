import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// Revoked payload ids. A JWT cannot be revoked, so its jti is blacklisted and every verifier checks the list. Two implementations: this file store is the issuer's (pickup's) own record, and MqttBlacklist (./revocation.ts) is the copy a verifier keeps from the broker. Both sit behind the same two async calls so either can become a central store later.
export interface Blacklist {
  add(jti: string, reason: string): Promise<void>;
  has(jti: string): Promise<boolean>;
}

type Entry = { reason: string; at: string };

export class FileBlacklist implements Blacklist {
  constructor(private readonly file: string) {}

  // Read on every call, not cached: the other service writes the same file.
  private read(): Record<string, Entry> {
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as Record<string, Entry>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
  }

  async add(jti: string, reason: string): Promise<void> {
    const entries = this.read();
    if (entries[jti]) return;
    entries[jti] = { reason, at: new Date().toISOString() };
    mkdirSync(path.dirname(this.file), { recursive: true });
    // Write-then-rename so a reader never sees a half-written file.
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(entries, null, 2));
    renameSync(tmp, this.file);
  }

  async has(jti: string): Promise<boolean> {
    return jti in this.read();
  }

  // Everything revoked so far, for the issuer to re-announce over MQTT.
  entries(): Record<string, Entry> {
    return this.read();
  }
}
