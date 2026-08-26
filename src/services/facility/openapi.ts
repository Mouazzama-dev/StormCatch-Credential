export const facilityOpenapi = {
  openapi: "3.0.3",
  info: {
    title: "Stormcatch facility-service",
    version: "1.0.0",
    description: "Issuer side of the credential lifecycle: issues and revokes TaskAuthorization credentials.",
  },
  servers: [{ url: "http://localhost:4001" }],
  paths: {
    "/health": {
      get: { summary: "Liveness check", responses: { "200": { description: "Service is up" } } },
    },
    "/issue": {
      post: {
        summary: "Issue a TaskAuthorization credential",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["action", "scope"],
            properties: {
              action: { type: "string", example: "sc:zone_access" },
              scope: { type: "string", example: "1" },
            },
          } } },
        },
        responses: {
          "200": { description: "Offer created", content: { "application/json": { schema: {
            type: "object",
            properties: { issuanceId: { type: "string" }, offerUri: { type: "string" } },
          } } } },
          "400": { description: "action and scope are required" },
          "502": { description: "Paradym error" },
        },
      },
    },
    "/issuance/{id}": {
      get: {
        summary: "Poll issuance status",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Current status", content: { "application/json": { schema: {
            type: "object",
            properties: {
              issuanceId: { type: "string" },
              status: { type: "string", example: "completed" },
              credentialId: { type: "string", nullable: true },
            },
          } } } },
          "502": { description: "Paradym error" },
        },
      },
    },
    "/revoke": {
      post: {
        summary: "Revoke issued credentials",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["credentialIds"],
            properties: {
              credentialIds: { type: "array", items: { type: "string" } },
              notifyWallet: { type: "boolean", default: true },
            },
          } } },
        },
        responses: {
          "200": { description: "Revoked", content: { "application/json": { schema: {
            type: "object", properties: { revoked: { type: "array", items: { type: "string" } } },
          } } } },
          "400": { description: "credentialIds (non-empty array) is required" },
          "502": { description: "Paradym error" },
        },
      },
    },
  },
} as const;
