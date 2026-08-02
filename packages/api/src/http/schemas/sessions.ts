import { Effect, Schema } from "effect"
import { HttpApiSchema } from "effect/unstable/httpapi"
import { JsonRecord, StringMap } from "./common"
import { SUBAGENT_MODES } from "@c0-agent/shared"

export const SessionKind = Schema.Literals(["isolate", "sandbox"])
export type SessionKind = typeof SessionKind.Type

export const AgentRuntime = Schema.Literals(["isolate", "opencode", "codex", "claude-code"])
export type AgentRuntime = typeof AgentRuntime.Type

export const SessionStatus = Schema.Literals(["created", "active", "completed", "archived"])
export type SessionStatus = typeof SessionStatus.Type

export const SessionKindWithDefault = SessionKind.pipe(
  Schema.withDecodingDefaultKey(Effect.succeed("isolate")),
)

export const SubagentMode = Schema.Literals(SUBAGENT_MODES)
export type SubagentMode = typeof SubagentMode.Type

export const MessageSource = Schema.Literals(["web", "slack", "extension", "github"])
export type MessageSource = typeof MessageSource.Type

export const MessageStatus = Schema.Literals(["pending", "processing", "completed", "failed"])
export type MessageStatus = typeof MessageStatus.Type

export const AttachmentType = Schema.Literals(["file", "image", "url"])
export type AttachmentType = typeof AttachmentType.Type

export const GitHubRepoSessionTool = Schema.Struct({
  kind: Schema.Literal("github_repo"),
  repoOwner: Schema.String,
  repoName: Schema.String,
})

export const AiSearchSessionTool = Schema.Struct({
  kind: Schema.Literal("ai_search"),
  sourceId: Schema.String,
})

export const WorkflowBuilderSessionTool = Schema.Struct({
  kind: Schema.Literal("workflow_builder"),
})

export const McpcfSessionTool = Schema.Struct({
  kind: Schema.Literal("mcpcf_server"),
  serverId: Schema.String,
})

export const SessionToolSpec = Schema.Union([
  GitHubRepoSessionTool,
  AiSearchSessionTool,
  McpcfSessionTool,
  WorkflowBuilderSessionTool,
])
export type SessionToolSpec = typeof SessionToolSpec.Type

export const OpenCodeMcpOAuth = Schema.Union([
  Schema.Literal(false),
  Schema.Struct({
    clientId: Schema.optionalKey(Schema.String),
    clientSecret: Schema.optionalKey(Schema.String),
    scope: Schema.optionalKey(Schema.String),
  }),
])

export const OpenCodeRemoteMcpServer = Schema.Struct({
  type: Schema.Literal("remote"),
  url: Schema.String,
  enabled: Schema.optionalKey(Schema.Boolean),
  headers: Schema.optionalKey(StringMap),
  oauth: Schema.optionalKey(OpenCodeMcpOAuth),
  timeout: Schema.optionalKey(Schema.Number),
})

export const OpenCodeLocalMcpServer = Schema.Struct({
  type: Schema.Literal("local"),
  command: Schema.Array(Schema.String),
  enabled: Schema.optionalKey(Schema.Boolean),
  environment: Schema.optionalKey(StringMap),
  timeout: Schema.optionalKey(Schema.Number),
})

export const OpenCodeMcpServer = Schema.Union([OpenCodeRemoteMcpServer, OpenCodeLocalMcpServer])
export type OpenCodeMcpServer = typeof OpenCodeMcpServer.Type

export const OpenCodeMcpServers = Schema.Record(Schema.String, OpenCodeMcpServer)
export type OpenCodeMcpServers = typeof OpenCodeMcpServers.Type

export const SessionAttachment = Schema.Struct({
  type: AttachmentType,
  name: Schema.String,
  url: Schema.optionalKey(Schema.String),
})

export const SlackCallbackContext = Schema.Struct({
  type: Schema.optionalKey(Schema.Literal("slack")),
  channel: Schema.String,
  threadTs: Schema.String,
  repoFullName: Schema.String,
  model: Schema.String,
  reactionMessageTs: Schema.optionalKey(Schema.String),
})

/** Public callers may supply Slack delivery context only; workflow context is internal-only. */
export const CallbackContext = SlackCallbackContext

