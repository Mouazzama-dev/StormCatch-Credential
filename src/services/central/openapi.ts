export const centralOpenapi = {
  openapi: "3.0.3",
  info: {
    title: "Stormcatch central-service",
    version: "1.0.0",
    description: "Issuer of task tokens (ES256 JWT, typ task+jwt). Mints a token when the pickup desk confirms a load, and revokes over MQTT when drop-off confirms receipt.",
  },
  servers: [{ url: "http://localhost:4007" }],
  paths: {
    "/health": {
      get: { summary: "Liveness check", responses: { "200": { description: "Service is up" } } },
    },
    "/tasks": {
      post: {
        summary: "Issue a task token (called by the pickup desk once loading is confirmed)",
        security: [{ issuerToken: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["robotId", "from", "to", "items"],
            properties: {
              robotId: { type: "string", example: "urn:stormcatch:robot:SC-M1:SN-2026-000123" },
              from: { type: "string", example: "I-1", description: "Engine point id; Martin's names (gate-pharmacy, gate-ward-3b) are mapped" },
              to: { type: "string", example: "I-2" },
              items: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", required: ["name", "quantity"], properties: {
                code: { type: "string", example: "PARACETAMOL-500" },
                name: { type: "string", example: "Paracetamol 500 mg" },
                quantity: { type: "integer", minimum: 1, maximum: 1000, example: 20 },
              } } },
              type: { type: "string", example: "medicine-delivery" },
              cnfThumbprint: { type: "string", description: "SHA-256 thumbprint of the robot's PIC certificate, carried as cnf.x5t#S256" },
              parentTaskId: { type: "string", nullable: true, description: "Set for a detour task" },
            },
          } } },
        },
        responses: {
          "200": { description: "Token issued", content: { "application/json": { schema: {
            type: "object",
            properties: {
              token: { type: "string", description: "ES256 JWT: { iss, sub, aud, jti, iat, nbf, exp, cnf?, task }" },
              jti: { type: "string", format: "uuid" },
              task: { type: "object", additionalProperties: true },
            },
          } } } },
          "400": { description: "Missing fields, malformed items, or no route between the points" },
          "401": { description: "Issuer token missing or wrong" },
        },
      },
    },
  },
  components: {
    securitySchemes: { issuerToken: { type: "http", scheme: "bearer", description: "The shared ISSUER_TOKEN" } },
  },
} as const;
