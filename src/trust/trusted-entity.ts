import { paradymFetch, walletPath } from "../client.ts";
import { config } from "../config.ts";

export interface TrustedEntity {
  id: string;
  name: string;
  [key: string]: unknown;
}

// Create a trusted entity holding one or more issuer DIDs.
// Only credentials issued by these DIDs will be accepted where this entity is linked.
export async function createTrustedEntity(name: string, dids: string[]): Promise<TrustedEntity> {
  return paradymFetch<TrustedEntity>(
    walletPath("/trusted-entities"),
    {
      method: "POST",
      body: JSON.stringify({
        name,
        dids: dids.map((did, i) => ({ name: `DID ${i + 1}`, did })),
      }),
    }
  );
}

// List existing trusted entities
export async function listTrustedEntities(): Promise<TrustedEntity[]> {
  const res = await paradymFetch<{ data: TrustedEntity[] }>(walletPath("/trusted-entities"));
  return res.data;
}