import { Schema } from "effect"
import { JsonRecord } from "./common"

export const AdminListQuery = {
  limit: Schema.optionalKey(Schema.String),
  offset: Schema.optionalKey(Schema.String),
  q: Schema.optionalKey(Schema.String),
  sortBy: Schema.optionalKey(Schema.String),
  sortDir: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  agentRuntime: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(Schema.String),
  userId: Schema.optionalKey(Schema.String),
  repoOwner: Schema.optionalKey(Schema.String),
  repoName: Schema.optionalKey(Schema.String),
}
export type AdminListQuery = {
  limit?: string
  offset?: string
  q?: string
  sortBy?: string
  sortDir?: string
  status?: string
  agentRuntime?: string
  kind?: string
  source?: string
  userId?: string
  repoOwner?: string
  repoName?: string
}

export const AdminWorkflowListQuery = {
  limit: Schema.optionalKey(Schema.String),
  offset: Schema.optionalKey(Schema.String),
  q: Schema.optionalKey(Schema.String),
  sortBy: Schema.optionalKey(Schema.String),
  sortDir: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  userId: Schema.optionalKey(Schema.String),
}
export type AdminWorkflowListQuery = {
  limit?: string
  offset?: string
  q?: string
  sortBy?: string
  sortDir?: string
  status?: string
  userId?: string
}

export const AdminIdParams = {
  id: Schema.String,
}
export type AdminIdParams = { id: string }

export const AdminWorkflowRunParams = {
  id: Schema.String,
  runId: Schema.String,
}
export type AdminWorkflowRunParams = { id: string; runId: string }

export const AdminActionPayload = Schema.Struct({
  reason: Schema.optionalKey(Schema.String),
})
export type AdminActionPayload = typeof AdminActionPayload.Type

export const AdminRunWorkflowPayload = Schema.Struct({
  trigger: Schema.optionalKey(Schema.Unknown),
  reason: Schema.optionalKey(Schema.String),
})
export type AdminRunWorkflowPayload = typeof AdminRunWorkflowPayload.Type

export class AdminStatusCount extends Schema.Class<AdminStatusCount>("AdminStatusCount")({
  status: Schema.String,
  count: Schema.Number,
}) {}

export class AdminAttentionItem extends Schema.Class<AdminAttentionItem>("AdminAttentionItem")({
  id: Schema.String,
  severity: Schema.Literals(["warn", "error"]),
  label: Schema.String,
  detail: Schema.String,
  targetType: Schema.String,
  targetId: Schema.String,
  status: Schema.optionalKey(Schema.String),
  updatedAt: Schema.optionalKey(Schema.Number),
}) {}

export class AdminSummaryResponse extends Schema.Class<AdminSummaryResponse>(
  "AdminSummaryResponse",
)({
  sessions: Schema.Array(AdminStatusCount),
  workflows: Schema.Array(AdminStatusCount),
  workflowRuns: Schema.Array(AdminStatusCount),
  attention: Schema.Array(AdminAttentionItem),
}) {}

export class AdminAccessResponse extends Schema.Class<AdminAccessResponse>("AdminAccessResponse")({
  isAdmin: Schema.Boolean,
}) {}

