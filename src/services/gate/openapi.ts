export const gateOpenapi = {
  openapi: "3.0.3",
  info: {
    title: "Stormcatch gate-service",
    version: "1.0.0",
    description: "Verifier (checkpoint): starts a presentation request, receives the Paradym webhook, and delegates the allow/deny decision to the policy engine via the decision-service.",
  },
  servers: [{ url: "http://localhost:4002" }],
  paths: {
    "/health": {
      get: { summary: "Liveness check", responses: { "200": { description: "Service is up" } } },
    },
    "/verify": {
      post: {
        summary: "Start a verification at a gate",
        requestBody: {
          content: { "application/json": { schema: {
            type: "object",
            properties: { gate: { type: "string", example: "G-1", default: "G-1" } },
          } } },
        },
        responses: {
          "200": { description: "Presentation request created", content: { "application/json": { schema: {
            type: "object",
            properties: {
              sessionId: { type: "string" },
              gate: { type: "string" },
              authorizationRequestUri: { type: "string" },
            },
          } } } },
          "400": { description: "No presentation template configured for that gate" },
          "502": { description: "Paradym error" },
        },
      },
    },
    "/webhook": {
      post: {
        summary: "Paradym verification events (internal)",
        description: "Register this URL (via ngrok) in the gate wallet. Not called by clients.",
        responses: { "200": { description: "Received" } },
      },
    },
    "/result/{id}": {
      get: {
        summary: "Poll a verification outcome",
        description: "No presentation within the timeout is treated as denied.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Outcome", content: { "application/json": { schema: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["pending", "allowed", "denied"] },
              reason: { type: "string" },
              determiningPolicies: { type: "array", items: { type: "string" } },
              attributes: { type: "object", additionalProperties: true },
            },
          } } } },
          "404": { description: "Unknown session" },
        },
      },
    },
  },
} as const;
