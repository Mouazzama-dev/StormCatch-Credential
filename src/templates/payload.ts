import { paradymFetch, walletPath } from "../client.ts";

export interface CredentialTemplate {
  id: string;
  name: string;
  format: string;
  type: string;
  revocable: boolean;
  attributes: Record<string, unknown>;
  issuer: string;
  createdAt: string;
}

// Payload credential ki definition — ek jagah, taake SDK mein reuse ho
export const payloadTemplateDefinition = {
  name: "Stormcatch Payload Credential",
  description: "Proves an authorized payload is carried by an autonomous robot",
  issuer: "did:web",
  type: "StormcatchPayloadCredential",
  revocable: true,
  validFrom: new Date().toISOString().split("T")[0],
  validUntil: { start: "validFrom", future: { days: 1 } },
  background: { color: "#1a1a2e" },
  text: { color: "#ffffff" },
  attributes: {
    payload_type: {
      type: "string",
      name: "Payload type",
      description: "Type of payload carried by the robot (e.g. sc:medicine)",
      required: true,
      alwaysDisclosed: false,
    },
  },
} as const;

// SD-JWT VC credential template banao
export async function createPayloadTemplate(): Promise<CredentialTemplate> {
  return paradymFetch<CredentialTemplate>(
    walletPath("/templates/credentials/sd-jwt-vc"),
    {
      method: "POST",
      body: JSON.stringify(payloadTemplateDefinition),
    }
  );
}