export const CreateSessionPayload = Schema.Struct({
  sessionKind: SessionKindWithDefault,
  agentRuntime: Schema.optionalKey(AgentRuntime),
  repoOwner: Schema.optionalKey(Schema.String),
  repoName: Schema.optionalKey(Schema.String),
  tools: Schema.optionalKey(Schema.Array(SessionToolSpec)),
  customMcpServers: Schema.optionalKey(OpenCodeMcpServers),
  secretKeys: Schema.optionalKey(Schema.Array(Schema.String)),
  isolateStepLimit: Schema.optionalKey(Schema.Number),
  subagents: Schema.optionalKey(SubagentMode),
  title: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
  reasoningEffort: Schema.optionalKey(Schema.String),
  userId: Schema.optionalKey(Schema.String),
  githubLogin: Schema.optionalKey(Schema.String),
  githubName: Schema.optionalKey(Schema.String),
  githubEmail: Schema.optionalKey(Schema.String),
  incognito: Schema.optionalKey(Schema.Boolean),
})
export type CreateSessionPayload = typeof CreateSessionPayload.Type

export const RunSessionPayload = Schema.Struct({
  ...CreateSessionPayload.fields,
  sessionId: Schema.optionalKey(Schema.String),
  content: Schema.String,
  source: Schema.optionalKey(MessageSource),
  attachments: Schema.optionalKey(Schema.Array(SessionAttachment)),
  callbackContext: Schema.optionalKey(CallbackContext),
})
export type RunSessionPayload = typeof RunSessionPayload.Type

export const SlackCreateSessionPayload = Schema.Struct({
  ...CreateSessionPayload.fields,
  slackUserId: Schema.String,
})
export type SlackCreateSessionPayload = typeof SlackCreateSessionPayload.Type

export const PromptPayload = Schema.Struct({
  content: Schema.String,
  authorId: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(MessageSource),
  model: Schema.optionalKey(Schema.String),
  reasoningEffort: Schema.optionalKey(Schema.String),
  attachments: Schema.optionalKey(Schema.Array(SessionAttachment)),
  callbackContext: Schema.optionalKey(CallbackContext),
})
export type PromptPayload = typeof PromptPayload.Type

export const ResumeSessionPayload = Schema.Struct({
  messageId: Schema.optionalKey(Schema.String),
  reason: Schema.Literal("okta_reconnect"),
})
export type ResumeSessionPayload = typeof ResumeSessionPayload.Type

export const UpdateSessionToolsPayload = Schema.Struct({
  tools: Schema.optionalKey(Schema.Array(SessionToolSpec)),
  customMcpServers: Schema.optionalKey(OpenCodeMcpServers),
  isolateStepLimit: Schema.optionalKey(Schema.Number),
  subagents: Schema.optionalKey(SubagentMode),
  repoOwner: Schema.optionalKey(Schema.String),
  repoName: Schema.optionalKey(Schema.String),
})
export type UpdateSessionToolsPayload = typeof UpdateSessionToolsPayload.Type

export const WsTokenPayload = Schema.Struct({
  userId: Schema.optionalKey(Schema.String),
  githubLogin: Schema.optionalKey(Schema.String),
  githubName: Schema.optionalKey(Schema.String),
  githubEmail: Schema.optionalKey(Schema.String),
})
export type WsTokenPayload = typeof WsTokenPayload.Type

export const IdParams = {
  id: Schema.String,
}
export type IdParams = { id: string }

export const McpcfServerParams = {
  serverId: Schema.String,
}
export type McpcfServerParams = { serverId: string }

export const SessionsListQuery = {
  limit: Schema.optionalKey(Schema.String),
  offset: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  excludeStatus: Schema.optionalKey(Schema.String),
  includeIncognito: Schema.optionalKey(Schema.String),
  q: Schema.optionalKey(Schema.String),
  sortBy: Schema.optionalKey(Schema.String),
  sortDir: Schema.optionalKey(Schema.String),
  sessionKind: Schema.optionalKey(Schema.String),
  agentRuntime: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(Schema.String),
  repoOwner: Schema.optionalKey(Schema.String),
  repoName: Schema.optionalKey(Schema.String),
}
export type SessionsListQuery = {
  limit?: string
  offset?: string
  status?: string
  excludeStatus?: string
  includeIncognito?: string
  q?: string
  sortBy?: string
  sortDir?: string
  sessionKind?: string
  agentRuntime?: string
  source?: string
  repoOwner?: string
  repoName?: string
}

export class SessionResponse extends Schema.Class<SessionResponse>("SessionResponse")({
  session: JsonRecord,
}) {}

