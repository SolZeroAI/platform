import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { CommonErrors, NotFoundError } from "../errors"
import {
  AdminActionPayload,
  AdminActionResponse,
  AdminAccessResponse,
  AdminAiSearchExportResponse,
  AdminAiSearchResponse,
  AdminAiSearchSourcePayload,
  AdminAiProvidersResponse,
  AdminCloudflareAiGatewayProviderKeysPayload,
  AdminGitHubAccountCleanupPreviewResponse,
  AdminGitHubAccountCleanupResponse,
  AdminIdParams,
  AdminLitellmConfigPayload,
  AdminLitellmExportResponse,
  AdminLitellmSyncResponse,
  AdminListQuery,
  AdminMcpcfConfigPayload,
  AdminMcpcfExportResponse,
  AdminMcpcfRefreshResponse,
  AdminMcpcfResponse,
  AdminRunWorkflowPayload,
  AdminSummaryResponse,
  AdminWorkflowListQuery,
  AdminSessionDetailResponse,
  AdminSessionListResponse,
  AdminWorkflowListResponse,
  AdminWorkflowRunEventsResponse,
  AdminWorkflowRunParams,
  AdminWorkflowRunsResponse,
} from "../schemas/admin"
import {
  AdminAgentSkillCreatePayload,
  AdminAgentSkillDefaultPayload,
  AdminAgentSkillsResponse,
} from "../schemas/skills"
import { ControlPlaneAuth } from "../security"

