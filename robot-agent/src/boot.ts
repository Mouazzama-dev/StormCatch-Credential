import { KeyType } from "@credo-ts/core";
import { setupAgent } from "./agent.ts";

async function main() {
  const agent = await setupAgent();
  const created = await agent.dids.create({
    method: "key",
    options: { keyType: KeyType.Ed25519 },
  });
  console.log("✅ Robot holder agent booted. DID:", created.didState.did);
  await agent.shutdown();
}

main().catch((e) => {
  console.error("❌ boot failed:", e);
  process.exit(1);
});