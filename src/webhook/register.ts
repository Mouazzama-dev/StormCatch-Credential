import { paradymFetch, walletPath } from "../client.ts";

export interface Webhook {
  id: string;
  name: string;
  url: string;
  events?: string[];
  createdAt: string;
}

interface ListResponse<T> {
  data: T[];
}

// List all registered webhooks
export async function listWebhooks(): Promise<Webhook[]> {
  const res = await paradymFetch<ListResponse<Webhook>>(walletPath("/webhooks"));
  return res.data;
}

// Register a webhook pointing at the given public URL
export async function registerWebhook(name: string, url: string): Promise<Webhook> {
  return paradymFetch<Webhook>(walletPath("/webhooks"), {
    method: "POST",
    body: JSON.stringify({ name, url }),
  });
}

// Delete a webhook by id (used to clean up stale ngrok URLs between runs)
export async function deleteWebhook(id: string): Promise<void> {
  await paradymFetch(walletPath(`/webhooks/${id}`), { method: "DELETE" });
}