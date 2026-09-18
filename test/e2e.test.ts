// End-to-end test: the headless gate-authorisation lifecycle, no phone.
// This is the automated form of `pnpm gate-demo-headless`.
//
// It needs the WHOLE world up: the 4 services, the policy engine (5174, on the
// host, HOST=0.0.0.0 + token), ngrok -> 4002 with the webhook registered, and
// Paradym reachable. Because that is a lot, it only runs when you opt in:
//     RUN_E2E=1 pnpm test
// Otherwise it skips, so a bare `pnpm test` stays green on the cheap tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, up, jpost, jget, sleep } from "./_helpers.ts";

async function pollIssuance(id: string, tries = 60): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const { json } = await jget(`${BASE.facility}/issuance/${id}`);
    if (json?.status === "completed") return json.credentialId;
    await sleep(2000);
  }
  throw new Error("issuance did not complete in time");
}

async function verifyAtGate(gate: string): Promise<string> {
  const { json: v } = await jpost(`${BASE.gate}/verify`, { gate });
  assert.ok(v?.authorizationRequestUri, "gate returned an authorizationRequestUri");
  // Best-effort present; the outcome is read from the gate result.
  await jpost(`${BASE.robot}/present`, { requestUri: v.authorizationRequestUri });
  for (let i = 0; i < 40; i++) {
    const { json: r } = await jget(`${BASE.gate}/result/${v.sessionId}`);
    if (r?.status && r.status !== "pending") return r.status;
    await sleep(2000);
  }
  throw new Error("gate result stayed pending (webhook not received - check ngrok/engine)");
}

test("e2e: issue -> accept -> verify(allow) -> revoke -> verify(deny)", { timeout: 240000 }, async (t) => {
  if (!process.env.RUN_E2E) return t.skip("set RUN_E2E=1 to run (needs full stack + engine + ngrok + Paradym)");
  for (const [name, url] of Object.entries(BASE)) {
    if (!(await up(url))) return t.skip(`${name} not running`);
  }

  // clean wallet
  await jpost(`${BASE.robot}/reset`, {});

  // issue scope-1 and accept it headless
  const { json: offer } = await jpost(`${BASE.facility}/issue`, { action: "sc:zone_access", scope: "1" });
  assert.ok(offer?.offerUri, "facility returned an offerUri");
  const accepted = await jpost(`${BASE.robot}/accept`, { offerUri: offer.offerUri });
  assert.equal(accepted.json?.ok, true, "robot accepted the credential");
  const credentialId = await pollIssuance(offer.issuanceId);
  assert.ok(credentialId, "issuance completed with a credential id");

  // verify at G-1 -> expect allowed
  assert.equal(await verifyAtGate("G-1"), "allowed", "valid scope-1 credential should be allowed at G-1");

  // revoke, then verify again -> expect denied
  await jpost(`${BASE.facility}/revoke`, { credentialIds: [credentialId] });
  assert.equal(await verifyAtGate("G-1"), "denied", "revoked credential should be denied at G-1");
});
