import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { CommonErrors, NotFoundError } from "../errors"
import {
  GlobalSecretDeletedResponse,
  GlobalSecretsListQuery,
  GlobalSecretsResponse,
  GlobalSecretsSetResponse,
  GlobalSecretTagsResponse,
  SecretKeyParams,
  SecretsPayload,
} from "../schemas/secrets"
import { ControlPlaneAuth } from "../security"

export class SecretsGroup extends HttpApiGroup.make("secrets")
  .add(
    HttpApiEndpoint.put("set", "/", {
      payload: SecretsPayload,
      success: GlobalSecretsSetResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Set global secrets" })),
    HttpApiEndpoint.get("list", "/", {
      query: GlobalSecretsListQuery,
      success: GlobalSecretsResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List global secrets" })),
    HttpApiEndpoint.get("tags", "/tags", {
      success: GlobalSecretTagsResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List global secret tags" })),
    HttpApiEndpoint.delete("delete", "/:key", {
      params: SecretKeyParams,
      success: GlobalSecretDeletedResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Delete global secret" })),
  )
  .prefix("/secrets")
  .middleware(ControlPlaneAuth) {}
