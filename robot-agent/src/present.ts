import { setupAgent, presentCredential } from "./agent.ts";

async function main() {
  const uri = process.argv[2];
  if (!uri) {
    console.error("Usage: pnpm present <authorizationRequestUri>");
    process.exit(1);
  }
  const agent = await setupAgent();
  try {
    const result = await presentCredential(agent, uri);
    console.log("Presentation submitted:", JSON.stringify(result).slice(0, 500));
  } catch (e) {
    console.error("present failed:", e);
  } finally {
    await agent.shutdown();
  }
}

main().catch((e) => {
  console.error("present failed:", e);
  process.exit(1);
});