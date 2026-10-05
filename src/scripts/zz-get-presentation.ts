import { paradymFetch, walletPath } from "../client.ts";
const t = await paradymFetch<any>(walletPath(`/templates/presentations/${process.argv[2]}`));
console.log(JSON.stringify(t, null, 1).slice(0, 1800));
