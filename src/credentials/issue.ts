import { paradymFetch, walletPath } from "../client.ts";
import { config } from "../config.ts";

export interface IssuanceOffer {
  id: string;
  offerUri: string;
  [key: string]: unknown;
}

// Payload credential ka OID4VCI offer banao
export async function issuePayload(payloadType: string): Promise<IssuanceOffer> {
  return paradymFetch<IssuanceOffer>(
    walletPath("/openid4vc/issuance/offer"),
    {
      method: "POST",
      body: JSON.stringify({
        credentials: [
          {
            credentialTemplateId: config.payloadTemplateId,
            attributes: {
              payload_type: payloadType,
            },
          },
        ],
      }),
    }
  );
}

export interface IssuanceSession {
  id: string;
  status: string;
  credentials: Array<{
    id: string;
    status: string;
    revocable: boolean;
  }>;
}

// Look up an issuance session and return the issued credential's id
export async function getIssuedCredentialId(sessionId: string): Promise<string> {
  const session = await paradymFetch<IssuanceSession>(
    walletPath(`/openid4vc/issuance/${sessionId}`)
  );
  const credential = session.credentials?.[0];
  if (!credential) {
    throw new Error(`No credential found in issuance session ${sessionId}`);
  }
  return credential.id;
}