export class AdminSessionRecord extends Schema.Class<AdminSessionRecord>("AdminSessionRecord")({
  id: Schema.String,
  userId: Schema.String,
  userName: Schema.NullOr(Schema.String),
  userEmail: Schema.NullOr(Schema.String),
  sessionKind: Schema.String,
  agentRuntime: Schema.String,
  source: Schema.String,
  title: Schema.NullOr(Schema.String),
  repoOwner: Schema.String,
  repoName: Schema.String,
  model: Schema.String,
  reasoningEffort: Schema.NullOr(Schema.String),
  status: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class AdminSessionListResponse extends Schema.Class<AdminSessionListResponse>(
  "AdminSessionListResponse",
)({
  sessions: Schema.Array(AdminSessionRecord),
  total: Schema.Number,
  limit: Schema.Number,
  offset: Schema.Number,
  hasMore: Schema.Boolean,
}) {}

export class AdminSessionDetailResponse extends Schema.Class<AdminSessionDetailResponse>(
  "AdminSessionDetailResponse",
)({
  session: AdminSessionRecord,
  state: Schema.NullOr(JsonRecord),
  sandboxActivity: Schema.Array(JsonRecord),
  messages: Schema.Array(JsonRecord),
  artifacts: Schema.Array(JsonRecord),
}) {}

export class AdminWorkflowRunRecord extends Schema.Class<AdminWorkflowRunRecord>(
  "AdminWorkflowRunRecord",
)({
  id: Schema.String,
  workflowId: Schema.String,
  workflowVersion: Schema.Number,
  workflowInstanceId: Schema.NullOr(Schema.String),
  userId: Schema.String,
  triggerKind: Schema.String,
  triggerNodeId: Schema.NullOr(Schema.String),
  status: Schema.String,
  input: JsonRecord,
  output: Schema.NullOr(JsonRecord),
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.Number,
  completedAt: Schema.NullOr(Schema.Number),
  updatedAt: Schema.Number,
}) {}

export class AdminWorkflowRecord extends Schema.Class<AdminWorkflowRecord>("AdminWorkflowRecord")({
  id: Schema.String,
  userId: Schema.String,
  userName: Schema.NullOr(Schema.String),
  userEmail: Schema.NullOr(Schema.String),
  name: Schema.String,
  status: Schema.String,
  manifestVersion: Schema.Number,
  webhookId: Schema.String,
  webhookPath: Schema.String,
  webhookUrl: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  latestRun: Schema.NullOr(AdminWorkflowRunRecord),
  runCounts: Schema.Array(AdminStatusCount),
}) {}

export class AdminWorkflowListResponse extends Schema.Class<AdminWorkflowListResponse>(
  "AdminWorkflowListResponse",
)({
  workflows: Schema.Array(AdminWorkflowRecord),
  total: Schema.Number,
  limit: Schema.Number,
  offset: Schema.Number,
  hasMore: Schema.Boolean,
}) {}

export class AdminWorkflowRunsResponse extends Schema.Class<AdminWorkflowRunsResponse>(
  "AdminWorkflowRunsResponse",
)({
  runs: Schema.Array(AdminWorkflowRunRecord),
}) {}

export class AdminWorkflowRunEvent extends Schema.Class<AdminWorkflowRunEvent>(
  "AdminWorkflowRunEvent",
)({
  id: Schema.String,
  workflowId: Schema.String,
  runId: Schema.String,
  sequence: Schema.Number,
  nodeId: Schema.NullOr(Schema.String),
  eventType: Schema.String,
  level: Schema.String,
  message: Schema.String,
  data: JsonRecord,
  createdAt: Schema.Number,
}) {}

export class AdminWorkflowRunEventsResponse extends Schema.Class<AdminWorkflowRunEventsResponse>(
  "AdminWorkflowRunEventsResponse",
)({
  events: Schema.Array(AdminWorkflowRunEvent),
}) {}

export class AdminGitHubAccountCleanupPreviewResponse extends Schema.Class<AdminGitHubAccountCleanupPreviewResponse>(
  "AdminGitHubAccountCleanupPreviewResponse",
)({
  affectedUsers: Schema.Number,
  linkedAccounts: Schema.Number,
}) {}

export class AdminGitHubAccountCleanupResponse extends Schema.Class<AdminGitHubAccountCleanupResponse>(
  "AdminGitHubAccountCleanupResponse",
)({
  status: Schema.String,
  affectedUsers: Schema.Number,
  deletedAccounts: Schema.Number,
}) {}

export class AdminMcpcfConfig extends Schema.Class<AdminMcpcfConfig>("AdminMcpcfConfig")({
  enabled: Schema.Boolean,
  baseUrl: Schema.String,
  userOauthProviderId: Schema.String,
  expectedIssuer: Schema.NullOr(Schema.String),
  authTypeAllowlist: Schema.Array(Schema.String),
  serverBlacklist: Schema.Array(Schema.String),
  source: Schema.String,
  locked: Schema.Boolean,
  envVarName: Schema.NullOr(Schema.String),
  adminApiTokenConfigured: Schema.Boolean,
  adminApiTokenSource: Schema.String,
  adminApiTokenLocked: Schema.Boolean,
  adminApiTokenEnvVarName: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(Schema.Number),
}) {}

export class AdminMcpcfServer extends Schema.Class<AdminMcpcfServer>("AdminMcpcfServer")({
  id: Schema.String,
  slug: Schema.String,
  label: Schema.String,
  description: Schema.String,
  authType: Schema.NullOr(Schema.String),
  toolCount: Schema.Number,
  sourceStatus: Schema.String,
  filterReason: Schema.NullOr(Schema.String),
  enabled: Schema.Boolean,
  firstSeenAt: Schema.Number,
  lastSeenAt: Schema.Number,
  verifiedAt: Schema.NullOr(Schema.Number),
  updatedAt: Schema.Number,
}) {}

export class AdminMcpcfResponse extends Schema.Class<AdminMcpcfResponse>("AdminMcpcfResponse")({
  config: AdminMcpcfConfig,
  servers: Schema.Array(AdminMcpcfServer),
  registrySource: Schema.String,
  registryLocked: Schema.Boolean,
  registryEnvVarName: Schema.NullOr(Schema.String),
}) {}

export const AdminMcpcfConfigPayload = Schema.Struct({
  enabled: Schema.Boolean,
  baseUrl: Schema.String,
  userOauthProviderId: Schema.String,
  expectedIssuer: Schema.optionalKey(Schema.NullOr(Schema.String)),
  authTypeAllowlist: Schema.optionalKey(Schema.Array(Schema.String)),
  serverBlacklist: Schema.optionalKey(Schema.Array(Schema.String)),
  adminApiToken: Schema.optionalKey(Schema.String),
})
export type AdminMcpcfConfigPayload = typeof AdminMcpcfConfigPayload.Type

export class AdminMcpcfRefreshDiffItem extends Schema.Class<AdminMcpcfRefreshDiffItem>(
  "AdminMcpcfRefreshDiffItem",
)({
  id: Schema.String,
  slug: Schema.String,
  label: Schema.String,
  reason: Schema.optionalKey(Schema.String),
}) {}

export class AdminMcpcfRefreshFailure extends Schema.Class<AdminMcpcfRefreshFailure>(
  "AdminMcpcfRefreshFailure",
)({
  id: Schema.String,
  slug: Schema.String,
  label: Schema.String,
  reason: Schema.optionalKey(Schema.String),
  error: Schema.String,
}) {}

export class AdminMcpcfRefreshResponse extends Schema.Class<AdminMcpcfRefreshResponse>(
  "AdminMcpcfRefreshResponse",
)({
  added: Schema.Array(AdminMcpcfRefreshDiffItem),
  updated: Schema.Array(AdminMcpcfRefreshDiffItem),
  filtered: Schema.Array(AdminMcpcfRefreshDiffItem),
  blacklisted: Schema.Array(AdminMcpcfRefreshDiffItem),
  missing: Schema.Array(AdminMcpcfRefreshDiffItem),
  unchanged: Schema.Array(AdminMcpcfRefreshDiffItem),
  failures: Schema.Array(AdminMcpcfRefreshFailure),
}) {}

export class AdminMcpcfExportResponse extends Schema.Class<AdminMcpcfExportResponse>(
  "AdminMcpcfExportResponse",
)({
  dotenv: Schema.String,
  variableCount: Schema.Number,
  includesSecret: Schema.Boolean,
  includesRegistry: Schema.Boolean,
  serverCount: Schema.Number,
}) {}

export const AdminAiSearchDataSource = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("built-in"),
  }),
  Schema.Struct({
    type: Schema.Literal("r2"),
    bucketName: Schema.String,
    prefix: Schema.NullOr(Schema.String),
    r2Jurisdiction: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("website"),
    domain: Schema.String,
    includePaths: Schema.Array(Schema.String),
    excludePaths: Schema.Array(Schema.String),
    specificSitemaps: Schema.Array(Schema.String),
    useBrowserRendering: Schema.Boolean,
    includeImages: Schema.Boolean,
  }),
])
export type AdminAiSearchDataSource = typeof AdminAiSearchDataSource.Type

