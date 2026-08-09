import { paradymFetch, walletPath } from "../client.ts";
import { config } from "../config.ts";

export interface PresentationTemplate {
  id: string;
  name: string;
  createdAt: string;
  [key: string]: unknown;
}

// Create a presentation template that requests the payload credential
// and asks the wallet to disclose its payload_type attribute.
export async function createPayloadPresentationTemplate(): Promise<PresentationTemplate> {
  return paradymFetch<PresentationTemplate>(
    walletPath("/templates/presentations"),
    {
      method: "POST",
      body: JSON.stringify({
        name: "Stormcatch Payload Verification",
        description: "Verify that the robot carries an authorized payload",
        credentials: [
          {
            name: "Payload Credential",
            description: "Proof of authorized payload",
            format: "sd-jwt-vc",
            type: config.payloadType,
            trustedIssuers: [],
            attributes: {
              payload_type: {
                type: "string",
              },
            },
          },
        ],
      }),
    }
  );
}