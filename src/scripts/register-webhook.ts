import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { listWebhooks, registerWebhook, deleteWebhook } from "../webhook/register.ts";

// Points the gate wallet's verification webhook at the current public URL of the gate.
//
// The wallet is shared with the account owner, so this script only ever touches the one
// receiver it created itself: its id is kept in WEBHOOK_STATE (default ~/.pilot-webhook.json)
// and that id is the only one deleted. Re-running with the same URL changes nothing, so a
// supervisor can call it every few minutes.
//
// Usage: register-webhook <public-https-url> [--token <t>]
//   The webhook path is /webhook/<token> when a token is given (or WEBHOOK_TOKEN is set);
//   the gate serves only that path over the tunnel.

const WEBHOOK_NAME = "Stormcatch verification receiver";
const WANTED_EVENTS = ["openid4vc.verification.data", "openid4vc.verification.failed"];
const STATE_FILE = process.env.WEBHOOK_STATE ?? join(homedir(), ".pilot-webhook.json");

type State = { id: string; url: string };

function readState(): State | undefined {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    return undefined;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const publicUrl = args.find((a) => !a.startsWith("--"));
  const tokenIdx = args.indexOf("--token");
  const token = tokenIdx >= 0 ? args[tokenIdx + 1] : process.env.WEBHOOK_TOKEN;
  if (!publicUrl) {
    console.error("usage: register-webhook <public-https-url> [--token <t>]");
    process.exit(1);
  }
  const webhookUrl = `${publicUrl.replace(/\/$/, "")}/webhook${token ? `/${token}` : ""}`;

  const existing = await listWebhooks();
  const state = readState();
  const mine = state ? existing.find((wh) => wh.id === state.id) : undefined;

  if (mine && mine.url === webhookUrl) {
    console.log("webhook unchanged:", mine.id, "events:", mine.events ?? "(all)");
    return;
  }
  if (mine) {
    console.log("removing our previous receiver:", mine.id, mine.url.replace(/\/webhook\/.*$/, "/webhook/<token>"));
    await deleteWebhook(mine.id);
  }
  for (const wh of existing) {
    if (wh.id !== mine?.id && wh.name === WEBHOOK_NAME) {
      console.log("note: another receiver with our name exists and is left alone:", wh.id);
    }
  }

  // "verified" is deliberately left out: its REST record is shallow (no issuer) and would
  // override the "data" judgement. The gate tolerates every event type regardless.
  const webhook = await registerWebhook(WEBHOOK_NAME, webhookUrl, WANTED_EVENTS);
  writeFileSync(STATE_FILE, JSON.stringify({ id: webhook.id, url: webhookUrl }), { mode: 0o600 });

  const back = (await listWebhooks()).find((wh) => wh.id === webhook.id);
  const events = back?.events ?? webhook.events;
  console.log("webhook registered:", webhook.id, "events:", events ?? "(all)");
  const filtered = Array.isArray(events) && events.length === WANTED_EVENTS.length && WANTED_EVENTS.every((e) => events.includes(e));
  if (!filtered) {
    console.log("warning: the event filter did not take effect; the gate will see every event type");
  }
}

main().catch((err) => {
  console.error("register-webhook failed:", err.message);
  process.exit(1);
});
