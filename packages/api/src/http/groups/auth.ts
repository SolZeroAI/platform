import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { CommonErrors, NotFoundError } from "../errors"
import {
  ApiKeysResponse,
  AuthSessionResponse,
  CreatedApiKeyResponse,
  CreateApiKeyPayload,
  KeyIdParams,
} from "../schemas/auth"
import { DeletedApiKeyResponse } from "../schemas/common"
import { ControlPlaneAuth } from "../security"

export class AuthGroup extends HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.get("session", "/session", {
      success: AuthSessionResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Get authenticated session" })),
    HttpApiEndpoint.post("createApiKey", "/api-keys", {
      payload: CreateApiKeyPayload,
      success: CreatedApiKeyResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Create API key" })),
    HttpApiEndpoint.get("listApiKeys", "/api-keys", {
      success: ApiKeysResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List API keys" })),
    HttpApiEndpoint.delete("deleteApiKey", "/api-keys/:keyId", {
      params: KeyIdParams,
      success: DeletedApiKeyResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Delete API key" })),
  )
  .prefix("/auth")
  .middleware(ControlPlaneAuth) {}
