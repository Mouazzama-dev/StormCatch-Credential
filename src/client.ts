import { config } from "./config.ts";

type FetchOptions = RequestInit & { method?: string };

export async function paradymFetch<T = unknown>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
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

  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Paradym ${options.method ?? "GET"} ${path} returned non-JSON ` +
      `(${response.status}). Likely a wrong path. First 200 chars: ${text.slice(0, 200)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Paradym ${options.method ?? "GET"} ${path} failed (${response.status}): ` +
      JSON.stringify(body)
    );
  }

  return body as T;
}

// Helper: wallet-scoped path banata hai taake har jagah walletId na likhna pade
export function walletPath(suffix: string): string {
  return `/v1/wallets/${config.walletId}${suffix}`;
}