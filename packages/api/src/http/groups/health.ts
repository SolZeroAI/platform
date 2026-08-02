import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import { HealthResponse } from "../schemas/health"

export class HealthGroup extends HttpApiGroup.make("health", { topLevel: true }).add(
  HttpApiEndpoint.get("get", "/health", {
    success: HealthResponse,
  }),
  HttpApiEndpoint.head("head", "/health", {
    success: HttpApiSchema.NoContent,
  }),
) {}