export class AdminAiSearchSource extends Schema.Class<AdminAiSearchSource>("AdminAiSearchSource")({
  id: Schema.String,
  label: Schema.String,
  description: Schema.String,
  enabled: Schema.Boolean,
  maxResults: Schema.Number,
  dataSource: AdminAiSearchDataSource,
  source: Schema.String,
  locked: Schema.Boolean,
  envVarName: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class AdminAiSearchInstance extends Schema.Class<AdminAiSearchInstance>(
  "AdminAiSearchInstance",
)({
  id: Schema.String,
  type: Schema.NullOr(Schema.String),
  source: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.String),
  enabled: Schema.NullOr(Schema.Boolean),
  namespace: Schema.NullOr(Schema.String),
  createdAt: Schema.NullOr(Schema.String),
  modifiedAt: Schema.NullOr(Schema.String),
}) {}

export class AdminAiSearchWorkflowNamespace extends Schema.Class<AdminAiSearchWorkflowNamespace>(
  "AdminAiSearchWorkflowNamespace",
)({
  binding: Schema.String,
  status: Schema.String,
  note: Schema.String,
}) {}

export class AdminAiSearchResponse extends Schema.Class<AdminAiSearchResponse>(
  "AdminAiSearchResponse",
)({
  sources: Schema.Array(AdminAiSearchSource),
  instances: Schema.Array(AdminAiSearchInstance),
  workflowNamespace: AdminAiSearchWorkflowNamespace,
}) {}

export class AdminAiSearchExportResponse extends Schema.Class<AdminAiSearchExportResponse>(
  "AdminAiSearchExportResponse",
)({
  dotenv: Schema.String,
  variableCount: Schema.Number,
  sourceCount: Schema.Number,
}) {}

export const AdminAiSearchSourcePayload = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.String,
  enabled: Schema.Boolean,
  maxResults: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  dataSource: AdminAiSearchDataSource,
})
export type AdminAiSearchSourcePayload = typeof AdminAiSearchSourcePayload.Type

