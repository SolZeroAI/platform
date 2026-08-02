import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { CommonErrors, NotFoundError } from "../errors"
import {
  CreatedWorkflowResponse,
  CreatedWorkflowRunResponse,
  DeletedWorkflowRunResponse,
  DeletedWorkflowResponse,
  RunWorkflowPayload,
  UpdateWorkflowNamePayload,
  UpsertWorkflowPayload,
  WorkflowBuilderDraftQuery,
  WorkflowBuilderDraftResponse,
  WorkflowCatalogResponse,
  WorkflowIdParams,
  WorkflowListQuery,
  WorkflowListResponse,
  WorkflowRunArtifactContentResponse,
  WorkflowRunArtifactParams,
  WorkflowApprovalPayload,
  WorkflowApprovalResponse,
  WorkflowResponse,
  WorkflowRunEventsResponse,
  WorkflowRunListQuery,
  WorkflowRunParams,
  WorkflowRunResponse,
  WorkflowRunsResponse,
  WorkflowRunsStreamQuery,
  WorkflowSlackAppCredentialsPayload,
  WorkflowSlackAppResponse,
} from "../schemas/workflows"
import { ControlPlaneAuth } from "../security"

export class WorkflowsGroup extends HttpApiGroup.make("workflows")
  .add(
    HttpApiEndpoint.get("catalog", "/catalog", {
      success: WorkflowCatalogResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List workflow node definitions" })),
    HttpApiEndpoint.get("list", "/", {
      query: WorkflowListQuery,
      success: WorkflowListResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List workflows" })),
    HttpApiEndpoint.post("create", "/", {
      payload: UpsertWorkflowPayload,
      success: CreatedWorkflowResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Create workflow" })),
    HttpApiEndpoint.get("builderDraftLatest", "/builder/drafts/latest", {
      query: WorkflowBuilderDraftQuery,
      success: WorkflowBuilderDraftResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Get latest workflow builder draft" })),
    HttpApiEndpoint.get("export", "/:id/export", {
      params: WorkflowIdParams,
      success: Schema.String,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Export workflow as YAML" })),
    HttpApiEndpoint.get("get", "/:id", {
      params: WorkflowIdParams,
      success: WorkflowResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Get workflow" })),
    HttpApiEndpoint.put("update", "/:id", {
      params: WorkflowIdParams,
      payload: UpsertWorkflowPayload,
      success: WorkflowResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Update workflow" })),
    HttpApiEndpoint.patch("updateName", "/:id/name", {
      params: WorkflowIdParams,
      payload: UpdateWorkflowNamePayload,
      success: WorkflowResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Update workflow name" })),
    HttpApiEndpoint.post("disable", "/:id/disable", {
      params: WorkflowIdParams,
      success: WorkflowResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Disable workflow" })),
    HttpApiEndpoint.post("enable", "/:id/enable", {
      params: WorkflowIdParams,
      success: WorkflowResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Enable workflow" })),
    HttpApiEndpoint.get("slackApp", "/:id/slack-app", {
      params: WorkflowIdParams,
      success: WorkflowSlackAppResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Get workflow Slack app setup" })),
    HttpApiEndpoint.put("slackAppCredentials", "/:id/slack-app/credentials", {
      params: WorkflowIdParams,
      payload: WorkflowSlackAppCredentialsPayload,
      success: WorkflowSlackAppResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Update workflow Slack app credentials" })),
    HttpApiEndpoint.delete("delete", "/:id", {
      params: WorkflowIdParams,
      success: DeletedWorkflowResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Archive workflow" })),
    HttpApiEndpoint.post("run", "/:id/runs", {
      params: WorkflowIdParams,
      payload: RunWorkflowPayload,
      success: CreatedWorkflowRunResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Run workflow" })),
    HttpApiEndpoint.get("getRun", "/:id/runs/:runId", {
      params: WorkflowRunParams,
      success: WorkflowRunResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Get workflow run" })),
    HttpApiEndpoint.delete("deleteRun", "/:id/runs/:runId", {
      params: WorkflowRunParams,
      success: DeletedWorkflowRunResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Delete workflow run" })),
    HttpApiEndpoint.get("runs", "/:id/runs", {
      params: WorkflowIdParams,
      query: WorkflowRunListQuery,
      success: WorkflowRunsResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "List workflow runs" })),
    HttpApiEndpoint.get("runEvents", "/:id/runs/:runId/events", {
      params: WorkflowRunParams,
      success: WorkflowRunEventsResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "List workflow run events" })),
    HttpApiEndpoint.get("runArtifactContent", "/:id/runs/:runId/artifacts/:nodeId", {
      params: WorkflowRunArtifactParams,
      success: WorkflowRunArtifactContentResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Get workflow run artifact content" })),
    HttpApiEndpoint.post("approveRun", "/:id/runs/:runId/approval", {
      params: WorkflowRunParams,
      payload: WorkflowApprovalPayload,
      success: WorkflowApprovalResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Approve or reject a workflow run" })),
    HttpApiEndpoint.get("runEventsStream", "/:id/events/stream", {
      params: WorkflowIdParams,
      query: WorkflowRunsStreamQuery,
      success: WorkflowRunEventsResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Stream workflow run updates" })),
  )
  .prefix("/workflows")
  .middleware(ControlPlaneAuth) {}
