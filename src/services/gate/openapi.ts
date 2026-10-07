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
    "/request/{uuid}": {
      get: {
        summary: "Resolve a request uuid read off the e-paper",
        description:
          "The reader decodes <invitation>/<request> from the QR and resolves the request uuid " +
          "(case-insensitive) to the session and the exact authorization request URI, client_id included.",
        parameters: [{ name: "uuid", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Session found", content: { "application/json": { schema: {
            type: "object",
            properties: {
              sessionId: { type: "string" },
              gate: { type: "string", enum: ["G-1", "G-2"] },
              authorizationRequestUri: { type: "string" },
            },
          } } } },
          "404": { description: "Unknown request uuid" },
        },
      },
    },
    "/webhook": {
      post: {
        summary: "Paradym verification events (internal)",
        description:
          "Register this URL (via the tunnel) in the gate wallet. With WEBHOOK_TOKEN set the live " +
          "path is /webhook/<token>; the bare path stays LAN-only. Not called by clients.",
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
