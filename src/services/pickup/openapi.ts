export const pickupOpenapi = {
  openapi: "3.0.3",
  info: {
    title: "Stormcatch pickup-service",
    version: "1.0.0",
    description: "Manned start of a delivery. Authorises the robot through the decision-service and issues the payload as a signed token (ES256 JWT for the pilot).",
  },
  servers: [{ url: "http://localhost:4005" }],
  paths: {
    "/health": {
      get: { summary: "Liveness check", responses: { "200": { description: "Service is up" } } },
    },
    "/pickup/check": {
      post: {
        summary: "Ask whether the robot may collect here; issues nothing",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["robotId"],
            properties: { robotId: { type: "string", example: "urn:stormcatch:robot:SC-M1:SN-2026-000123" } },
          } } },
        },
        responses: {
          "200": { description: "The engine's answer for this point", content: { "application/json": { schema: {
            type: "object",
            properties: {
              pointId: { type: "string", example: "I-1" },
              allowed: { type: "boolean" },
              decision: { type: "string", nullable: true },
              determiningPolicies: { type: "array", items: { type: "string" } },
            },
          } } } },
          "400": { description: "robotId is required" },
          "502": { description: "decision-service error or unreachable" },
        },
      },
    },
    "/pickup": {
      post: {
        summary: "Authorise the robot and issue the payload token",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["robotId", "payloadType"],
            properties: {
              robotId: { type: "string", example: "urn:stormcatch:robot:SC-M1:SN-2026-000123" },
              payloadType: { type: "string", example: "sc:medicine" },
              contents: { type: "array", maxItems: 20, items: { type: "string", minLength: 1 }, example: ["Paracetamol 500 mg x 20"], description: "What was loaded; carried in the token as the contents claim" },
            },
          } } },
        },
        responses: {
          "200": { description: "Payload token issued", content: { "application/json": { schema: {
            type: "object",
            properties: {
              token: { type: "string", description: "ES256 JWT: { jti, payload_type, contents?, sub: robotId, iat, exp }" },
              jti: { type: "string", format: "uuid" },
            },
          } } } },
          "400": { description: "robotId and payloadType are required, contents malformed" },
          "403": { description: "Robot not authorised by the policy engine" },
          "502": { description: "decision-service error or unreachable" },
        },
      },
    },
  },
} as const;
