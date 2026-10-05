import { paradymFetch, walletPath } from "../client.ts";
const s = await paradymFetch<any>(walletPath(`/openid4vc/verification/${process.argv[2]}`));
console.log(JSON.stringify(s, null, 1).slice(0, 2500));
