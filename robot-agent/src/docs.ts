import type { Express } from "express";
import swaggerUi from "swagger-ui-express";

// Mounts the OpenAPI document at GET /openapi.json and Swagger UI at GET /docs.
export function mountDocs(app: Express, spec: object): void {
  app.get("/openapi.json", (_req, res) => res.json(spec));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: "Stormcatch API docs" }));
}