export class AdminCronRunRecord extends Schema.Class<AdminCronRunRecord>("AdminCronRunRecord")({
  id: Schema.String,
  jobId: Schema.String,
  cron: Schema.NullOr(Schema.String),
  trigger: Schema.String,
  status: Schema.String,
  startedAt: Schema.Number,
  finishedAt: Schema.Number,
  durationMs: Schema.Number,
  result: JsonRecord,
  errorMessage: Schema.NullOr(Schema.String),
  actorUserId: Schema.NullOr(Schema.String),
  actorEmail: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
}) {}

export class AdminCronJobStatus extends Schema.Class<AdminCronJobStatus>("AdminCronJobStatus")({
  jobId: Schema.String,
  latestRun: Schema.NullOr(AdminCronRunRecord),
  latestSuccess: Schema.NullOr(AdminCronRunRecord),
  latestFailure: Schema.NullOr(AdminCronRunRecord),
}) {}

export class AdminLitellmConfig extends Schema.Class<AdminLitellmConfig>("AdminLitellmConfig")({
  enabled: Schema.Boolean,
  baseUrl: Schema.String,
  defaultModel: Schema.NullOr(Schema.String),
  defaultReasoningLevel: Schema.NullOr(Schema.String),
  adapterOverrides: Schema.Record(Schema.String, Schema.String),
  source: Schema.String,
  locked: Schema.Boolean,
  envVarName: Schema.NullOr(Schema.String),
  apiKeyConfigured: Schema.Boolean,
  apiKeySource: Schema.String,
  apiKeyLocked: Schema.Boolean,
  apiKeyEnvVarName: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(Schema.Number),
}) {}

export class AdminLitellmModel extends Schema.Class<AdminLitellmModel>("AdminLitellmModel")({
  id: Schema.String,
  provider: Schema.NullOr(Schema.String),
  upstreamModel: Schema.NullOr(Schema.String),
  supportedOpenAIParams: Schema.Array(Schema.String),
  supportsReasoning: Schema.Boolean,
  supportsReasoningEffort: Schema.Boolean,
  supportsThinking: Schema.Boolean,
  contextWindow: Schema.NullOr(Schema.Number),
  maxInputTokens: Schema.NullOr(Schema.Number),
  maxOutputTokens: Schema.NullOr(Schema.Number),
  defaultAdapter: Schema.String,
  adapterOverride: Schema.NullOr(Schema.String),
  aiSdkAdapter: Schema.String,
  reasoningEfforts: Schema.Array(Schema.String),
  defaultReasoningLevel: Schema.NullOr(Schema.String),
  updatedAt: Schema.Number,
}) {}

export class AdminLitellmModelRegistry extends Schema.Class<AdminLitellmModelRegistry>(
  "AdminLitellmModelRegistry",
)({
  providerId: Schema.String,
  baseUrl: Schema.String,
  models: Schema.Record(Schema.String, AdminLitellmModel),
  updatedAt: Schema.Number,
}) {}

