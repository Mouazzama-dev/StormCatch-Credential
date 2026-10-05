import express from "express";
import { setupAgent, acceptOffer, presentCredential } from "./agent.ts";
import { mountDocs } from "./docs.ts";
import { robotOpenapi } from "./openapi.ts";

const PORT = Number(process.env.ROBOT_PORT ?? 4004);
// Unset, the service listens on every interface, which the containers need. On a shared box,
// ROBOT_HOST=127.0.0.1 keeps it off the network: the service has no authentication.
const HOST = process.env.ROBOT_HOST;

async function main() {
  const agent = await setupAgent();
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Clear stored SD-JWT VCs so each demo run starts from an empty wallet.
  app.post("/reset", async (_req, res) => {
    try {
      const all = await agent.sdJwtVc.getAll();
      for (const rec of all) await agent.sdJwtVc.deleteById(rec.id);
      res.json({ ok: true, cleared: all.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error)?.message ?? String(e) });
    }
  });

  // Accept a credential offer (headless issuance, replaces the phone scan).
  app.post("/accept", async (req, res) => {
    try {
      const { offerUri, txCode } = req.body ?? {};
      if (!offerUri) return res.status(400).json({ ok: false, error: "offerUri required" });
      const stored = await acceptOffer(agent, offerUri, txCode);
      res.json({ ok: true, stored: stored.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error)?.message ?? String(e) });
    }
  });

  // Present against an OID4VP request (DCQL, replaces the phone scan).
  app.post("/present", async (req, res) => {
    try {
      const { requestUri } = req.body ?? {};
      if (!requestUri) return res.status(400).json({ ok: false, error: "requestUri required" });
      const result = await presentCredential(agent, requestUri);
      const serverStatus = result?.serverResponse?.status;
      // Surface the verifier's error body: a 4xx from response_uri is the only
      // signal we get when the presentation is rejected (DCQL mismatch, expired
      // request, wrong credential), and the status alone says nothing.
      const serverBody = result?.serverResponse?.body;
      res.json({ ok: result?.ok ?? true, serverStatus, ...(serverStatus && serverStatus >= 400 ? { serverBody } : {}) });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error)?.message ?? String(e) });
    }
  });
mountDocs(app, robotOpenapi);

  app.listen({ port: PORT, host: HOST }, () => console.log(`robot-service listening on http://localhost:${PORT}`));
}
main().catch((e) => {
  console.error("robot-service failed:", e);
  process.exit(1);
});