import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Task, TaskItem } from "./types.ts";

// The central server's record of tasks and of everything that happened to them. Tasks are planned ahead (the pharmacy summons a robot), issued when the pharmacist confirms the load, and received at the ward. Both are plain files next to the blacklist; the pilot is small enough to read them whole.

export type TaskStatus = "planned" | "issued" | "received" | "cancelled" | "recalled";

export type TaskRecord = {
  robotId: string;
  status: TaskStatus;
  task: Task;
  // The token's id once issued.
  jti?: string;
  createdAt: string;
  updatedAt: string;
};

export class TaskStore {
  constructor(private readonly file: string) {}

  private read(): Record<string, TaskRecord> {
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as Record<string, TaskRecord>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
  }

  // Write-then-rename so a reader never sees a half-written file.
  private write(all: Record<string, TaskRecord>): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2));
    renameSync(tmp, this.file);
  }

  get(id: string): TaskRecord | undefined {
    return this.read()[id];
  }

  // Newest first, optionally narrowed to one robot and/or one status.
  list(filter: { robotId?: string; status?: TaskStatus } = {}): TaskRecord[] {
    return Object.values(this.read())
      .filter((r) => (!filter.robotId || r.robotId === filter.robotId) && (!filter.status || r.status === filter.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  byJti(jti: string): TaskRecord | undefined {
    return Object.values(this.read()).find((r) => r.jti === jti);
  }

  put(record: TaskRecord): void {
    const all = this.read();
    all[record.task.id] = record;
    this.write(all);
  }

  // Changes one record in place; returns it, or undefined when there is no such task.
  update(id: string, change: (r: TaskRecord) => void): TaskRecord | undefined {
    const all = this.read();
    const r = all[id];
    if (!r) return undefined;
    change(r);
    r.updatedAt = new Date().toISOString();
    this.write(all);
    return r;
  }
}

// What happened, one line per event, appended. `point` is the engine point id where it happened, when there is one.
export type ActivityEvent = {
  at: string;
  event: string;
  taskId?: string;
  robotId?: string;
  point?: string;
  outcome?: "ok" | "refused";
  detail?: string;
};

export class ActivityLog {
  constructor(private readonly file: string) {}

  add(e: Omit<ActivityEvent, "at">): ActivityEvent {
    const entry = { at: new Date().toISOString(), ...e };
    mkdirSync(path.dirname(this.file), { recursive: true });
    appendFileSync(this.file, JSON.stringify(entry) + "\n");
    return entry;
  }

  // Newest first.
  list(filter: { taskId?: string; robotId?: string; limit?: number } = {}): ActivityEvent[] {
    let lines: string[];
    try {
      lines = readFileSync(this.file, "utf8").split("\n").filter(Boolean);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const out: ActivityEvent[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < (filter.limit ?? Infinity); i--) {
      let e: ActivityEvent;
      try {
        e = JSON.parse(lines[i]) as ActivityEvent;
      } catch {
        continue;
      }
      if (filter.taskId && e.taskId !== filter.taskId) continue;
      if (filter.robotId && e.robotId !== filter.robotId) continue;
      out.push(e);
    }
    return out;
  }
}

// The items as a desk sends them: 1 to MAX_ITEMS of { name, quantity, code? }, or null when malformed.
export const MAX_ITEMS = 20;
export function readItems(raw: unknown): TaskItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) return null;
  const items: TaskItem[] = [];
  for (const x of raw) {
    const name = typeof x?.name === "string" ? x.name.trim() : "";
    const quantity = x?.quantity;
    if (!name || name.length > 100 || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) return null;
    if (x.code !== undefined && (typeof x.code !== "string" || x.code.length === 0 || x.code.length > 64)) return null;
    items.push({ ...(x.code ? { code: x.code } : {}), name, quantity });
  }
  return items;
}
