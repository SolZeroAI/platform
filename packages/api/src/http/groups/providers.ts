import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { CommonErrors } from "../errors"
import { ProviderSettingsPayload, ProviderSettingsResponse } from "../schemas/providers"
import { ControlPlaneAuth } from "../security"

export class ProvidersGroup extends HttpApiGroup.make("providers")
  .add(
    HttpApiEndpoint.get("list", "/", {
      success: ProviderSettingsResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List provider settings" })),
    HttpApiEndpoint.put("replace", "/", {
      payload: ProviderSettingsPayload,
      success: ProviderSettingsResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Replace provider settings" })),
  )
  .prefix("/providers")
  .middleware(ControlPlaneAuth) {}
