import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { DEFAULT_ISOLATE_STEP_LIMIT, DEFAULT_SUBAGENT_MODE } from "@solzero/shared"

function unixMs(name: string) {
  return bigint(name, { mode: "number" })
}

export const globalSecrets = pgTable("global_secrets", {
  key: text("key").primaryKey().notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  tags: text("tags").notNull().default("[]"),
  createdAt: unixMs("created_at").notNull(),
  updatedAt: unixMs("updated_at").notNull(),
})

export const mcpcfConfig = pgTable("mcpcf_config", {
  id: text("id").primaryKey().notNull(),
  enabled: integer("enabled").notNull().default(0),
  baseUrl: text("base_url").notNull().default(""),
  adminApiTokenSecretKey: text("admin_api_token_secret_key")
    .notNull()
    .default("mcpcf.admin-api-token"),
  userOauthProviderId: text("user_oauth_provider_id").notNull().default(""),
  expectedIssuer: text("expected_issuer"),
  authTypeAllowlistJson: text("auth_type_allowlist_json").notNull().default("[]"),
  serverBlacklistJson: text("server_blacklist_json").notNull().default("[]"),
  createdAt: unixMs("created_at").notNull(),
  updatedAt: unixMs("updated_at").notNull(),
})

export const mcpcfServers = pgTable(
  "mcpcf_servers",
  {
    id: text("id").primaryKey().notNull(),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull().default(""),
    authType: text("auth_type"),
    toolCount: integer("tool_count").notNull().default(0),
    toolsJson: text("tools_json").notNull().default("[]"),
    sourceStatus: text("source_status").notNull().default("active"),
    filterReason: text("filter_reason"),
    enabled: integer("enabled").notNull().default(1),
    rawMetadataJson: text("raw_metadata_json").notNull().default("{}"),
    firstSeenAt: unixMs("first_seen_at").notNull(),
    lastSeenAt: unixMs("last_seen_at").notNull(),
    verifiedAt: unixMs("verified_at"),
    updatedAt: unixMs("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_mcpcf_servers_slug").on(table.slug),
    index("idx_mcpcf_servers_status_enabled").on(
      table.sourceStatus,
      table.enabled,
      table.updatedAt,
    ),
  ],
)

export const userMcpcfServerConfigs = pgTable(
  "user_mcpcf_server_configs",
  {
    userId: text("user_id").notNull(),
    serverId: text("server_id").notNull(),
    authTokenSecretKey: text("auth_token_secret_key"),
    defaultToolsEnabled: integer("default_tools_enabled").notNull().default(1),
    disabledToolsJson: text("disabled_tools_json").notNull().default("[]"),
    createdAt: unixMs("created_at").notNull(),
    updatedAt: unixMs("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.serverId] }),
    index("idx_user_mcpcf_server_configs_user").on(table.userId, table.updatedAt),
  ],
)

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    title: text("title"),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    githubInstallationId: unixMs("github_installation_id"),
    githubRepoId: unixMs("github_repo_id"),
    repoDefaultBranch: text("repo_default_branch"),
    branchName: text("branch_name"),
    toolsJson: text("tools_json").notNull().default("[]"),
    customMcpJson: text("custom_mcp_json").notNull().default("{}"),
    secretKeysJson: text("secret_keys_json").notNull().default("[]"),
    isolateStepLimit: integer("isolate_step_limit").notNull().default(DEFAULT_ISOLATE_STEP_LIMIT),
    subagents: text("subagents").notNull().default(DEFAULT_SUBAGENT_MODE),
    model: text("model").notNull(),
    reasoningEffort: text("reasoning_effort"),
    sessionKind: text("session_kind").notNull().default("isolate"),
    agentRuntime: text("agent_runtime").notNull().default("isolate"),
    source: text("source").notNull().default("web"),
    incognito: integer("incognito").notNull().default(0),
    status: text("status").notNull().default("created"),
    createdAt: unixMs("created_at").notNull(),
    updatedAt: unixMs("updated_at").notNull(),
  },
  (table) => [
    index("idx_sessions_status_updated").on(table.userId, table.status, table.updatedAt),
    index("idx_sessions_repo").on(table.userId, table.repoOwner, table.repoName, table.updatedAt),
    index("idx_sessions_github_installation").on(table.githubInstallationId, table.githubRepoId),
  ],
)

