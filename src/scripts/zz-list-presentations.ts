import { paradymFetch, walletPath } from "../client.ts";
const r = await paradymFetch<any>(walletPath("/templates/presentations"));
const items = Array.isArray(r) ? r : (r.items ?? r.data ?? []);
for (const t of items) console.log(t.id, "|", t.name, "|", t.createdAt?.slice(0,10));
