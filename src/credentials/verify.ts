import { paradymFetch, walletPath } from "../client.ts";
import { config } from "../config.ts";

export interface VerificationRequest {
  id: string;
  authorizationRequestUri?: string;
  verificationSessionUri?: string;
  [key: string]: unknown;
}

// Create an OID4VP verification request from the presentation template.
// Returns a session id and a URL the wallet scans to present the credential.
export async function requestVerification(): Promise<VerificationRequest> {
  return paradymFetch<VerificationRequest>(
    walletPath("/openid4vc/verification/request"),
    {
      method: "POST",
      body: JSON.stringify({
        presentationTemplateId: config.presentationTemplateId,
      }),
    }
  );
}