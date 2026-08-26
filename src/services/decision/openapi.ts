export const decisionOpenapi = {
  openapi: "3.0.3",
  info: {
    title: "Stormcatch decision-service",
    version: "1.0.0",
    description: "Adapter between the gate and the policy engine. Turns a friendly { pointId, action, scope, validUntil } into the engine's full AuthorizeBody and forwards it, returning the allow/deny decision.",
  },
  servers: [{ url: "http://localhost:4003" }],
  paths: {
    "/health": {
      get: { summary: "Liveness check", responses: { "200": { description: "Service is up" } } },
    },
    "/decision": {
      post: {
        summary: "Evaluate a checkpoint decision",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["pointId"],
            properties: {
              pointId: { type: "string", example: "G-1" },
              action: { type: "string", example: "sc:zone_access" },
              scope: { type: "string", example: "1" },
              validUntil: { type: "integer", description: "Epoch seconds" },
            },
          } } },
        },
        responses: {
          "200": { description: "Decision", content: { "application/json": { schema: {
            type: "object",
            properties: {
              allowed: { type: "boolean" },
              decision: { type: "string", nullable: true, enum: ["permit", "deny", null] },
              determiningPolicies: { type: "array", items: { type: "string" } },
              layer1: { type: "object", additionalProperties: true },
              siteLists: { type: "object", additionalProperties: true },
              stages: {},
            },
          } } } },
          "400": { description: "pointId is required" },
          "502": { description: "Engine error or unreachable" },
        },
      },
    },
  },
} as const;