export class CreatedSessionResponse extends Schema.Class<CreatedSessionResponse>(
  "CreatedSessionResponse",
)({
  sessionId: Schema.String,
  sessionKind: SessionKind,
  agentRuntime: AgentRuntime,
  status: SessionStatus,
}) {}

export const CreatedSessionSuccess = CreatedSessionResponse.pipe(HttpApiSchema.status(201))

export class SlackSetupLinkResponse extends Schema.Class<SlackSetupLinkResponse>(
  "SlackSetupLinkResponse",
)({
  error: Schema.String,
  setupUrl: Schema.String,
}) {}

export const SlackSetupLinkError = SlackSetupLinkResponse.pipe(HttpApiSchema.status(403))

export class SessionListResponse extends Schema.Class<SessionListResponse>("SessionListResponse")({
  sessions: Schema.Array(JsonRecord),
  total: Schema.Number,
  limit: Schema.Number,
  offset: Schema.Number,
}) {}

export class SessionMessagesResponse extends Schema.Class<SessionMessagesResponse>(
  "SessionMessagesResponse",
)({
  messages: Schema.Array(JsonRecord),
}) {}

export class SessionArtifactsResponse extends Schema.Class<SessionArtifactsResponse>(
  "SessionArtifactsResponse",
)({
  artifacts: Schema.Array(JsonRecord),
}) {}

export class SessionSandboxActivityResponse extends Schema.Class<SessionSandboxActivityResponse>(
  "SessionSandboxActivityResponse",
)({
  activity: Schema.Array(JsonRecord),
}) {}

export class SessionWsTokenResponse extends Schema.Class<SessionWsTokenResponse>(
  "SessionWsTokenResponse",
)({
  token: Schema.String,
  participantId: Schema.String,
}) {}

export class AiSearchSessionSource extends Schema.Class<AiSearchSessionSource>(
  "AiSearchSessionSource",
)({
  id: Schema.String,
  label: Schema.String,
  description: Schema.String,
  kind: Schema.Literal("ai_search"),
}) {}

export class AiSearchSessionSourcesResponse extends Schema.Class<AiSearchSessionSourcesResponse>(
  "AiSearchSessionSourcesResponse",
)({
  sources: Schema.Array(AiSearchSessionSource),
}) {}

export class McpcfServer extends Schema.Class<McpcfServer>("McpcfServer")({
  id: Schema.String,
  slug: Schema.String,
  label: Schema.String,
  description: Schema.String,
  authType: Schema.NullOr(Schema.String),
  authLabel: Schema.NullOr(Schema.String),
  gatewayAuthType: Schema.optionalKey(Schema.NullOr(Schema.String)),
  gatewayAuthLabel: Schema.optionalKey(Schema.NullOr(Schema.String)),
  upstreamAuthType: Schema.optionalKey(Schema.NullOr(Schema.String)),
  upstreamAuthLabel: Schema.optionalKey(Schema.NullOr(Schema.String)),
  gatewayAuthTokenRequired: Schema.optionalKey(Schema.Boolean),
  gatewayAuthTokenConfigured: Schema.optionalKey(Schema.Boolean),
  upstreamAuthTokenRequired: Schema.optionalKey(Schema.Boolean),
  upstreamAuthTokenConfigured: Schema.optionalKey(Schema.Boolean),
  configuredForUser: Schema.optionalKey(Schema.Boolean),
  contextForgeUrl: Schema.optionalKey(Schema.String),
  contextForgeApiKeysUrl: Schema.optionalKey(Schema.String),
  toolCount: Schema.Number,
}) {}

export class McpcfToolPreview extends Schema.Class<McpcfToolPreview>("McpcfToolPreview")({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
}) {}

export class McpcfServersResponse extends Schema.Class<McpcfServersResponse>(
  "McpcfServersResponse",
)({
  servers: Schema.Array(McpcfServer),
}) {}

export class McpcfToolsResponse extends Schema.Class<McpcfToolsResponse>("McpcfToolsResponse")({
  tools: Schema.Array(McpcfToolPreview),
}) {}

