import { paradymFetch, walletPath } from "../client.ts";
const r = await paradymFetch<any>(walletPath("/openid4vc/verification"));
const items = (Array.isArray(r) ? r : (r.items ?? r.data ?? [])).slice(0, 4);
for (const s of items) console.log(s.id, s.status, s.createdAt, JSON.stringify(s.verification?.data ?? s.error ?? "").slice(0, 160));
