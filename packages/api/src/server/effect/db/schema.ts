import { sql } from "drizzle-orm"
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { DEFAULT_ISOLATE_STEP_LIMIT, DEFAULT_SUBAGENT_MODE } from "@c0-agent/shared"

export const repoSecrets = sqliteTable(
  "repo_secrets",
  {
    repoId: integer("repo_id").notNull(),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    key: text("key").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.key] }),
    index("idx_repo_secrets_repo_name").on(table.repoOwner, table.repoName),
  ],
)

export const globalSecrets = sqliteTable("global_secrets", {
  key: text("key").primaryKey().notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  tags: text("tags").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
})

export const mcpcfConfig = sqliteTable("mcpcf_config", {
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
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
})

export const mcpcfServers = sqliteTable(
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
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    verifiedAt: integer("verified_at"),
    updatedAt: integer("updated_at").notNull(),
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

export const userMcpcfServerConfigs = sqliteTable(
  "user_mcpcf_server_configs",
  {
    userId: text("user_id").notNull(),
    serverId: text("server_id").notNull(),
    authTokenSecretKey: text("auth_token_secret_key"),
    defaultToolsEnabled: integer("default_tools_enabled").notNull().default(1),
    disabledToolsJson: text("disabled_tools_json").notNull().default("[]"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.serverId] }),
    index("idx_user_mcpcf_server_configs_user").on(table.userId, table.updatedAt),
  ],
)

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    title: text("title"),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    githubInstallationId: integer("github_installation_id"),
    githubRepoId: integer("github_repo_id"),
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
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_sessions_status_updated").on(table.userId, table.status, table.updatedAt),
    index("idx_sessions_repo").on(table.userId, table.repoOwner, table.repoName, table.updatedAt),
  ],
)

export const workflowSessionReuseKeys = sqliteTable(
  "workflow_session_reuse_keys",
  {
    userId: text("user_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    nodeId: text("node_id").notNull(),
    sessionKind: text("session_kind").notNull(),
    keyHash: text("key_hash").notNull(),
    sessionId: text("session_id").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.workflowId, table.nodeId, table.sessionKind, table.keyHash],
    }),
    index("idx_workflow_session_reuse_keys_session").on(table.sessionId),
  ],
)

export const repoMetadata = sqliteTable(
  "repo_metadata",
  {
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    description: text("description"),
    aliases: text("aliases"),
    channelAssociations: text("channel_associations"),
    keywords: text("keywords"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.repoOwner, table.repoName] })],
)

export const userApiKeys = sqliteTable(
  "user_api_keys",
  {
    keyId: text("key_id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    label: text("label"),
    keyHash: text("key_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastUsedAt: integer("last_used_at"),
    revokedAt: integer("revoked_at"),
  },
  (table) => [index("idx_user_api_keys_owner").on(table.userId, table.revokedAt, table.createdAt)],
)

export const userProviderConfigs = sqliteTable(
  "user_provider_configs",
  {
    userId: text("user_id").notNull(),
    providerId: text("provider_id").notNull(),
    scope: text("scope").notNull(),
    displayName: text("display_name").notNull(),
    npm: text("npm"),
    providerJson: text("provider_json").notNull(),
    apiKeyEncrypted: text("api_key_encrypted"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.providerId] }),
    index("idx_user_provider_configs_user_scope").on(table.userId, table.scope, table.updatedAt),
  ],
)

export const userProviderPreferences = sqliteTable("user_provider_preferences", {
  userId: text("user_id").primaryKey().notNull(),
  defaultModel: text("default_model"),
  defaultIsolateStepLimit: integer("default_isolate_step_limit")
    .notNull()
    .default(DEFAULT_ISOLATE_STEP_LIMIT),
  opencodePermissionJson: text("opencode_permission_json"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
})

export const agentSkills = sqliteTable(
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
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
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

export const userAgentSkillPreferences = sqliteTable(
  "user_agent_skill_preferences",
  {
    userId: text("user_id").notNull(),
    skillId: text("skill_id")
      .notNull()
      .references(() => agentSkills.id, { onDelete: "cascade" }),
    enabled: integer("enabled").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.skillId] }),
    index("idx_user_agent_skill_preferences_skill").on(table.skillId, table.userId),
  ],
)

export const workflows = sqliteTable(
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
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_workflows_owner_updated").on(table.userId, table.status, table.updatedAt),
    uniqueIndex("idx_workflows_webhook_id").on(table.webhookId),
  ],
)

export const workflowRuns = sqliteTable(
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
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_workflow_runs_workflow_updated").on(table.workflowId, table.status, table.updatedAt),
  ],
)

export const workflowSlackApps = sqliteTable(
  "workflow_slack_apps",
  {
    id: text("id").primaryKey().notNull(),
    workflowId: text("workflow_id").notNull(),
    userId: text("user_id").notNull(),
    appName: text("app_name").notNull(),
    signingSecretKey: text("signing_secret_key").notNull(),
    botTokenSecretKey: text("bot_token_secret_key").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_workflow_slack_apps_workflow").on(table.workflowId),
    index("idx_workflow_slack_apps_owner").on(table.userId, table.updatedAt),
  ],
)

export const workflowSlackTriggerRegistrations = sqliteTable(
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
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const workflowSlackDeliveries = sqliteTable(
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
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const workflowRunEvents = sqliteTable(
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
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_workflow_run_events_run_sequence").on(table.runId, table.sequence),
    index("idx_workflow_run_events_workflow_created").on(table.workflowId, table.createdAt),
  ],
)

export const cronRuns = sqliteTable(
  "cron_runs",
  {
    id: text("id").primaryKey().notNull(),
    jobId: text("job_id").notNull(),
    cron: text("cron"),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
    resultJson: text("result_json").notNull().default("{}"),
    errorMessage: text("error_message"),
    actorUserId: text("actor_user_id"),
    actorEmail: text("actor_email"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_cron_runs_job_created").on(table.jobId, table.createdAt),
    index("idx_cron_runs_job_status_created").on(table.jobId, table.status, table.createdAt),
  ],
)

export const adminAuditEvents = sqliteTable(
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
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_admin_audit_events_created").on(table.createdAt),
    index("idx_admin_audit_events_target").on(table.targetType, table.targetId, table.createdAt),
  ],
)

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("emailVerified").notNull().default(0),
    image: text("image"),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => [uniqueIndex("idx_user_email").on(table.email)],
)

export const session = sqliteTable(
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

export const account = sqliteTable(
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

export const verification = sqliteTable(
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