export const workflowSessionReuseKeys = pgTable(
  "workflow_session_reuse_keys",
  {
    userId: text("user_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    nodeId: text("node_id").notNull(),
    sessionKind: text("session_kind").notNull(),
    keyHash: text("key_hash").notNull(),
    sessionId: text("session_id").notNull(),
    createdAt: unixMs("created_at").notNull(),
    updatedAt: unixMs("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.workflowId, table.nodeId, table.sessionKind, table.keyHash],
    }),
    index("idx_workflow_session_reuse_keys_session").on(table.sessionId),
  ],
)

export const repoMetadata = pgTable(
  "repo_metadata",
  {
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    description: text("description"),
    aliases: text("aliases"),
    channelAssociations: text("channel_associations"),
    keywords: text("keywords"),
    createdAt: unixMs("created_at").notNull(),
    updatedAt: unixMs("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.repoOwner, table.repoName] })],
)

export const userApiKeys = pgTable(
  "user_api_keys",
  {
    keyId: text("key_id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    label: text("label"),
    keyHash: text("key_hash").notNull(),
    createdAt: unixMs("created_at").notNull(),
    updatedAt: unixMs("updated_at").notNull(),
    lastUsedAt: unixMs("last_used_at"),
    revokedAt: unixMs("revoked_at"),
  },
  (table) => [index("idx_user_api_keys_owner").on(table.userId, table.revokedAt, table.createdAt)],
)

export const userProviderConfigs = pgTable(
  "user_provider_configs",
  {
    userId: text("user_id").notNull(),
    providerId: text("provider_id").notNull(),
    scope: text("scope").notNull(),
    displayName: text("display_name").notNull(),
    npm: text("npm"),
    providerJson: text("provider_json").notNull(),
    apiKeyEncrypted: text("api_key_encrypted"),
    createdAt: unixMs("created_at").notNull(),
    updatedAt: unixMs("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.providerId] }),
    index("idx_user_provider_configs_user_scope").on(table.userId, table.scope, table.updatedAt),
  ],
)

export const userProviderPreferences = pgTable("user_provider_preferences", {
  userId: text("user_id").primaryKey().notNull(),
  defaultModel: text("default_model"),
  defaultIsolateStepLimit: integer("default_isolate_step_limit")
    .notNull()
    .default(DEFAULT_ISOLATE_STEP_LIMIT),
  opencodePermissionJson: text("opencode_permission_json"),
  createdAt: unixMs("created_at").notNull(),
  updatedAt: unixMs("updated_at").notNull(),
})

export const agentSkills = pgTable(
  "agent_skills",
  {
    id: text("id").primaryKey().notNull(),
    scope: text("scope").notNull(),
    ownerUserId: text("owner_user_id"),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    runtimeScope: text("runtime_scope").notNull(),
    origin: text("origin").notNull(),
    sourceId: text("source_id"),
    sourceHash: text("source_hash"),
    contentHash: text("content_hash").notNull(),
    defaultEnabled: integer("default_enabled").notNull().default(0),
    createdByUserId: text("created_by_user_id"),
    createdAt: unixMs("created_at").notNull(),
    updatedAt: unixMs("updated_at").notNull(),
    deletedAt: unixMs("deleted_at"),
  },
  (table) => [
    uniqueIndex("idx_agent_skills_active_global_slug")
      .on(table.slug)
      .where(sql`scope = 'global' AND deleted_at IS NULL`),
    uniqueIndex("idx_agent_skills_active_user_slug")
      .on(table.ownerUserId, table.slug)
      .where(sql`scope = 'user' AND deleted_at IS NULL`),
    index("idx_agent_skills_active_scope_runtime").on(
      table.scope,
      table.runtimeScope,
      table.defaultEnabled,
      table.updatedAt,
    ),
  ],
)

export const userAgentSkillPreferences = pgTable(
  "user_agent_skill_preferences",
  {
    userId: text("user_id").notNull(),
    skillId: text("skill_id")
      .notNull()
      .references(() => agentSkills.id, { onDelete: "cascade" }),
    enabled: integer("enabled").notNull(),
    createdAt: unixMs("created_at").notNull(),
    updatedAt: unixMs("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.skillId] }),
    index("idx_user_agent_skill_preferences_skill").on(table.skillId, table.userId),
  ],
)

export const workflows = pgTable(
  "workflows",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    manifestVersion: integer("manifest_version").notNull(),
    manifestKey: text("manifest_key").notNull(),
    codeKey: text("code_key").notNull(),
    webhookId: text("webhook_id").notNull(),
    createdAt: unixMs("created_at").notNull(),
    updatedAt: unixMs("updated_at").notNull(),
  },
  (table) => [
    index("idx_workflows_owner_updated").on(table.userId, table.status, table.updatedAt),
    uniqueIndex("idx_workflows_webhook_id").on(table.webhookId),
  ],
)

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: text("id").primaryKey().notNull(),
    workflowId: text("workflow_id").notNull(),
    workflowVersion: integer("workflow_version").notNull(),
    workflowInstanceId: text("workflow_instance_id"),
    userId: text("user_id").notNull(),
    triggerKind: text("trigger_kind").notNull(),
    triggerNodeId: text("trigger_node_id"),
    status: text("status").notNull(),
    inputJson: text("input_json").notNull().default("{}"),
    outputJson: text("output_json"),
    error: text("error"),
    startedAt: unixMs("started_at").notNull(),
    completedAt: unixMs("completed_at"),
    updatedAt: unixMs("updated_at").notNull(),
  },
  (table) => [
    index("idx_workflow_runs_workflow_updated").on(table.workflowId, table.status, table.updatedAt),
  ],
)

export const workflowSlackApps = pgTable(
  "workflow_slack_apps",
  {
    id: text("id").primaryKey().notNull(),
    workflowId: text("workflow_id").notNull(),
    userId: text("user_id").notNull(),
    appName: text("app_name").notNull(),
    signingSecretKey: text("signing_secret_key").notNull(),
    botTokenSecretKey: text("bot_token_secret_key").notNull(),
    createdAt: unixMs("created_at").notNull(),
    updatedAt: unixMs("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_workflow_slack_apps_workflow").on(table.workflowId),
    index("idx_workflow_slack_apps_owner").on(table.userId, table.updatedAt),
  ],
)

export const workflowSlackTriggerRegistrations = pgTable(
  "workflow_slack_trigger_registrations",
  {
    id: text("id").primaryKey().notNull(),
    slackAppId: text("slack_app_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    workflowVersion: integer("workflow_version").notNull(),
    nodeId: text("node_id").notNull(),
    surface: text("surface").notNull(),
    commandName: text("command_name"),
    eventTypesJson: text("event_types_json").notNull().default("[]"),
    channelNamePattern: text("channel_name_pattern"),
    keywordRulesJson: text("keyword_rules_json").notNull().default("[]"),
    actionIdsJson: text("action_ids_json").notNull().default("[]"),
    cooldownSeconds: integer("cooldown_seconds").notNull().default(0),
    dedupeWindowSeconds: integer("dedupe_window_seconds").notNull().default(300),
    enabled: integer("enabled").notNull().default(1),
    createdAt: unixMs("created_at").notNull(),
    updatedAt: unixMs("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_workflow_slack_trigger_node").on(table.workflowId, table.nodeId),
    index("idx_workflow_slack_trigger_app_surface").on(
      table.slackAppId,
      table.surface,
      table.enabled,
    ),
    index("idx_workflow_slack_trigger_workflow").on(table.workflowId, table.enabled),
  ],
)

export const workflowSlackDeliveries = pgTable(
  "workflow_slack_deliveries",
  {
    id: text("id").primaryKey().notNull(),
    slackAppId: text("slack_app_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    nodeId: text("node_id").notNull(),
    deliveryKey: text("delivery_key").notNull(),
    surface: text("surface").notNull(),
    runId: text("run_id"),
    status: text("status").notNull(),
    error: text("error"),
    createdAt: unixMs("created_at").notNull(),
    updatedAt: unixMs("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_workflow_slack_deliveries_dedupe").on(
      table.slackAppId,
      table.nodeId,
      table.deliveryKey,
    ),
    index("idx_workflow_slack_deliveries_node_created").on(
      table.slackAppId,
      table.nodeId,
      table.createdAt,
    ),
  ],
)

export const workflowRunEvents = pgTable(
  "workflow_run_events",
  {
    id: text("id").primaryKey().notNull(),
    workflowId: text("workflow_id").notNull(),
    runId: text("run_id").notNull(),
    sequence: integer("sequence").notNull(),
    nodeId: text("node_id"),
    eventType: text("event_type").notNull(),
    level: text("level").notNull().default("info"),
    message: text("message").notNull(),
    dataJson: text("data_json").notNull().default("{}"),
    createdAt: unixMs("created_at").notNull(),
  },
  (table) => [
    index("idx_workflow_run_events_run_sequence").on(table.runId, table.sequence),
    index("idx_workflow_run_events_workflow_created").on(table.workflowId, table.createdAt),
  ],
)

export const bots = pgTable(
  "bots",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    instructions: text("instructions").notNull().default(""),
    sessionId: text("session_id"),
    status: text("status").notNull().default("active"),
    createdAt: unixMs("created_at").notNull(),
    updatedAt: unixMs("updated_at").notNull(),
  },
  (table) => [
    index("idx_bots_owner_updated").on(table.userId, table.status, table.updatedAt),
    index("idx_bots_session").on(table.sessionId),
  ],
)

export const botRoutines = pgTable(
  "bot_routines",
  {
    id: text("id").primaryKey().notNull(),
    botId: text("bot_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    cadenceJson: text("cadence_json").notNull(),
    prompt: text("prompt").notNull(),
    until: unixMs("until"),
    watchJson: text("watch_json").notNull().default('{"kind":"none"}'),
    status: text("status").notNull().default("active"),
    lastRunAt: unixMs("last_run_at"),
    createdAt: unixMs("created_at").notNull(),
    updatedAt: unixMs("updated_at").notNull(),
  },
  (table) => [
    index("idx_bot_routines_bot_updated").on(table.botId, table.status, table.updatedAt),
    index("idx_bot_routines_owner_updated").on(table.userId, table.status, table.updatedAt),
  ],
)

export const cronRuns = pgTable(
  "cron_runs",
  {
    id: text("id").primaryKey().notNull(),
    jobId: text("job_id").notNull(),
    cron: text("cron"),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    startedAt: unixMs("started_at").notNull(),
    finishedAt: unixMs("finished_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
    resultJson: text("result_json").notNull().default("{}"),
    errorMessage: text("error_message"),
    actorUserId: text("actor_user_id"),
    actorEmail: text("actor_email"),
    createdAt: unixMs("created_at").notNull(),
  },
  (table) => [
    index("idx_cron_runs_job_created").on(table.jobId, table.createdAt),
    index("idx_cron_runs_job_status_created").on(table.jobId, table.status, table.createdAt),
  ],
)

export const adminAuditEvents = pgTable(
  "admin_audit_events",
  {
    id: text("id").primaryKey().notNull(),
    adminUserId: text("admin_user_id").notNull(),
    adminEmail: text("admin_email").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    action: text("action").notNull(),
    reason: text("reason"),
    result: text("result").notNull(),
    status: integer("status").notNull(),
    message: text("message"),
    createdAt: unixMs("created_at").notNull(),
  },
  (table) => [
    index("idx_admin_audit_events_created").on(table.createdAt),
    index("idx_admin_audit_events_target").on(table.targetType, table.targetId, table.createdAt),
  ],
)

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("emailVerified").notNull().default(false),
    image: text("image"),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => [uniqueIndex("idx_user_email").on(table.email)],
)

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("userId").notNull(),
    token: text("token").notNull(),
    expiresAt: text("expiresAt").notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => [
    uniqueIndex("idx_session_token").on(table.token),
    index("idx_session_userId").on(table.userId),
  ],
)

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("userId").notNull(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: text("accessTokenExpiresAt"),
    refreshTokenExpiresAt: text("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => [
    uniqueIndex("idx_account_provider_account").on(table.providerId, table.accountId),
    index("idx_account_userId").on(table.userId),
  ],
)

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey().notNull(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: text("expiresAt").notNull(),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => [index("idx_verification_identifier").on(table.identifier)],
)

export const managedAdminCredential = pgTable(
  "managed_admin_credential",
  {
    userId: text("userId").primaryKey().notNull(),
    email: text("email").notNull(),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => [uniqueIndex("idx_managed_admin_credential_email").on(table.email)],
)
