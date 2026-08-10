import { paradymFetch, walletPath } from "../client.ts";

export interface CredentialTemplate {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

// TaskAuthorizationCredential: grants a robot permission to perform an
// action within a scope (e.g. sc:zone_access at scope 2).
export const taskAuthTemplateDefinition = {
  name: "Stormcatch Task Authorization",
  description: "Grants a robot permission for an action within a given scope",
  issuer: "did:web",
  type: "StormcatchTaskAuthorization",
  revocable: true,
  validFrom: new Date().toISOString().split("T")[0],
  validUntil: { start: "validFrom", future: { days: 1 } },
  background: { color: "#0f2a1a" },
  text: { color: "#ffffff" },
  attributes: {
    action: {
      type: "string",
      name: "Action",
      description: "The permitted action (e.g. sc:zone_access)",
      required: true,
      alwaysDisclosed: false,
    },
    scope: {
      type: "string",
      name: "Scope",
      description: "Facility-defined scope for the action (e.g. zone \"1\", \"2\", \"3\")",
      required: true,
      alwaysDisclosed: false,
    },
  },
} as const;

export async function createTaskAuthTemplate(): Promise<CredentialTemplate> {
  return paradymFetch<CredentialTemplate>(
    walletPath("/templates/credentials/sd-jwt-vc"),
    {
      method: "POST",
      body: JSON.stringify(taskAuthTemplateDefinition),
    }
  );
}