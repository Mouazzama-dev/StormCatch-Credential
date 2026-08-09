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