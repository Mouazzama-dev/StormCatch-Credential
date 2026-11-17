export const pickupOpenapi = {
  openapi: "3.0.3",
  info: {
    title: "Stormcatch pickup-service",
    version: "1.0.0",
    description: "Manned start of a delivery. Authorises the robot through the decision-service and, once loading is confirmed, asks the central server to issue the task token.",
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
        summary: "Authorise the robot and have the central server issue the task token",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["robotId", "items"],
            properties: {
              robotId: { type: "string", example: "urn:stormcatch:robot:SC-M1:SN-2026-000123" },
              to: { type: "string", example: "I-2", description: "Engine point id of the handover: I-2 (ward) by default, I-3 for the clean-room route" },
              items: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", required: ["name", "quantity"], properties: {
                code: { type: "string", example: "PARACETAMOL-500" },
                name: { type: "string", example: "Paracetamol 500 mg" },
                quantity: { type: "integer", minimum: 1, maximum: 1000, example: 20 },
              } } },
            },
          } } },
        },
        responses: {
          "200": { description: "Task token issued by the central server", content: { "application/json": { schema: {
            type: "object",
            properties: {
              token: { type: "string", description: "ES256 JWT, typ task+jwt: { iss, sub, aud, jti, iat, nbf, exp, cnf?, task }" },
              jti: { type: "string", format: "uuid" },
              task: { type: "object", additionalProperties: true },
            },
          } } } },
          "400": { description: "robotId and items are required, items malformed, or no route to the destination" },
          "403": { description: "Robot not authorised by the policy engine" },
          "502": { description: "decision-service or central server error or unreachable" },
        },
      },
    },
  },
} as const;
