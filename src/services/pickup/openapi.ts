const robotId = { type: "string", example: "urn:stormcatch:robot:SC-M1:SN-2026-000123" } as const;
const items = { type: "array", minItems: 1, maxItems: 20, items: { type: "object", required: ["name", "quantity"], properties: {
  code: { type: "string", example: "PARACETAMOL-500" },
  name: { type: "string", example: "Paracetamol 500 mg" },
  quantity: { type: "integer", minimum: 1, maximum: 1000, example: 20 },
} } } as const;

export const pickupOpenapi = {
  openapi: "3.0.3",
  info: {
    title: "Stormcatch pickup-service",
    version: "1.0.0",
    description: "Manned start of a delivery. Plans tasks ahead (the pharmacy summons a robot), checks the robot with the policy engine, and once loading is confirmed has the central server issue the token for the robot's planned task.",
  },
  servers: [{ url: "http://localhost:4005" }],
  paths: {
    "/health": {
      get: { summary: "Liveness check", responses: { "200": { description: "Service is up" } } },
    },
    "/pickup/tasks": {
      post: {
        summary: "Plan a task from this counter (the pharmacy summons a robot); forwarded to the central server",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["robotId", "to", "items"],
            properties: {
              robotId,
              to: { type: "string", example: "I-2", description: "Engine point id of the handover: I-2 (ward) or I-3 (clean-room ward)" },
              items,
            },
          } } },
        },
        responses: {
          "201": { description: "Task planned (the central server's task record)" },
          "400": { description: "Missing fields, malformed items, or no route to the destination" },
          "409": { description: "The robot already has a planned task" },
          "502": { description: "Central server unreachable or refused this desk's issuer token" },
        },
      },
    },
    "/pickup/tasks/{id}/cancel": {
      post: {
        summary: "Cancel a planned task; forwarded to the central server",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Task cancelled" },
          "404": { description: "No such task" },
          "409": { description: "Only a planned task can be cancelled" },
          "502": { description: "Central server unreachable or refused this desk's issuer token" },
        },
      },
    },
    "/pickup/check": {
      post: {
        summary: "Ask whether the robot may collect here, and which planned task it is here for; issues nothing",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["robotId"], properties: { robotId } } } },
        },
        responses: {
          "200": { description: "The engine's answer for this point and the robot's planned task", content: { "application/json": { schema: {
            type: "object",
            properties: {
              pointId: { type: "string", example: "I-1" },
              allowed: { type: "boolean" },
              decision: { type: "string", nullable: true },
              determiningPolicies: { type: "array", items: { type: "string" } },
              task: { type: "object", nullable: true, additionalProperties: true, description: "The robot's planned task record, or null" },
              taskError: { type: "string", description: "Set when the central server could not be asked" },
            },
          } } } },
          "400": { description: "robotId is required" },
          "502": { description: "decision-service error or unreachable" },
        },
      },
    },
    "/pickup": {
      post: {
        summary: "Loaded: authorise the robot and have the central server issue the token for its planned task",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["robotId", "taskId"],
            properties: {
              robotId,
              taskId: { type: "string", example: "task-3fe7df81-f76a-40ea-bdc3-a677daa97b03" },
              items: { ...items, description: "The items as actually loaded; omitted, the planned items are issued" },
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
          "400": { description: "robotId and taskId are required, or items malformed" },
          "403": { description: "Robot not authorised by the policy engine, or the task was planned for another robot" },
          "404": { description: "No such task" },
          "409": { description: "The task is not planned (already issued, received or cancelled)" },
          "502": { description: "decision-service or central server error or unreachable" },
        },
      },
    },
  },
} as const;
