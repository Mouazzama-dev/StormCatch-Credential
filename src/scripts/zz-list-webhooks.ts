import { listWebhooks } from "../webhook/register.ts";
const hooks = await listWebhooks();
console.log(`webhooks on the gate wallet: ${hooks.length}`);
for (const h of hooks) console.log(`- ${h.url} | events: ${JSON.stringify(h.events ?? "all")}`);
