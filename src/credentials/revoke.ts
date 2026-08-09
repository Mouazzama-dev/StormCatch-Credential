import { paradymFetch, walletPath } from "../client.ts";

// Revoke one or more issued credentials via the batch revocation endpoint.
// notifyWallet=true sends a revocation notification to the holder (the robot).
export async function revokeCredentials(
  issuedCredentialIds: string[],
  notifyWallet = true
): Promise<void> {
  await paradymFetch(walletPath("/revocation/batch"), {
    method: "POST",
    body: JSON.stringify({
      issuedCredentialIds,
      notifyWallet,
    }),
  });
}