import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { CommonErrors, NotFoundError } from "../errors"
import { DeletedSessionResponse } from "../schemas/common"
import {
  CreateSessionPayload,
  CreatedSessionSuccess,
  AiSearchSessionSourcesResponse,
  IdParams,
  McpcfContextForgeTokenSettings,
  McpcfContextForgeTokenSettingsPayload,
  McpcfServerParams,
  McpcfServersResponse,
  McpcfToolsResponse,
  McpcfUserServerSettingsPayload,
  McpcfUserServerSettingsResponse,
  McpcfUserSettingsListQuery,
  McpcfUserSettingsResponse,
  PromptPayload,
  PromptResponse,
  ResumeSessionPayload,
  ResumeSessionResponse,
  RunSessionPayload,
  RunSessionResponse,
  SessionArtifactsResponse,
  SessionListResponse,
  SessionMessagesResponse,
  SessionResponse,
  SessionSandboxActivityResponse,
  SessionsListQuery,
  SlackCreateSessionPayload,
  SlackSetupLinkError,
  UpdateSessionToolsPayload,
  WsTokenPayload,
  SessionWsTokenResponse,
} from "../schemas/sessions"
import { ControlPlaneAuth } from "../security"

export class SessionsGroup extends HttpApiGroup.make("sessions")
  .add(
    HttpApiEndpoint.get("list", "/", {
      query: SessionsListQuery,
      success: SessionListResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List sessions" })),
    HttpApiEndpoint.post("create", "/", {
      payload: CreateSessionPayload,
      success: CreatedSessionSuccess,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Create session" })),
    HttpApiEndpoint.post("createIsolate", "/isolate", {
      payload: CreateSessionPayload,
      success: CreatedSessionSuccess,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Create isolate session" })),
    HttpApiEndpoint.post("createSandbox", "/sandbox", {
      payload: CreateSessionPayload,
      success: CreatedSessionSuccess,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Create sandbox session" })),
    HttpApiEndpoint.post("run", "/run", {
      payload: RunSessionPayload,
      success: RunSessionResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Create session and run prompt" })),
    HttpApiEndpoint.post("createSlack", "/slack", {
      payload: SlackCreateSessionPayload,
      success: CreatedSessionSuccess,
      error: [SlackSetupLinkError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Create Slack session" })),
    HttpApiEndpoint.get("mcpcfServers", "/mcpcf/servers", {
      success: McpcfServersResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List available MCP Context Forge servers" })),
    HttpApiEndpoint.get("aiSearchSources", "/ai-search/sources", {
      success: AiSearchSessionSourcesResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List available AI Search sources" })),
    HttpApiEndpoint.get("mcpcfTools", "/mcpcf/:serverId/tools", {
      params: McpcfServerParams,
      success: McpcfToolsResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List MCP Context Forge server tools" })),
    HttpApiEndpoint.get("mcpcfSettings", "/mcpcf/settings", {
      query: McpcfUserSettingsListQuery,
      success: McpcfUserSettingsResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List user MCP Context Forge settings" })),
    HttpApiEndpoint.get("mcpcfContextForgeTokenSettings", "/mcpcf/contextforge-token", {
      success: McpcfContextForgeTokenSettings,
      error: CommonErrors,
    }).annotateMerge(
      OpenApi.annotations({ summary: "Get user MCP Context Forge API token settings" }),
    ),
    HttpApiEndpoint.put("updateMcpcfContextForgeTokenSettings", "/mcpcf/contextforge-token", {
      payload: McpcfContextForgeTokenSettingsPayload,
      success: McpcfContextForgeTokenSettings,
      error: CommonErrors,
    }).annotateMerge(
      OpenApi.annotations({ summary: "Update user MCP Context Forge API token settings" }),
    ),
    HttpApiEndpoint.put("updateMcpcfSettings", "/mcpcf/:serverId/settings", {
      params: McpcfServerParams,
      payload: McpcfUserServerSettingsPayload,
      success: McpcfUserServerSettingsResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Update user MCP Context Forge settings" })),
    HttpApiEndpoint.get("get", "/:id", {
      params: IdParams,
      success: SessionResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Get session" })),
    HttpApiEndpoint.delete("delete", "/:id", {
      params: IdParams,
      success: DeletedSessionResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Delete session" })),
    HttpApiEndpoint.patch("tools", "/:id/tools", {
      params: IdParams,
      payload: UpdateSessionToolsPayload,
      success: SessionResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Update session tools" })),
    HttpApiEndpoint.post("prompt", "/:id/prompt", {
      params: IdParams,
      payload: PromptPayload,
      success: PromptResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Run session prompt" })),
    HttpApiEndpoint.post("resume", "/:id/resume", {
      params: IdParams,
      payload: ResumeSessionPayload,
      success: ResumeSessionResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Resume a failed session prompt" })),
    HttpApiEndpoint.post("stop", "/:id/stop", {
      params: IdParams,
      success: SessionResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Stop session" })),
    HttpApiEndpoint.get("events", "/:id/events", {
      params: IdParams,
      success: SessionResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Get session events" })),
    HttpApiEndpoint.get("sandboxActivity", "/:id/sandbox/activity", {
      params: IdParams,
      success: SessionSandboxActivityResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Get sandbox activity history" })),
    HttpApiEndpoint.get("messages", "/:id/messages", {
      params: IdParams,
      success: SessionMessagesResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Get session messages" })),
    HttpApiEndpoint.get("artifacts", "/:id/artifacts", {
      params: IdParams,
      success: SessionArtifactsResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Get session artifacts" })),
    HttpApiEndpoint.post("wsToken", "/:id/ws-token", {
      params: IdParams,
      payload: WsTokenPayload,
      success: SessionWsTokenResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Create session websocket token" })),
    HttpApiEndpoint.post("archive", "/:id/archive", {
      params: IdParams,
      success: SessionResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Archive session" })),
    HttpApiEndpoint.post("unarchive", "/:id/unarchive", {
      params: IdParams,
      success: SessionResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Unarchive session" })),
  )
  .prefix("/sessions")
  .middleware(ControlPlaneAuth) {}
