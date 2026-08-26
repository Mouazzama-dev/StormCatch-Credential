import { setupAgent, acceptOffer } from "./agent.ts";

async function main() {
  const offerUri = process.argv[2];
  if (!offerUri) {
    console.error("Usage: pnpm accept <offerUri>");
    process.exit(1);
  }
  const agent = await setupAgent();
  const creds = await acceptOffer(agent, offerUri);
  console.log(`✅ Stored ${creds.length} credential(s).`);
  for (const c of creds) console.log("   ", JSON.stringify(c).slice(0, 300));
  await agent.shutdown();
}

main().catch((e) => {
  console.error("❌ accept failed:", e);
  process.exit(1);
});