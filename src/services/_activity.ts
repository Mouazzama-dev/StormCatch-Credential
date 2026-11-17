import { deskToken } from "../payload/index.ts";
import type { ActivityEvent } from "../payload/tasks.ts";

// Sends a desk's event to the central server's activity log. Fire and forget: the log never holds up a desk, and a central server that is down only costs the log entry (with a warning).
const CENTRAL_URL = process.env.CENTRAL_URL ?? "http://localhost:4007";
const token = await deskToken();

export function report(e: Omit<ActivityEvent, "at">): void {
  fetch(`${CENTRAL_URL}/activity`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(e),
  })
    .then((r) => {
      if (!r.ok) console.warn(`[activity] central refused ${e.event}: ${r.status}`);
    })
    .catch(() => console.warn(`[activity] central at ${CENTRAL_URL} not reachable, ${e.event} not logged`));
}
