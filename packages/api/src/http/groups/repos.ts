import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { CommonErrors } from "../errors"
import {
  RepoMetadataPayload,
  RepoMetadataResponse,
  RepoParams,
  ReposListQuery,
  ReposListResponse,
} from "../schemas/repos"
import { ControlPlaneAuth } from "../security"

export class ReposGroup extends HttpApiGroup.make("repos")
  .add(
    HttpApiEndpoint.get("list", "/", {
      query: ReposListQuery,
      success: ReposListResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List repositories" })),
    HttpApiEndpoint.put("upsertMetadata", "/:owner/:name/metadata", {
      params: RepoParams,
      payload: RepoMetadataPayload,
      success: RepoMetadataResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Upsert repository metadata" })),
    HttpApiEndpoint.get("getMetadata", "/:owner/:name/metadata", {
      params: RepoParams,
      success: RepoMetadataResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Get repository metadata" })),
  )
  .prefix("/repos")
  .middleware(ControlPlaneAuth) {}
