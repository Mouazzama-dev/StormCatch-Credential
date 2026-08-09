import { config } from "./config.ts";

async function paradymFetch(path: string, options: RequestInit = {}) {
  const url = `${config.baseUrl}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "x-access-token": config.apiKey,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      `Paradym ${options.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(body)}`
    );
  }

  return body;
}

// GET all wallets — connection test
export async function listWallets() {
  return paradymFetch("/v1/wallets");
}

// List existing sd-jwt-vc credential templates
export async function listCredentialTemplates() {
  return paradymFetch(`/v1/wallets/${config.walletId}/templates/credentials/sd-jwt-vc`);
}

// List existing DIDs
export async function listDids() {
  return paradymFetch(`/v1/wallets/${config.walletId}/dids`);
}