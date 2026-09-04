import type { Table } from "drizzle-orm"
import * as sqliteSchema from "../server/effect/db/schema"
import * as pgSchema from "../server/effect/db/schema.pg"

export interface ControlPlaneCopyTable {
  readonly name: string
  readonly sqlite: Table
  readonly postgres: Table
  readonly primaryKeys: readonly string[]
}

/**
 * Control-plane tables only, in FK-safe create order from the postgres tree.
 * Excludes Durable Object sqlite, R2, AI Search, and the retired repo_secrets table.
 */
export const CONTROL_PLANE_COPY_TABLES: readonly ControlPlaneCopyTable[] = [
  {
    name: "global_secrets",
    sqlite: sqliteSchema.globalSecrets,
    postgres: pgSchema.globalSecrets,
    primaryKeys: ["key"],
  },
  {
    name: "mcpcf_config",
    sqlite: sqliteSchema.mcpcfConfig,
    postgres: pgSchema.mcpcfConfig,
    primaryKeys: ["id"],
  },
  {
    name: "mcpcf_servers",
    sqlite: sqliteSchema.mcpcfServers,
    postgres: pgSchema.mcpcfServers,
    primaryKeys: ["id"],
  },
  {
    name: "user_mcpcf_server_configs",
    sqlite: sqliteSchema.userMcpcfServerConfigs,
    postgres: pgSchema.userMcpcfServerConfigs,
    primaryKeys: ["userId", "serverId"],
  },
  {
    name: "sessions",
    sqlite: sqliteSchema.sessions,
    postgres: pgSchema.sessions,
    primaryKeys: ["id"],
  },
  {
    name: "workflow_session_reuse_keys",
    sqlite: sqliteSchema.workflowSessionReuseKeys,
    postgres: pgSchema.workflowSessionReuseKeys,
    primaryKeys: ["userId", "workflowId", "nodeId", "sessionKind", "keyHash"],
  },
  {
    name: "repo_metadata",
    sqlite: sqliteSchema.repoMetadata,
    postgres: pgSchema.repoMetadata,
    primaryKeys: ["repoOwner", "repoName"],
  },
  {
    name: "user_api_keys",
    sqlite: sqliteSchema.userApiKeys,
    postgres: pgSchema.userApiKeys,
    primaryKeys: ["keyId"],
  },
  {
    name: "user_provider_configs",
    sqlite: sqliteSchema.userProviderConfigs,
    postgres: pgSchema.userProviderConfigs,
    primaryKeys: ["userId", "providerId"],
  },
  {
    name: "user_provider_preferences",
    sqlite: sqliteSchema.userProviderPreferences,
    postgres: pgSchema.userProviderPreferences,
    primaryKeys: ["userId"],
  },
  {
    name: "agent_skills",
    sqlite: sqliteSchema.agentSkills,
    postgres: pgSchema.agentSkills,
    primaryKeys: ["id"],
  },
  {
    name: "user_agent_skill_preferences",
    sqlite: sqliteSchema.userAgentSkillPreferences,
    postgres: pgSchema.userAgentSkillPreferences,
    primaryKeys: ["userId", "skillId"],
  },
  {
    name: "workflows",
    sqlite: sqliteSchema.workflows,
    postgres: pgSchema.workflows,
    primaryKeys: ["id"],
  },
  {
    name: "workflow_runs",
    sqlite: sqliteSchema.workflowRuns,
    postgres: pgSchema.workflowRuns,
    primaryKeys: ["id"],
  },
  {
    name: "workflow_slack_apps",
    sqlite: sqliteSchema.workflowSlackApps,
    postgres: pgSchema.workflowSlackApps,
    primaryKeys: ["id"],
  },
  {
    name: "workflow_slack_trigger_registrations",
    sqlite: sqliteSchema.workflowSlackTriggerRegistrations,
    postgres: pgSchema.workflowSlackTriggerRegistrations,
    primaryKeys: ["id"],
  },
  {
    name: "workflow_slack_deliveries",
    sqlite: sqliteSchema.workflowSlackDeliveries,
    postgres: pgSchema.workflowSlackDeliveries,
    primaryKeys: ["id"],
  },
  {
    name: "workflow_run_events",
    sqlite: sqliteSchema.workflowRunEvents,
    postgres: pgSchema.workflowRunEvents,
    primaryKeys: ["id"],
  },
  {
    name: "bots",
    sqlite: sqliteSchema.bots,
    postgres: pgSchema.bots,
    primaryKeys: ["id"],
  },
  {
    name: "bot_routines",
    sqlite: sqliteSchema.botRoutines,
    postgres: pgSchema.botRoutines,
    primaryKeys: ["id"],
  },
  {
    name: "cron_runs",
    sqlite: sqliteSchema.cronRuns,
    postgres: pgSchema.cronRuns,
    primaryKeys: ["id"],
  },
  {
    name: "admin_audit_events",
    sqlite: sqliteSchema.adminAuditEvents,
    postgres: pgSchema.adminAuditEvents,
    primaryKeys: ["id"],
  },
  {
    name: "user",
    sqlite: sqliteSchema.user,
    postgres: pgSchema.user,
    primaryKeys: ["id"],
  },
  {
    name: "session",
    sqlite: sqliteSchema.session,
    postgres: pgSchema.session,
    primaryKeys: ["id"],
  },
  {
    name: "account",
    sqlite: sqliteSchema.account,
    postgres: pgSchema.account,
    primaryKeys: ["id"],
  },
  {
    name: "verification",
    sqlite: sqliteSchema.verification,
    postgres: pgSchema.verification,
    primaryKeys: ["id"],
  },
  {
    name: "managed_admin_credential",
    sqlite: sqliteSchema.managedAdminCredential,
    postgres: pgSchema.managedAdminCredential,
    primaryKeys: ["userId"],
  },
]
