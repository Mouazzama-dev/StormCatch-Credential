// Headless gate-authorisation demo. Same lifecycle as gate-demo.ts, but the holder
// is the Credo robot-service (port 4004): no phone wallet, no QR scan. The
// orchestrator drives accept and present over HTTP.
// Flow: reset robot wallet, issue scope-1, accept, verify at G-1 (ALLOW),
//       revoke, verify at G-1 (DENY).

const FACILITY = process.env.FACILITY_URL ?? "http://localhost:4001";
const GATE = process.env.GATE_URL ?? "http://localhost:4002";
const ROBOT = process.env.ROBOT_URL ?? "http://localhost:4004";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}: ${await res.text()}`);
  return res.json();
}
async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function pollIssuance(issuanceId: string, attempts = 60): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const r = await getJson(`${FACILITY}/issuance/${issuanceId}`);
    if (r.status === "completed") return r.credentialId;
    await sleep(2000);
  }
  throw new Error(`Issuance ${issuanceId} not completed in time`);
}

async function pollResult(sessionId: string, attempts = 40): Promise<any> {
  for (let i = 0; i < attempts; i++) {
    const r = await getJson(`${GATE}/result/${sessionId}`);
    if (r.status !== "pending") return r;
    await sleep(2000);
  }
  throw new Error(`Result ${sessionId} still pending`);
}

async function verifyAtGate(gate: string): Promise<any> {
  const v = await postJson(`${GATE}/verify`, { gate });
  console.log(`   presenting at ${gate} via robot-service...`);
  try {
    const p = await postJson(`${ROBOT}/present`, { requestUri: v.authorizationRequestUri });
    console.log(`   robot presented (ok=${p.ok})`);
  } catch (e) {
    console.log(`   robot present error (continuing to poll): ${(e as Error).message}`);
  }
  return pollResult(v.sessionId);
}

async function main() {
  console.log('=== HEADLESS GATE-AUTH DEMO (G-1, zone access scope "1") ===');

  // 0) Start from an empty robot wallet
  const reset = await postJson(`${ROBOT}/reset`, {});
  console.log(`   robot wallet reset (cleared ${reset.cleared} credential(s)).\n`);

  // 1) Issue a scope-1 zone-access credential, robot accepts it headless
  console.log('=== STEP 1: ISSUE + ACCEPT (sc:zone_access, scope "1") ===');
  const offer = await postJson(`${FACILITY}/issue`, { action: "sc:zone_access", scope: "1" });
  console.log("   robot accepting the credential via robot-service...");
  await postJson(`${ROBOT}/accept`, { offerUri: offer.offerUri });
  const credentialId = await pollIssuance(offer.issuanceId);
  console.log("   credential accepted:", credentialId);

  // 2) Verify at G-1 (expect ALLOW)
  console.log("\n=== STEP 2: VERIFY at G-1 (expecting ALLOW) ===");
  const r1 = await verifyAtGate("G-1");
  console.log(`   result: ${r1.status}${r1.checks ? ` | checks: ${JSON.stringify(r1.checks)}` : ""}`);
  if (r1.status !== "allowed") throw new Error("Expected ALLOW at G-1");
  console.log("   allowed.");

  // 3) Revoke
  console.log("\n=== STEP 3: REVOKE ===");
  await postJson(`${FACILITY}/revoke`, { credentialIds: [credentialId] });
  console.log("   authorisation revoked.");

  // 4) Verify again at G-1 (expect DENY)
  console.log("\n=== STEP 4: VERIFY again at G-1 (expecting DENY) ===");
  const r2 = await verifyAtGate("G-1");
  console.log(`   result: ${r2.status} (reason: ${r2.reason ?? "-"})`);
  if (r2.status === "allowed") throw new Error("Expected DENY after revoke");
  console.log("   denied - revoked credential no longer authorises.");

  console.log("\nHeadless gate-auth lifecycle complete: reset, issue, accept, verify(allow), revoke, verify(deny).");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nHeadless demo failed:\n", err.message);
  process.exit(1);
});