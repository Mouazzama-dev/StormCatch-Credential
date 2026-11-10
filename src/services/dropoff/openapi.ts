export const dropoffOpenapi = {
  openapi: "3.0.3",
  info: {
    title: "Stormcatch dropoff-service",
    version: "1.0.0",
    description: "Manned end of a delivery. Verifies the payload token, authorises the robot through the decision-service, then has the issuer (pickup) revoke the token over MQTT so the payload cannot be handed over twice. Answers received only once pickup confirms the revoke.",
  },
  servers: [{ url: "http://localhost:4006" }],
  paths: {
    "/health": {
      get: { summary: "Liveness check", responses: { "200": { description: "Service is up" } } },
    },
    "/dropoff/check": {
      post: {
        summary: "Show what the robot carries and whether it may hand it over here; revokes nothing",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["robotId", "token"],
            properties: {
              robotId: { type: "string", example: "urn:stormcatch:robot:SC-M1:SN-2026-000123" },
              token: { type: "string", description: "The payload token from POST /pickup" },
            },
          } } },
        },
        responses: {
          "200": { description: "Token valid for this robot at this point", content: { "application/json": { schema: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["valid"] },
              jti: { type: "string", format: "uuid" },
              payloadType: { type: "string" },
              contents: { type: "array", items: { type: "string" } },
              issuedAt: { type: "integer", description: "Epoch seconds" },
              expiresAt: { type: "integer", description: "Epoch seconds" },
            },
          } } } },
          "400": { description: "robotId and token are required" },
          "401": { description: "Token malformed, wrongly signed or expired (reason in body)" },
          "403": { description: "Token issued to another robot, or robot not authorised by the policy engine" },
          "409": { description: "Token already received (blacklisted)" },
          "502": { description: "decision-service error or unreachable" },
        },
      },
    },
    "/dropoff": {
      post: {
        summary: "Verify the payload token, authorise the robot and record receipt",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["robotId", "token"],
            properties: {
              robotId: { type: "string", example: "urn:stormcatch:robot:SC-M1:SN-2026-000123" },
              token: { type: "string", description: "The payload token from POST /pickup" },
            },
          } } },
        },
        responses: {
          "200": { description: "Payload received, revoke confirmed by pickup", content: { "application/json": { schema: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["received"] },
              jti: { type: "string", format: "uuid" },
              payloadType: { type: "string" },
              contents: { type: "array", items: { type: "string" } },
              issuedAt: { type: "integer", description: "Epoch seconds" },
              expiresAt: { type: "integer", description: "Epoch seconds" },
            },
          } } } },
          "400": { description: "robotId and token are required" },
          "401": { description: "Token malformed, wrongly signed or expired (reason in body)" },
          "403": { description: "Token issued to another robot, or robot not authorised by the policy engine" },
          "409": { description: "Token already received (blacklisted)" },
          "502": { description: "decision-service error or unreachable" },
          "504": { description: "Pickup did not confirm the revoke in time; the token is still live and the drop-off can be retried" },
        },
      },
    },
  },
} as const;