export class AdminLitellmProviderResponse extends Schema.Class<AdminLitellmProviderResponse>(
  "AdminLitellmProviderResponse",
)({
  configured: Schema.Boolean,
  config: AdminLitellmConfig,
  registry: Schema.NullOr(AdminLitellmModelRegistry),
  registrySource: Schema.String,
  registryLocked: Schema.Boolean,
  registryEnvVarName: Schema.NullOr(Schema.String),
  cronStatus: AdminCronJobStatus,
}) {}

export class AdminCloudflareAiGatewayModel extends Schema.Class<AdminCloudflareAiGatewayModel>(
  "AdminCloudflareAiGatewayModel",
)({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  reasoningEfforts: Schema.Array(Schema.String),
  defaultReasoningEffort: Schema.NullOr(Schema.String),
}) {}

export class AdminCloudflareAiGatewayProviderKey extends Schema.Class<AdminCloudflareAiGatewayProviderKey>(
  "AdminCloudflareAiGatewayProviderKey",
)({
  providerId: Schema.Literals(["openai", "anthropic", "xai"]),
  name: Schema.String,
  configured: Schema.Boolean,
  source: Schema.Literals(["deployment", "admin", "none"]),
  locked: Schema.Boolean,
  envVarName: Schema.NullOr(Schema.String),
}) {}

export class AdminCloudflareAiGatewayProviderResponse extends Schema.Class<AdminCloudflareAiGatewayProviderResponse>(
  "AdminCloudflareAiGatewayProviderResponse",
)({
  enabled: Schema.Boolean,
  bindingConfigured: Schema.Boolean,
  secretsStoreConfigured: Schema.Boolean,
  gatewayId: Schema.NullOr(Schema.String),
  cacheTtl: Schema.NullOr(Schema.Number),
  collectLogs: Schema.Boolean,
  defaultModel: Schema.NullOr(Schema.String),
  models: Schema.Record(Schema.String, AdminCloudflareAiGatewayModel),
  providerKeys: Schema.Array(AdminCloudflareAiGatewayProviderKey),
}) {}

export const AdminCloudflareAiGatewayProviderKeysPayload = Schema.Struct({
  keys: Schema.Array(
    Schema.Struct({
      providerId: Schema.Literals(["openai", "anthropic", "xai"]),
      apiKey: Schema.optionalKey(Schema.String),
      clearApiKey: Schema.optionalKey(Schema.Boolean),
    }),
  ),
})
export type AdminCloudflareAiGatewayProviderKeysPayload =
  typeof AdminCloudflareAiGatewayProviderKeysPayload.Type

export class AdminAiProvidersResponse extends Schema.Class<AdminAiProvidersResponse>(
  "AdminAiProvidersResponse",
)({
  cloudflareAiGateway: AdminCloudflareAiGatewayProviderResponse,
  litellm: AdminLitellmProviderResponse,
}) {}

export const AdminLitellmConfigPayload = Schema.Struct({
  enabled: Schema.Boolean,
  baseUrl: Schema.String,
  defaultModel: Schema.optionalKey(Schema.NullOr(Schema.String)),
  defaultReasoningLevel: Schema.optionalKey(Schema.NullOr(Schema.String)),
  adapterOverrides: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  apiKey: Schema.optionalKey(Schema.String),
})
export type AdminLitellmConfigPayload = typeof AdminLitellmConfigPayload.Type

export class AdminLitellmSyncResponse extends Schema.Class<AdminLitellmSyncResponse>(
  "AdminLitellmSyncResponse",
)({
  status: Schema.String,
  models: Schema.Number,
  registryUpdatedAt: Schema.NullOr(Schema.Number),
  reason: Schema.optionalKey(Schema.String),
  run: AdminCronRunRecord,
}) {}

export class AdminLitellmExportResponse extends Schema.Class<AdminLitellmExportResponse>(
  "AdminLitellmExportResponse",
)({
  dotenv: Schema.String,
  variableCount: Schema.Number,
  includesSecret: Schema.Boolean,
  includesRegistry: Schema.Boolean,
}) {}

export class AdminActionResponse extends Schema.Class<AdminActionResponse>("AdminActionResponse")({
  status: Schema.String,
  targetType: Schema.String,
  targetId: Schema.String,
  runId: Schema.optionalKey(Schema.String),
}) {}
