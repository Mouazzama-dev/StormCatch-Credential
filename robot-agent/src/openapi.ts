const carriedSchema = {
  type: "object",
  properties: {
    taskId: { type: "string" },
    jti: { type: "string" },
    from: { type: "string", example: "I-1" },
    to: { type: "string", example: "I-2" },
    items: { type: "array", items: { type: "object" } },
    storedAt: { type: "string", format: "date-time" },
    expiresAt: { type: "string", format: "date-time" },
  },
} as const;

export const robotOpenapi = {
  openapi: "3.0.3",
  info: {
    title: "Stormcatch robot-service",
    version: "1.0.0",
    description: "Headless Credo holder. Receives credentials (accept) and presents them over OID4VP DCQL (present), with no phone wallet, and carries the delivery codes (task tokens) the central server issued for it. No authentication: keep it off shared networks (ROBOT_HOST=127.0.0.1).",
  },
  servers: [{ url: "http://localhost:4004" }],
  paths: {
    "/health": {
      get: { summary: "Liveness check, and which robot this is", responses: { "200": { description: "Service is up", content: { "application/json": { schema: {
        type: "object", properties: { ok: { type: "boolean" }, robotId: { type: "string", example: "urn:stormcatch:robot:SC-M1:SN-2026-000123" } },
      } } } } } },
    },
    "/deliveries": {
      post: {
        summary: "Carry a delivery code (the pharmacy desk hands it over when it sends the robot off)",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["token"], properties: { token: { type: "string", description: "The task token from POST /pickup" } } } } },
        },
        responses: {
          "201": { description: "Carried; carrying the same task again replaces its code", content: { "application/json": { schema: carriedSchema } } },
          "400": { description: "Not a task token (reason malformed)" },
          "409": { description: "Issued to another robot (reason not-this-robot), or expired (reason expired)" },
        },
      },
      get: {
        summary: "The delivery codes on board, newest first (a ward desk asks for its own when it scans the robot); expired ones are dropped",
        parameters: [{ name: "to", in: "query", required: false, schema: { type: "string", example: "I-2" }, description: "Only the codes for this ward" }],
        responses: {
          "200": { description: "The codes", content: { "application/json": { schema: {
            type: "object", properties: { robotId: { type: "string" }, deliveries: { type: "array", items: { ...carriedSchema, properties: { ...carriedSchema.properties, token: { type: "string" } } } } },
          } } } },
        },
      },
    },
    "/deliveries/{taskId}": {
      delete: {
        summary: "Drop a delivery code (the delivery was received, refused or recalled)",
        parameters: [{ name: "taskId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "dropped is false when the robot did not carry it", content: { "application/json": { schema: { type: "object", properties: { dropped: { type: "boolean" } } } } } } },
      },
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
