const base = process.env.PARADYM_BASE_URL ?? "https://api.paradym.id";
const wallet = process.env.PARADYM_WALLET_ID;

// List recent issuance sessions to find the issued credential id
const res = await fetch(`${base}/v1/wallets/${wallet}/openid4vc/issuance`, {
  method: "GET",
  headers: { "x-access-token": process.env.PARADYM_API_KEY! },
});

console.log("status:", res.status);
const text = await res.text();
console.log(text.slice(0, 1500));