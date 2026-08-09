import { paradymFetch, walletPath } from "../client.ts";

export interface Did {
  id: string;
  did: string;
  network: string;
  method: string;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse<T> {
  data: T[];
}

// Wallet ke saare DIDs list karo
export async function listDids(): Promise<Did[]> {
  const res = await paradymFetch<ListResponse<Did>>(walletPath("/dids"));
  return res.data;
}

// Issuer DID resolve karo — .env ke PARADYM_DID_ID se, aur confirm karo ke maujood hai
export async function getIssuerDid(didId: string): Promise<Did> {
  const dids = await listDids();
  const found = dids.find((d) => d.id === didId);
  if (!found) {
    throw new Error(
      `DID with id "${didId}" not found in wallet. ` +
      `Available: ${dids.map((d) => d.id).join(", ") || "(none)"}`
    );
  }
  return found;
}