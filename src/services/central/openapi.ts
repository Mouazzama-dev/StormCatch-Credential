const robotId = { type: "string", example: "urn:stormcatch:robot:SC-M1:SN-2026-000123" } as const;
const items = { type: "array", minItems: 1, maxItems: 20, items: { type: "object", required: ["name", "quantity"], properties: {
  code: { type: "string", example: "PARACETAMOL-500" },
  name: { type: "string", example: "Paracetamol 500 mg" },
  quantity: { type: "integer", minimum: 1, maximum: 1000, example: 20 },
} } } as const;
const taskRecord = { type: "object", description: "{ robotId, status: planned | issued | received | cancelled | recalled, task, jti?, createdAt, updatedAt }", additionalProperties: true } as const;
const idParam = [{ name: "id", in: "path", required: true, schema: { type: "string" } }] as const;

export const centralOpenapi = {
  openapi: "3.0.3",
  info: {
    title: "Stormcatch central-service",
    version: "1.0.0",
    description: "Issuer of task tokens (ES256 JWT, typ task+jwt) and the record of tasks and activity. Tasks are planned ahead, issued when the pickup desk confirms the load, and revoked over MQTT when drop-off confirms receipt.",
  },
  servers: [{ url: "http://localhost:4007" }],
  paths: {
    "/health": {
      get: { summary: "Liveness check", responses: { "200": { description: "Service is up" } } },
    },
    "/tasks": {
      post: {
        summary: "Plan a task (the pharmacy summons a robot); issues nothing",
        security: [{ issuerToken: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["robotId", "from", "to", "items"],
            properties: {
              robotId,
              from: { type: "string", example: "I-1", description: "Engine point id; Martin's names (gate-pharmacy, gate-ward-3b) are mapped" },
              to: { type: "string", example: "I-2" },
              items,
              type: { type: "string", example: "medicine-delivery" },
              parentTaskId: { type: "string", nullable: true, description: "Set for a detour task" },
            },
          } } },
        },
        responses: {
          "201": { description: "Task planned", content: { "application/json": { schema: taskRecord } } },
          "400": { description: "Missing fields, malformed items, or no route between the points" },
          "401": { description: "Issuer token missing or wrong" },
          "409": { description: "The robot already has a planned task" },
        },
      },
      get: {
        summary: "List tasks, newest first",
        parameters: [
          { name: "robotId", in: "query", required: false, schema: { type: "string" } },
          { name: "status", in: "query", required: false, schema: { type: "string", enum: ["planned", "issued", "received", "cancelled", "recalled"] } },
        ],
        responses: { "200": { description: "Task records", content: { "application/json": { schema: { type: "array", items: taskRecord } } } } },
      },
    },
    "/tasks/{id}": {
      get: {
        summary: "One task with its activity timeline",
        parameters: idParam,
        responses: { "200": { description: "Task record plus activity[]" }, "404": { description: "No such task" } },
      },
    },
    "/tasks/{id}/issue": {
      post: {
        summary: "Issue the task token for a planned task (called by the pickup desk once loading is confirmed)",
        security: [{ issuerToken: [] }],
        parameters: idParam,
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["robotId"],
            properties: {
              robotId,
              items: { ...items, description: "The items as actually loaded; replaces the planned ones" },
              cnfThumbprint: { type: "string", description: "SHA-256 thumbprint of the robot's PIC certificate, carried as cnf.x5t#S256" },
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
          "400": { description: "Malformed items" },
          "401": { description: "Issuer token missing or wrong" },
          "403": { description: "The task was planned for another robot" },
          "404": { description: "No such task" },
          "409": { description: "The task is not planned (already issued, received or cancelled)" },
        },
      },
    },
    "/tasks/{id}/recall": {
      post: {
        summary: "Recall a delivery that is on its way: its token is revoked, no ward can accept it any more",
        security: [{ issuerToken: [] }],
        parameters: idParam,
        requestBody: {
          required: false,
          content: { "application/json": { schema: { type: "object", properties: { reason: { type: "string", example: "robot broke down" } } } } },
        },
        responses: {
          "200": { description: "Delivery recalled", content: { "application/json": { schema: taskRecord } } },
          "401": { description: "Issuer token missing or wrong" },
          "404": { description: "No such task" },
          "409": { description: "Only a delivery on its way (issued) can be recalled" },
        },
      },
    },
    "/tasks/{id}/cancel": {
      post: {
        summary: "Cancel a planned task",
        security: [{ issuerToken: [] }],
        parameters: idParam,
        responses: {
          "200": { description: "Task cancelled", content: { "application/json": { schema: taskRecord } } },
          "401": { description: "Issuer token missing or wrong" },
          "404": { description: "No such task" },
          "409": { description: "Only a planned task can be cancelled" },
        },
      },
    },
    "/activity": {
      get: {
        summary: "The activity feed, newest first",
        parameters: [
          { name: "robotId", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
        ],
        responses: { "200": { description: "Events: { at, event, taskId?, robotId?, point?, outcome?, detail? }" } },
      },
      post: {
        summary: "Report a desk event (pickup.* or dropoff.*)",
        security: [{ deskToken: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["event"],
            properties: {
              event: { type: "string", example: "dropoff.check" },
              taskId: { type: "string" },
              robotId: { type: "string" },
              point: { type: "string", example: "I-2" },
              outcome: { type: "string", enum: ["ok", "refused"] },
              detail: { type: "string" },
            },
          } } },
        },
        responses: { "204": { description: "Recorded" }, "400": { description: "Not a desk event" }, "401": { description: "Desk token missing or wrong" } },
      },
    },
  },
  components: {
    securitySchemes: {
      issuerToken: { type: "http", scheme: "bearer", description: "The shared ISSUER_TOKEN (the pickup desk)" },
      deskToken: { type: "http", scheme: "bearer", description: "The shared DESK_TOKEN (both desks), for reporting events" },
    },
  },
} as const;
