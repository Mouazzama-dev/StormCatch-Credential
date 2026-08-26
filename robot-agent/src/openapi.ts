export const robotOpenapi = {
  openapi: "3.0.3",
  info: {
    title: "Stormcatch robot-service",
    version: "1.0.0",
    description: "Headless Credo holder. Receives credentials (accept) and presents them over OID4VP DCQL (present), with no phone wallet.",
  },
  servers: [{ url: "http://localhost:4004" }],
  paths: {
    "/health": {
      get: { summary: "Liveness check", responses: { "200": { description: "Service is up" } } },
    },
    "/reset": {
      post: {
        summary: "Clear all stored credentials",
        responses: {
          "200": { description: "Cleared", content: { "application/json": { schema: {
            type: "object", properties: { ok: { type: "boolean" }, cleared: { type: "integer" } },
          } } } },
          "500": { description: "Agent error" },
        },
      },
    },
    "/accept": {
      post: {
        summary: "Accept a credential offer (headless)",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["offerUri"],
            properties: { offerUri: { type: "string" }, txCode: { type: "string" } },
          } } },
        },
        responses: {
          "200": { description: "Stored", content: { "application/json": { schema: {
            type: "object", properties: { ok: { type: "boolean" }, stored: { type: "integer" } },
          } } } },
          "400": { description: "offerUri required" },
          "500": { description: "Agent error" },
        },
      },
    },
    "/present": {
      post: {
        summary: "Present against an OID4VP request (DCQL)",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["requestUri"],
            properties: { requestUri: { type: "string" } },
          } } },
        },
        responses: {
          "200": { description: "Presented", content: { "application/json": { schema: {
            type: "object", properties: { ok: { type: "boolean" }, serverStatus: { type: "integer" } },
          } } } },
          "400": { description: "requestUri required" },
          "500": { description: "Agent error" },
        },
      },
    },
  },
} as const;
