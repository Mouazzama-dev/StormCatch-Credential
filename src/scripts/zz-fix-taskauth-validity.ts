import { readFileSync } from "node:fs";
import { paradymFetch, walletPath } from "../client.ts";
const id = process.env.PARADYM_TASKAUTH_TEMPLATE_ID!;
const before = JSON.parse(readFileSync(process.argv[2], "utf8"));
const path = walletPath(`/templates/credentials/sd-jwt-vc/${id}`);
await paradymFetch(path, { method: "PUT", body: JSON.stringify({
  name: before.name, description: before.description, attributes: before.attributes,
  background: before.background, text: before.text,
  validUntil: { start: "issuance", future: { days: 30 } },
}) });
const after = await paradymFetch<Record<string, unknown>>(path);
console.log("validFrom:", after.validFrom, "| validUntil:", JSON.stringify(after.validUntil));
