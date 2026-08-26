import { setupAgent, acceptOffer } from "./agent.ts";

async function main() {
  const offerUri = process.argv[2];
  const txCode = process.argv[3];
  if (!offerUri) {
    console.error("Usage: pnpm accept <offerUri> [txCode]");
    process.exit(1);
  }
  const agent = await setupAgent();
  const creds = await acceptOffer(agent, offerUri, txCode);
  console.log(`Stored ${creds.length} credential(s).`);
  await agent.shutdown();
}

main().catch((e) => {
  console.error("accept failed:", e);
  process.exit(1);
});