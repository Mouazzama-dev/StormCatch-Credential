import express from "express";
import type { Request, Response } from "express";
import { issueTaskAuth } from "../../credentials/task-auth-flow.ts";
import { revokeCredentials } from "../../credentials/revoke.ts";
import { paradymFetch, walletPath } from "../../client.ts";

// facility-service: the facility side of the lifecycle — issues and revokes
// TaskAuthorization credentials. No webhook: issuance progress is polled.
const PORT = Number(process.env.FACILITY_PORT ?? 4001);

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ service: "facility", ok: true });
});

// Issue a TaskAuthorization credential (e.g. action "sc:zone_access", scope "1").
// Returns the issuance id (poll it via GET /issuance/:id) and the offer URI (QR).
app.post("/issue", async (req: Request, res: Response) => {
  const { action, scope } = req.body ?? {};
  if (!action || !scope) {
    res.status(400).json({ error: "action and scope are required" });
    return;
  }
  try {
    const offer = await issueTaskAuth(action, scope);
    res.json({ issuanceId: offer.id, offerUri: offer.offerUri });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Poll an issuance session's status (replaces the issuance webhook).
// Returns the raw Paradym status plus the issued credential id once present.
app.get("/issuance/:id", async (req: Request, res: Response) => {
  try {
    const session = await paradymFetch<{
      id: string;
      status: string;
      credentials?: Array<{ id: string; status: string }>;
    }>(walletPath(`/openid4vc/issuance/${req.params.id}`));

    res.json({
      issuanceId: session.id,
      status: session.status,
      credentialId: session.credentials?.[0]?.id ?? null,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Revoke one or more issued credentials (flips the status list).
app.post("/revoke", async (req: Request, res: Response) => {
  const { credentialIds, notifyWallet = true } = req.body ?? {};
  if (!Array.isArray(credentialIds) || credentialIds.length === 0) {
    res.status(400).json({ error: "credentialIds (non-empty array) is required" });
    return;
  }
  try {
    await revokeCredentials(credentialIds, notifyWallet);
    res.json({ revoked: credentialIds });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`facility-service listening on http://localhost:${PORT}`);
});