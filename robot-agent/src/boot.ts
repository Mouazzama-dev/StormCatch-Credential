import { setupAgent } from "./agent.ts";

async function main() {
  const agent = await setupAgent();
  const key = await agent.kms.createKeyForSignatureAlgorithm({ algorithm: "Ed25519" });
  console.log("Robot holder agent booted. KMS key:", key.keyId);
  await agent.shutdown();
}

main().catch((e) => {
  console.error("boot failed:", e);
  process.exit(1);
});