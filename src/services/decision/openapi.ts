export const decisionOpenapi = {
  openapi: "3.0.3",
  info: {
    title: "Stormcatch decision-service",
    version: "1.0.0",
    description: "Adapter between the gate and the policy engine. Turns a friendly { pointId, action, scope, validUntil } into the engine's full AuthorizeBody and forwards it, returning the allow/deny decision.",
  },
  servers: [{ url: "http://localhost:4003" }],
  paths: {
    "/health": {
      get: { summary: "Liveness check", responses: { "200": { description: "Service is up" } } },
    },
    "/decision": {
      post: {
        summary: "Evaluate a checkpoint decision",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["pointId"],
            properties: {
              pointId: { type: "string", example: "G-1" },
              action: { type: "string", example: "sc:zone_access" },
              scope: { type: "string", example: "1" },
              validUntil: { type: "integer", description: "Epoch seconds" },
              payload: {
                description: "What the robot carries. { token }: its task token, verified here (central server signature, issuer, time window), facts from its claims, issuer the pharmacy of its origin. \"none\": nothing. { held }: what it carries per the central server's record. Absent: the baseline stand-in (empty at I-1, medicine I-1>I-2 elsewhere). A token that does not verify counts as no payload.",
                oneOf: [
                  { type: "object", required: ["token"], properties: { token: { type: "string" } } },
                  { type: "string", enum: ["none"] },
                  { type: "object", required: ["held"], properties: { held: { type: "object", required: ["origin", "destination", "expiresAt"], properties: { payloadType: { type: "string", example: "sc:medicine" }, origin: { type: "string", example: "I-1" }, destination: { type: "string", example: "I-2" }, expiresAt: { type: "integer", description: "Epoch seconds" } } } } },
                ],
              },
              deliverTo: { type: "string", example: "I-2", description: "At the pickup desk: the desk the payload is sent to (engine Task deliverTo)" },
              handoverAnswer: { type: "string", enum: ["sc:accepted", "sc:refused"], description: "At a drop-off desk: the person's answer" },
              refusalReason: { type: "string", enum: ["sc:wrong_item", "sc:damaged", "sc:not_expected", "sc:late"], description: "Only with handoverAnswer sc:refused" },
            },
          } } },
        },
        responses: {
          "200": { description: "Decision", content: { "application/json": { schema: {
            type: "object",
            properties: {
              allowed: { type: "boolean" },
              decision: { type: "string", nullable: true, enum: ["permit", "deny", null] },
              determiningPolicies: { type: "array", items: { type: "string" } },
              payload: { type: "string", description: "Where the payload facts came from: token, none, held, baseline, or invalid-token:<reason>" },
              layer1: { type: "object", additionalProperties: true },
              siteLists: { type: "object", additionalProperties: true },
              stages: {},
            },
          } } } },
          "400": { description: "pointId is required; payload or a desk field malformed" },
          "502": { description: "Engine error or unreachable" },
        },
      },
    },
  },
} as const;
