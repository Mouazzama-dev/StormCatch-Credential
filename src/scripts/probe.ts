const base = process.env.PARADYM_BASE_URL ?? "https://api.paradym.id";
const wallet = process.env.PARADYM_WALLET_ID;

// Probe: try creating a webhook with a minimal body to learn required fields.
const res = await fetch(`${base}/v1/wallets/${wallet}/webhooks`, {
  method: "POST",
  headers: {
    "x-access-token": process.env.PARADYM_API_KEY!,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({}),
});

console.log("status:", res.status);
const text = await res.text();
console.log("body:", text.slice(0, 500));