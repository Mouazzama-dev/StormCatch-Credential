import { paradymFetch, walletPath } from "../client.ts";
import { config } from "../config.ts";

// Issue a TaskAuthorization credential with a given action + scope
export async function issueTaskAuth(action: string, scope: string) {
  return paradymFetch<{ id: string; offerUri: string }>(
    walletPath("/openid4vc/issuance/offer"),
    {
      method: "POST",
      body: JSON.stringify({
        credentials: [
          {
            credentialTemplateId: config.taskAuthTemplateId,
            attributes: { action, scope },
          },
        ],
      }),
    }
  );
}

// Create a presentation template that requests the task-auth credential,
// optionally requiring an exact scope value (gate policy).
export async function createTaskAuthPresentationTemplate(requiredScope?: string) {
  const scopeAttr =
    requiredScope !== undefined
      ? { type: "string", value: requiredScope }
      : { type: "string" };

  return paradymFetch<{ id: string }>(
    walletPath("/templates/presentations"),
    {
      method: "POST",
      body: JSON.stringify({
        name: `Stormcatch Zone Access (scope ${requiredScope ?? "any"})`,
        description: "Verify the robot is authorized for zone access",
        credentials: [
          {
            name: "Task Authorization",
            format: "sd-jwt-vc",
            type: config.taskAuthType,
            trustedIssuers: config.trustedEntityId ? [config.trustedEntityId] : [],
            attributes: {
              action: { type: "string" },
              scope: scopeAttr,
            },
          },
        ],
      }),
    }
  );
}