export class AdminGroup extends HttpApiGroup.make("admin")
  .add(
    HttpApiEndpoint.get("summary", "/summary", {
      success: AdminSummaryResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Get admin operations summary" })),
    HttpApiEndpoint.get("access", "/access", {
      success: AdminAccessResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Get current admin access status" })),
    HttpApiEndpoint.get("sessions", "/sessions", {
      query: AdminListQuery,
      success: AdminSessionListResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List all sessions for admins" })),
    HttpApiEndpoint.get("session", "/sessions/:id", {
      params: AdminIdParams,
      success: AdminSessionDetailResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Get admin session details" })),
    HttpApiEndpoint.post("stopSession", "/sessions/:id/stop", {
      params: AdminIdParams,
      payload: AdminActionPayload,
      success: AdminActionResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Stop a session as an admin" })),
    HttpApiEndpoint.post("archiveSession", "/sessions/:id/archive", {
      params: AdminIdParams,
      payload: AdminActionPayload,
      success: AdminActionResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Archive a session as an admin" })),
    HttpApiEndpoint.post("unarchiveSession", "/sessions/:id/unarchive", {
      params: AdminIdParams,
      payload: AdminActionPayload,
      success: AdminActionResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Unarchive a session as an admin" })),
    HttpApiEndpoint.delete("deleteSession", "/sessions/:id", {
      params: AdminIdParams,
      payload: AdminActionPayload,
      success: AdminActionResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Delete a session index row as an admin" })),
    HttpApiEndpoint.get("workflows", "/workflows", {
      query: AdminWorkflowListQuery,
      success: AdminWorkflowListResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List all workflows for admins" })),
    HttpApiEndpoint.get("workflowRuns", "/workflows/:id/runs", {
      params: AdminIdParams,
      success: AdminWorkflowRunsResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "List workflow runs as an admin" })),
    HttpApiEndpoint.get("workflowRunEvents", "/workflows/:id/runs/:runId/events", {
      params: AdminWorkflowRunParams,
      success: AdminWorkflowRunEventsResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "List workflow run events as an admin" })),
    HttpApiEndpoint.get("githubAccountCleanupPreview", "/github/accounts/cleanup-preview", {
      success: AdminGitHubAccountCleanupPreviewResponse,
      error: CommonErrors,
    }).annotateMerge(
      OpenApi.annotations({ summary: "Preview temporary GitHub linked account cleanup" }),
    ),
    HttpApiEndpoint.post("githubAccountCleanup", "/github/accounts/cleanup", {
      success: AdminGitHubAccountCleanupResponse,
      error: CommonErrors,
    }).annotateMerge(
      OpenApi.annotations({ summary: "Delete all GitHub linked account rows as an admin" }),
    ),
    HttpApiEndpoint.get("mcpcf", "/mcpcf", {
      success: AdminMcpcfResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Get MCP Context Forge configuration" })),
    HttpApiEndpoint.get("aiProviders", "/ai-providers", {
      success: AdminAiProvidersResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Get AI provider configuration" })),
    HttpApiEndpoint.get("aiSearch", "/ai-search", {
      success: AdminAiSearchResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Get AI Search configuration" })),
    HttpApiEndpoint.get("agentSkills", "/skills", {
      success: AdminAgentSkillsResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List global Agent Skills" })),
    HttpApiEndpoint.post("createAgentSkill", "/skills", {
      payload: AdminAgentSkillCreatePayload,
      success: AdminAgentSkillsResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Create a global Agent Skill" })),
    HttpApiEndpoint.patch("updateAgentSkill", "/skills/:id", {
      params: AdminIdParams,
      payload: AdminAgentSkillDefaultPayload,
      success: AdminAgentSkillsResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Update a global Agent Skill" })),
    HttpApiEndpoint.delete("deleteAgentSkill", "/skills/:id", {
      params: AdminIdParams,
      success: AdminAgentSkillsResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Delete a global Agent Skill" })),
    HttpApiEndpoint.post("exportAiSearchConfig", "/ai-search/export", {
      success: AdminAiSearchExportResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Export AI Search runtime registry" })),
    HttpApiEndpoint.post("createAiSearchSource", "/ai-search/sources", {
      payload: AdminAiSearchSourcePayload,
      success: AdminAiSearchResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Create AI Search source" })),
    HttpApiEndpoint.put("updateAiSearchSource", "/ai-search/sources/:id", {
      params: AdminIdParams,
      payload: AdminAiSearchSourcePayload,
      success: AdminAiSearchResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Update AI Search source" })),
    HttpApiEndpoint.delete("deleteAiSearchSource", "/ai-search/sources/:id", {
      params: AdminIdParams,
      success: AdminAiSearchResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Delete AI Search source" })),
    HttpApiEndpoint.put("updateLitellmProvider", "/ai-providers/litellm", {
      payload: AdminLitellmConfigPayload,
      success: AdminAiProvidersResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Update LiteLLM provider configuration" })),
    HttpApiEndpoint.put(
      "updateCloudflareAiGatewayProviderKeys",
      "/ai-providers/cloudflare-ai-gateway/keys",
      {
        payload: AdminCloudflareAiGatewayProviderKeysPayload,
        success: AdminAiProvidersResponse,
        error: CommonErrors,
      },
    ).annotateMerge(
      OpenApi.annotations({ summary: "Update global Cloudflare AI Gateway BYOK keys" }),
    ),
    HttpApiEndpoint.delete("resetLitellmProvider", "/ai-providers/litellm", {
      success: AdminAiProvidersResponse,
      error: CommonErrors,
    }).annotateMerge(
      OpenApi.annotations({ summary: "Reset KV-backed LiteLLM provider configuration" }),
    ),
    HttpApiEndpoint.post("exportLitellmProvider", "/ai-providers/litellm/export", {
      success: AdminLitellmExportResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Export LiteLLM deployment configuration" })),
    HttpApiEndpoint.post("syncLitellmModels", "/ai-providers/litellm/sync", {
      success: AdminLitellmSyncResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Sync LiteLLM model registry" })),
    HttpApiEndpoint.put("updateMcpcfConfig", "/mcpcf/config", {
      payload: AdminMcpcfConfigPayload,
      success: AdminMcpcfResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Update MCP Context Forge configuration" })),
    HttpApiEndpoint.delete("resetMcpcfConfig", "/mcpcf/config", {
      success: AdminMcpcfResponse,
      error: CommonErrors,
    }).annotateMerge(
      OpenApi.annotations({ summary: "Reset KV-backed MCP Context Forge configuration" }),
    ),
    HttpApiEndpoint.post("exportMcpcfConfig", "/mcpcf/config/export", {
      success: AdminMcpcfExportResponse,
      error: CommonErrors,
    }).annotateMerge(
      OpenApi.annotations({ summary: "Export MCP Context Forge deployment configuration" }),
    ),
    HttpApiEndpoint.post("refreshMcpcf", "/mcpcf/refresh", {
      success: AdminMcpcfRefreshResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Refresh MCP Context Forge registry" })),
    HttpApiEndpoint.post("runWorkflow", "/workflows/:id/runs", {
      params: AdminIdParams,
      payload: AdminRunWorkflowPayload,
      success: AdminActionResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Start a workflow run as an admin" })),
    HttpApiEndpoint.post("retryWorkflowRun", "/workflows/:id/runs/:runId/retry", {
      params: AdminWorkflowRunParams,
      payload: AdminActionPayload,
      success: AdminActionResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Retry a workflow run as an admin" })),
    HttpApiEndpoint.delete("archiveWorkflow", "/workflows/:id", {
      params: AdminIdParams,
      payload: AdminActionPayload,
      success: AdminActionResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Archive a workflow as an admin" })),
    HttpApiEndpoint.post("unarchiveWorkflow", "/workflows/:id/unarchive", {
      params: AdminIdParams,
      payload: AdminActionPayload,
      success: AdminActionResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Unarchive a workflow as an admin" })),
  )
  .prefix("/admin")
  .middleware(ControlPlaneAuth) {}