export class McpcfUserServerSettings extends Schema.Class<McpcfUserServerSettings>(
  "McpcfUserServerSettings",
)({
  id: Schema.String,
  slug: Schema.String,
  label: Schema.String,
  description: Schema.String,
  authType: Schema.NullOr(Schema.String),
  authLabel: Schema.NullOr(Schema.String),
  gatewayAuthType: Schema.optionalKey(Schema.NullOr(Schema.String)),
  gatewayAuthLabel: Schema.optionalKey(Schema.NullOr(Schema.String)),
  upstreamAuthType: Schema.optionalKey(Schema.NullOr(Schema.String)),
  upstreamAuthLabel: Schema.optionalKey(Schema.NullOr(Schema.String)),
  gatewayAuthTokenRequired: Schema.Boolean,
  gatewayAuthTokenConfigured: Schema.Boolean,
  upstreamAuthTokenRequired: Schema.Boolean,
  upstreamAuthTokenConfigured: Schema.Boolean,
  authTokenRequired: Schema.Boolean,
  authTokenConfigured: Schema.Boolean,
  configuredForUser: Schema.Boolean,
  contextForgeUrl: Schema.optionalKey(Schema.String),
  contextForgeApiKeysUrl: Schema.optionalKey(Schema.String),
  toolCount: Schema.Number,
  defaultToolsEnabled: Schema.Boolean,
  disabledTools: Schema.Array(Schema.String),
  tools: Schema.Array(McpcfToolPreview),
}) {}

export const McpcfUserSettingsListQuery = {
  limit: Schema.optionalKey(Schema.String),
  offset: Schema.optionalKey(Schema.String),
  q: Schema.optionalKey(Schema.String),
  sortBy: Schema.optionalKey(Schema.String),
  sortDir: Schema.optionalKey(Schema.String),
  auth: Schema.optionalKey(Schema.String),
  configured: Schema.optionalKey(Schema.String),
  defaultTools: Schema.optionalKey(Schema.String),
}
export type McpcfUserSettingsListQuery = {
  limit?: string
  offset?: string
  q?: string
  sortBy?: string
  sortDir?: string
  auth?: string
  configured?: string
  defaultTools?: string
}

export class McpcfUserSettingsResponse extends Schema.Class<McpcfUserSettingsResponse>(
  "McpcfUserSettingsResponse",
)({
  servers: Schema.Array(McpcfUserServerSettings),
  total: Schema.Number,
  limit: Schema.Number,
  offset: Schema.Number,
}) {}

export const McpcfUserServerSettingsPayload = Schema.Struct({
  authToken: Schema.optionalKey(Schema.NullOr(Schema.String)),
  clearAuthToken: Schema.optionalKey(Schema.Boolean),
  defaultToolsEnabled: Schema.optionalKey(Schema.Boolean),
  disabledTools: Schema.optionalKey(Schema.Array(Schema.String)),
})
export type McpcfUserServerSettingsPayload = typeof McpcfUserServerSettingsPayload.Type

export class McpcfContextForgeTokenSettings extends Schema.Class<McpcfContextForgeTokenSettings>(
  "McpcfContextForgeTokenSettings",
)({
  configured: Schema.Boolean,
  contextForgeUrl: Schema.optionalKey(Schema.String),
  contextForgeApiKeysUrl: Schema.optionalKey(Schema.String),
  tokenAuthServerCount: Schema.Number,
}) {}

export const McpcfContextForgeTokenSettingsPayload = Schema.Struct({
  token: Schema.optionalKey(Schema.NullOr(Schema.String)),
  clearToken: Schema.optionalKey(Schema.Boolean),
})
export type McpcfContextForgeTokenSettingsPayload =
  typeof McpcfContextForgeTokenSettingsPayload.Type

export class McpcfUserServerSettingsResponse extends Schema.Class<McpcfUserServerSettingsResponse>(
  "McpcfUserServerSettingsResponse",
)({
  server: McpcfUserServerSettings,
}) {}

export class RunSessionResponse extends Schema.Class<RunSessionResponse>("RunSessionResponse")({
  sessionId: Schema.String,
  sessionKind: SessionKind,
  agentRuntime: AgentRuntime,
  createdSession: Schema.Boolean,
  messageId: Schema.String,
  status: MessageStatus,
  output: Schema.NullOr(Schema.String),
  error: Schema.optionalKey(Schema.String),
}) {}

export class PromptResponse extends Schema.Class<PromptResponse>("PromptResponse")({
  messageId: Schema.String,
  status: Schema.String,
  output: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
}) {}

export class ResumeSessionResponse extends Schema.Class<ResumeSessionResponse>(
  "ResumeSessionResponse",
)({
  messageId: Schema.String,
  resumedFromMessageId: Schema.String,
  status: Schema.String,
  alreadyResuming: Schema.Boolean,
}) {}
