import { paradymFetch, walletPath } from "../client.ts";
import { config } from "../config.ts";

// Issue a TaskAuthorization credential with a given action + scope
export async function issueTaskAuth(action: string, scope: number) {
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
// optionally requiring scope to be at least `minScope` (gate policy).
export async function createTaskAuthPresentationTemplate(minScope?: number) {
  const scopeAttr =
    minScope !== undefined
      ? { type: "number", minimum: minScope }
      : { type: "number" };

  return paradymFetch<{ id: string }>(
    walletPath("/templates/presentations"),
    {
      method: "POST",
      body: JSON.stringify({
        name: `Stormcatch Zone Access (min scope ${minScope ?? "any"})`,
        description: "Verify the robot is authorized for zone access",
        credentials: [
          {
            name: "Task Authorization",
            format: "sd-jwt-vc",
            type: config.taskAuthType,
            trustedIssuers: [],
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