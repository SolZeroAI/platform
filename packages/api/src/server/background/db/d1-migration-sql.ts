/* Generated from packages/infra/d1-migrations. Run `nub exec tsx scripts/embed-d1-migrations.ts`. */
export interface D1MigrationSql {
  readonly id: string
  readonly sql: string
}

export const D1_MIGRATION_SQL: readonly D1MigrationSql[] = [
  {
    id: "0001_initial.sql",
    sql: "CREATE TABLE IF NOT EXISTS repo_secrets (\n  repo_id         INTEGER NOT NULL,\n  repo_owner      TEXT    NOT NULL,\n  repo_name       TEXT    NOT NULL,\n  key             TEXT    NOT NULL,\n  encrypted_value TEXT    NOT NULL,\n  created_at      INTEGER NOT NULL,\n  updated_at      INTEGER NOT NULL,\n  PRIMARY KEY (repo_id, key)\n);\n\nCREATE INDEX IF NOT EXISTS idx_repo_secrets_repo_name\n  ON repo_secrets (repo_owner, repo_name);\n\nCREATE TABLE IF NOT EXISTS global_secrets (\n  key             TEXT    NOT NULL PRIMARY KEY,\n  encrypted_value TEXT    NOT NULL,\n  created_at      INTEGER NOT NULL,\n  updated_at      INTEGER NOT NULL\n);\n",
  },
  {
    id: "0002_session_index.sql",
    sql: "CREATE TABLE IF NOT EXISTS sessions (\n  id               TEXT    PRIMARY KEY,\n  user_id          TEXT    NOT NULL,\n  title            TEXT,\n  repo_owner       TEXT    NOT NULL,\n  repo_name        TEXT    NOT NULL,\n  model            TEXT    NOT NULL,\n  reasoning_effort TEXT,\n  status           TEXT    NOT NULL DEFAULT 'created',\n  created_at       INTEGER NOT NULL,\n  updated_at       INTEGER NOT NULL\n);\n\nCREATE INDEX IF NOT EXISTS idx_sessions_status_updated\n  ON sessions (user_id, status, updated_at DESC);\n\nCREATE INDEX IF NOT EXISTS idx_sessions_repo\n  ON sessions (user_id, repo_owner, repo_name, updated_at DESC);\n\nCREATE TABLE IF NOT EXISTS repo_metadata (\n  repo_owner           TEXT NOT NULL,\n  repo_name            TEXT NOT NULL,\n  description          TEXT,\n  aliases              TEXT,\n  channel_associations TEXT,\n  keywords             TEXT,\n  created_at           INTEGER NOT NULL,\n  updated_at           INTEGER NOT NULL,\n  PRIMARY KEY (repo_owner, repo_name)\n);\n",
  },
  {
    id: "0003_prefix_model_ids.sql",
    sql: "UPDATE sessions\nSET model = 'anthropic/' || model\nWHERE model LIKE 'claude-%';\n",
  },
  {
    id: "0004_oauth_identity.sql",
    sql: "CREATE TABLE IF NOT EXISTS user_api_keys (\n  key_id         TEXT    NOT NULL PRIMARY KEY,\n  user_id        TEXT    NOT NULL,\n  label          TEXT,\n  key_hash       TEXT    NOT NULL,\n  created_at     INTEGER NOT NULL,\n  updated_at     INTEGER NOT NULL,\n  last_used_at   INTEGER,\n  revoked_at     INTEGER\n);\n\nCREATE INDEX IF NOT EXISTS idx_user_api_keys_owner\n  ON user_api_keys (user_id, revoked_at, created_at DESC);\n",
  },
  {
    id: "0005_user_provider_configs.sql",
    sql: "CREATE TABLE IF NOT EXISTS user_provider_configs (\n  user_id           TEXT    NOT NULL,\n  provider_id       TEXT    NOT NULL,\n  scope             TEXT    NOT NULL,\n  display_name      TEXT    NOT NULL,\n  npm               TEXT,\n  provider_json     TEXT    NOT NULL,\n  api_key_encrypted TEXT,\n  created_at        INTEGER NOT NULL,\n  updated_at        INTEGER NOT NULL,\n  PRIMARY KEY (user_id, provider_id)\n);\n\nCREATE INDEX IF NOT EXISTS idx_user_provider_configs_user_scope\n  ON user_provider_configs (user_id, scope, updated_at DESC);\n\nCREATE TABLE IF NOT EXISTS user_provider_preferences (\n  user_id       TEXT    NOT NULL PRIMARY KEY,\n  default_model  TEXT,\n  created_at     INTEGER NOT NULL,\n  updated_at     INTEGER NOT NULL\n);\n",
  },
  {
    id: "0006_better_auth.sql",
    sql: 'CREATE TABLE IF NOT EXISTS "user" (\n  "id" TEXT NOT NULL PRIMARY KEY,\n  "name" TEXT NOT NULL,\n  "email" TEXT NOT NULL,\n  "emailVerified" INTEGER NOT NULL DEFAULT 0,\n  "image" TEXT,\n  "createdAt" TEXT NOT NULL,\n  "updatedAt" TEXT NOT NULL\n);\n\nCREATE UNIQUE INDEX IF NOT EXISTS "idx_user_email"\n  ON "user" ("email");\n\nCREATE TABLE IF NOT EXISTS "session" (\n  "id" TEXT NOT NULL PRIMARY KEY,\n  "userId" TEXT NOT NULL,\n  "token" TEXT NOT NULL,\n  "expiresAt" TEXT NOT NULL,\n  "ipAddress" TEXT,\n  "userAgent" TEXT,\n  "createdAt" TEXT NOT NULL,\n  "updatedAt" TEXT NOT NULL\n);\n\nCREATE UNIQUE INDEX IF NOT EXISTS "idx_session_token"\n  ON "session" ("token");\n\nCREATE INDEX IF NOT EXISTS "idx_session_userId"\n  ON "session" ("userId");\n\nCREATE TABLE IF NOT EXISTS "account" (\n  "id" TEXT NOT NULL PRIMARY KEY,\n  "userId" TEXT NOT NULL,\n  "accountId" TEXT NOT NULL,\n  "providerId" TEXT NOT NULL,\n  "accessToken" TEXT,\n  "refreshToken" TEXT,\n  "idToken" TEXT,\n  "accessTokenExpiresAt" TEXT,\n  "refreshTokenExpiresAt" TEXT,\n  "scope" TEXT,\n  "password" TEXT,\n  "createdAt" TEXT NOT NULL,\n  "updatedAt" TEXT NOT NULL\n);\n\nCREATE UNIQUE INDEX IF NOT EXISTS "idx_account_provider_account"\n  ON "account" ("providerId", "accountId");\n\nCREATE INDEX IF NOT EXISTS "idx_account_userId"\n  ON "account" ("userId");\n\nCREATE TABLE IF NOT EXISTS "verification" (\n  "id" TEXT NOT NULL PRIMARY KEY,\n  "identifier" TEXT NOT NULL,\n  "value" TEXT NOT NULL,\n  "expiresAt" TEXT NOT NULL,\n  "createdAt" TEXT NOT NULL,\n  "updatedAt" TEXT NOT NULL\n);\n\nCREATE INDEX IF NOT EXISTS "idx_verification_identifier"\n  ON "verification" ("identifier");\n',
  },
  {
    id: "0007_session_tools.sql",
    sql: "ALTER TABLE sessions ADD COLUMN tools_json TEXT NOT NULL DEFAULT '[]';\n",
  },
  {
    id: "0008_session_custom_mcps.sql",
    sql: "ALTER TABLE sessions ADD COLUMN custom_mcp_json TEXT NOT NULL DEFAULT '{}';\n",
  },
  {
    id: "0009_session_opencode_host_key.sql",
    sql: "ALTER TABLE sessions ADD COLUMN opencode_host_key TEXT;\n\nCREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_opencode_host_key\n  ON sessions (opencode_host_key);\n",
  },
  {
    id: "0010_session_kind.sql",
    sql: "ALTER TABLE sessions ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'isolate';\n",
  },
  {
    id: "0011_drop_session_opencode_host_key.sql",
    sql: "DROP INDEX IF EXISTS idx_sessions_opencode_host_key;\n\nALTER TABLE sessions DROP COLUMN opencode_host_key;\n",
  },
  {
    id: "0012_session_source.sql",
    sql: "ALTER TABLE sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'web';\n",
  },
  {
    id: "0013_workflows.sql",
    sql: "CREATE TABLE IF NOT EXISTS workflows (\n  id               TEXT    PRIMARY KEY,\n  user_id          TEXT    NOT NULL,\n  name             TEXT    NOT NULL,\n  status           TEXT    NOT NULL DEFAULT 'active',\n  manifest_version INTEGER NOT NULL,\n  manifest_key     TEXT    NOT NULL,\n  code_key         TEXT    NOT NULL,\n  webhook_id       TEXT    NOT NULL,\n  created_at       INTEGER NOT NULL,\n  updated_at       INTEGER NOT NULL\n);\n\nCREATE INDEX IF NOT EXISTS idx_workflows_owner_updated\n  ON workflows (user_id, status, updated_at DESC);\n\nCREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_webhook_id\n  ON workflows (webhook_id);\n\nCREATE TABLE IF NOT EXISTS workflow_runs (\n  id                   TEXT    PRIMARY KEY,\n  workflow_id          TEXT    NOT NULL,\n  workflow_version     INTEGER NOT NULL,\n  workflow_instance_id TEXT,\n  user_id              TEXT    NOT NULL,\n  trigger_kind         TEXT    NOT NULL,\n  trigger_node_id      TEXT,\n  status               TEXT    NOT NULL,\n  input_json           TEXT    NOT NULL DEFAULT '{}',\n  output_json          TEXT,\n  error                TEXT,\n  started_at           INTEGER NOT NULL,\n  completed_at         INTEGER,\n  updated_at           INTEGER NOT NULL\n);\n\nCREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_updated\n  ON workflow_runs (workflow_id, status, updated_at DESC);\n\nCREATE TABLE IF NOT EXISTS workflow_run_events (\n  id          TEXT    PRIMARY KEY,\n  workflow_id TEXT    NOT NULL,\n  run_id      TEXT    NOT NULL,\n  sequence    INTEGER NOT NULL,\n  node_id     TEXT,\n  event_type  TEXT    NOT NULL,\n  level       TEXT    NOT NULL DEFAULT 'info',\n  message     TEXT    NOT NULL,\n  data_json   TEXT    NOT NULL DEFAULT '{}',\n  created_at  INTEGER NOT NULL\n);\n\nCREATE INDEX IF NOT EXISTS idx_workflow_run_events_run_sequence\n  ON workflow_run_events (run_id, sequence ASC);\n\nCREATE INDEX IF NOT EXISTS idx_workflow_run_events_workflow_created\n  ON workflow_run_events (workflow_id, created_at DESC);\n",
  },
  {
    id: "0014_admin_audit_events.sql",
    sql: "CREATE TABLE IF NOT EXISTS admin_audit_events (\n  id            TEXT    PRIMARY KEY,\n  admin_user_id TEXT    NOT NULL,\n  admin_email   TEXT    NOT NULL,\n  target_type   TEXT    NOT NULL,\n  target_id     TEXT    NOT NULL,\n  action        TEXT    NOT NULL,\n  reason        TEXT,\n  result        TEXT    NOT NULL,\n  status        INTEGER NOT NULL,\n  message       TEXT,\n  created_at    INTEGER NOT NULL\n);\n\nCREATE INDEX IF NOT EXISTS idx_admin_audit_events_created\n  ON admin_audit_events (created_at DESC);\n\nCREATE INDEX IF NOT EXISTS idx_admin_audit_events_target\n  ON admin_audit_events (target_type, target_id, created_at DESC);\n",
  },
  {
    id: "0015_github_app_session_metadata.sql",
    sql: "ALTER TABLE sessions ADD COLUMN github_installation_id INTEGER;\nALTER TABLE sessions ADD COLUMN github_repo_id INTEGER;\nALTER TABLE sessions ADD COLUMN repo_default_branch TEXT;\nALTER TABLE sessions ADD COLUMN branch_name TEXT;\n\nCREATE INDEX IF NOT EXISTS idx_sessions_github_installation\n  ON sessions (github_installation_id, github_repo_id);\n",
  },
  {
    id: "0016_workflow_session_reuse_and_incognito.sql",
    sql: "ALTER TABLE sessions ADD COLUMN incognito INTEGER NOT NULL DEFAULT 0;\n\nCREATE TABLE IF NOT EXISTS workflow_session_reuse_keys (\n  user_id      TEXT    NOT NULL,\n  workflow_id  TEXT    NOT NULL,\n  node_id      TEXT    NOT NULL,\n  session_kind TEXT    NOT NULL,\n  key_hash     TEXT    NOT NULL,\n  session_id   TEXT    NOT NULL,\n  created_at   INTEGER NOT NULL,\n  updated_at   INTEGER NOT NULL,\n  PRIMARY KEY (user_id, workflow_id, node_id, session_kind, key_hash)\n);\n\nCREATE INDEX IF NOT EXISTS idx_workflow_session_reuse_keys_session\n  ON workflow_session_reuse_keys (session_id);\n",
  },
  {
    id: "0017_mcpcf_registry.sql",
    sql: "CREATE TABLE IF NOT EXISTS mcpcf_config (\n  id TEXT PRIMARY KEY NOT NULL,\n  enabled INTEGER NOT NULL DEFAULT 0,\n  base_url TEXT NOT NULL DEFAULT '',\n  admin_api_token_secret_key TEXT NOT NULL DEFAULT 'mcpcf.admin-api-token',\n  user_oauth_provider_id TEXT NOT NULL DEFAULT '',\n  expected_issuer TEXT,\n  auth_type_allowlist_json TEXT NOT NULL DEFAULT '[]',\n  server_blacklist_json TEXT NOT NULL DEFAULT '[]',\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS mcpcf_servers (\n  id TEXT PRIMARY KEY NOT NULL,\n  slug TEXT NOT NULL,\n  label TEXT NOT NULL,\n  description TEXT NOT NULL DEFAULT '',\n  auth_type TEXT,\n  tool_count INTEGER NOT NULL DEFAULT 0,\n  tools_json TEXT NOT NULL DEFAULT '[]',\n  source_status TEXT NOT NULL DEFAULT 'active',\n  filter_reason TEXT,\n  enabled INTEGER NOT NULL DEFAULT 1,\n  raw_metadata_json TEXT NOT NULL DEFAULT '{}',\n  first_seen_at INTEGER NOT NULL,\n  last_seen_at INTEGER NOT NULL,\n  verified_at INTEGER,\n  updated_at INTEGER NOT NULL\n);\n\nCREATE UNIQUE INDEX IF NOT EXISTS idx_mcpcf_servers_slug ON mcpcf_servers(slug);\nCREATE INDEX IF NOT EXISTS idx_mcpcf_servers_status_enabled ON mcpcf_servers(source_status, enabled, updated_at);\n\nUPDATE sessions\nSET tools_json = replace(tools_json, '\"kind\":\"context_forge_server\"', '\"kind\":\"mcpcf_server\"')\nWHERE tools_json LIKE '%\"context_forge_server\"%';\n",
  },
  {
    id: "0018_isolate_step_limits.sql",
    sql: "ALTER TABLE sessions\n  ADD COLUMN isolate_step_limit INTEGER NOT NULL DEFAULT 8;\n\nALTER TABLE user_provider_preferences\n  ADD COLUMN default_isolate_step_limit INTEGER NOT NULL DEFAULT 8;\n",
  },
  {
    id: "0019_workflow_slack_apps.sql",
    sql: "CREATE TABLE IF NOT EXISTS workflow_slack_apps (\n  id TEXT PRIMARY KEY NOT NULL,\n  workflow_id TEXT NOT NULL,\n  user_id TEXT NOT NULL,\n  app_name TEXT NOT NULL,\n  signing_secret_key TEXT NOT NULL,\n  bot_token_secret_key TEXT NOT NULL,\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n);\n\nCREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_slack_apps_workflow\n  ON workflow_slack_apps (workflow_id);\n\nCREATE INDEX IF NOT EXISTS idx_workflow_slack_apps_owner\n  ON workflow_slack_apps (user_id, updated_at DESC);\n\nCREATE TABLE IF NOT EXISTS workflow_slack_trigger_registrations (\n  id TEXT PRIMARY KEY NOT NULL,\n  slack_app_id TEXT NOT NULL,\n  workflow_id TEXT NOT NULL,\n  workflow_version INTEGER NOT NULL,\n  node_id TEXT NOT NULL,\n  surface TEXT NOT NULL,\n  command_name TEXT,\n  event_types_json TEXT NOT NULL DEFAULT '[]',\n  channel_name_pattern TEXT,\n  keyword_rules_json TEXT NOT NULL DEFAULT '[]',\n  action_ids_json TEXT NOT NULL DEFAULT '[]',\n  cooldown_seconds INTEGER NOT NULL DEFAULT 0,\n  dedupe_window_seconds INTEGER NOT NULL DEFAULT 300,\n  enabled INTEGER NOT NULL DEFAULT 1,\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n);\n\nCREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_slack_trigger_node\n  ON workflow_slack_trigger_registrations (workflow_id, node_id);\n\nCREATE INDEX IF NOT EXISTS idx_workflow_slack_trigger_app_surface\n  ON workflow_slack_trigger_registrations (slack_app_id, surface, enabled);\n\nCREATE INDEX IF NOT EXISTS idx_workflow_slack_trigger_workflow\n  ON workflow_slack_trigger_registrations (workflow_id, enabled);\n\nCREATE TABLE IF NOT EXISTS workflow_slack_deliveries (\n  id TEXT PRIMARY KEY NOT NULL,\n  slack_app_id TEXT NOT NULL,\n  workflow_id TEXT NOT NULL,\n  node_id TEXT NOT NULL,\n  delivery_key TEXT NOT NULL,\n  surface TEXT NOT NULL,\n  run_id TEXT,\n  status TEXT NOT NULL,\n  error TEXT,\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n);\n\nCREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_slack_deliveries_dedupe\n  ON workflow_slack_deliveries (slack_app_id, node_id, delivery_key);\n\nCREATE INDEX IF NOT EXISTS idx_workflow_slack_deliveries_node_created\n  ON workflow_slack_deliveries (slack_app_id, node_id, created_at DESC);\n",
  },
  {
    id: "0020_user_mcpcf_server_configs.sql",
    sql: "CREATE TABLE IF NOT EXISTS user_mcpcf_server_configs (\n  user_id TEXT NOT NULL,\n  server_id TEXT NOT NULL,\n  auth_token_secret_key TEXT,\n  default_tools_enabled INTEGER NOT NULL DEFAULT 1,\n  disabled_tools_json TEXT NOT NULL DEFAULT '[]',\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL,\n  PRIMARY KEY (user_id, server_id)\n);\n\nCREATE INDEX IF NOT EXISTS idx_user_mcpcf_server_configs_user\n  ON user_mcpcf_server_configs(user_id, updated_at);\n",
  },
  {
    id: "0021_secret_tags.sql",
    sql: "ALTER TABLE global_secrets ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';\n",
  },
  {
    id: "0022_session_secret_keys.sql",
    sql: "ALTER TABLE sessions ADD COLUMN secret_keys_json TEXT NOT NULL DEFAULT '[]';\n",
  },
  {
    id: "0023_drop_repo_secrets.sql",
    sql: "DROP TABLE IF EXISTS repo_secrets;\n",
  },
  {
    id: "0024_opencode_permission_preferences.sql",
    sql: "ALTER TABLE user_provider_preferences\n  ADD COLUMN opencode_permission_json TEXT;\n",
  },
  {
    id: "0025_cron_runs.sql",
    sql: "CREATE TABLE IF NOT EXISTS cron_runs (\n  id            TEXT    PRIMARY KEY,\n  job_id        TEXT    NOT NULL,\n  cron          TEXT,\n  trigger       TEXT    NOT NULL,\n  status        TEXT    NOT NULL,\n  started_at    INTEGER NOT NULL,\n  finished_at   INTEGER NOT NULL,\n  duration_ms   INTEGER NOT NULL,\n  result_json   TEXT    NOT NULL DEFAULT '{}',\n  error_message TEXT,\n  actor_user_id TEXT,\n  actor_email   TEXT,\n  created_at    INTEGER NOT NULL\n);\n\nCREATE INDEX IF NOT EXISTS idx_cron_runs_job_created\n  ON cron_runs(job_id, created_at);\n\nCREATE INDEX IF NOT EXISTS idx_cron_runs_job_status_created\n  ON cron_runs(job_id, status, created_at);\n",
  },
  {
    id: "0026_session_agent_runtime.sql",
    sql: "ALTER TABLE sessions ADD COLUMN agent_runtime TEXT NOT NULL DEFAULT 'isolate';\n\nUPDATE sessions\nSET agent_runtime = CASE\n  WHEN session_kind = 'sandbox' THEN 'opencode'\n  ELSE 'isolate'\nEND\nWHERE agent_runtime IS NULL\n  OR agent_runtime = ''\n  OR agent_runtime = 'isolate';\n",
  },
  {
    id: "0027_agent_skills.sql",
    sql: "CREATE TABLE IF NOT EXISTS agent_skills (\n  id TEXT PRIMARY KEY NOT NULL,\n  scope TEXT NOT NULL CHECK (scope IN ('global', 'user')),\n  owner_user_id TEXT,\n  slug TEXT NOT NULL,\n  name TEXT NOT NULL,\n  description TEXT NOT NULL,\n  runtime_scope TEXT NOT NULL CHECK (runtime_scope IN ('harness', 'isolate', 'all')),\n  origin TEXT NOT NULL CHECK (origin IN ('built-in', 'admin', 'skills-sh', 'user')),\n  source_id TEXT,\n  source_hash TEXT,\n  content_hash TEXT NOT NULL,\n  default_enabled INTEGER NOT NULL DEFAULT 0 CHECK (default_enabled IN (0, 1)),\n  created_by_user_id TEXT,\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL,\n  deleted_at INTEGER,\n  CHECK (\n    (scope = 'global' AND owner_user_id IS NULL) OR\n    (scope = 'user' AND owner_user_id IS NOT NULL)\n  )\n);\n\nCREATE UNIQUE INDEX IF NOT EXISTS idx_agent_skills_active_global_slug\n  ON agent_skills (slug)\n  WHERE scope = 'global' AND deleted_at IS NULL;\n\nCREATE UNIQUE INDEX IF NOT EXISTS idx_agent_skills_active_user_slug\n  ON agent_skills (owner_user_id, slug)\n  WHERE scope = 'user' AND deleted_at IS NULL;\n\nCREATE INDEX IF NOT EXISTS idx_agent_skills_active_scope_runtime\n  ON agent_skills (scope, runtime_scope, default_enabled, updated_at)\n  WHERE deleted_at IS NULL;\n\nCREATE TABLE IF NOT EXISTS user_agent_skill_preferences (\n  user_id TEXT NOT NULL,\n  skill_id TEXT NOT NULL,\n  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL,\n  PRIMARY KEY (user_id, skill_id),\n  FOREIGN KEY (skill_id) REFERENCES agent_skills(id) ON DELETE CASCADE\n);\n\nCREATE INDEX IF NOT EXISTS idx_user_agent_skill_preferences_skill\n  ON user_agent_skill_preferences (skill_id, user_id);\n\nINSERT OR IGNORE INTO agent_skills (\n  id,\n  scope,\n  owner_user_id,\n  slug,\n  name,\n  description,\n  runtime_scope,\n  origin,\n  source_id,\n  source_hash,\n  content_hash,\n  default_enabled,\n  created_by_user_id,\n  created_at,\n  updated_at,\n  deleted_at\n) VALUES (\n  'skill_c0_create_pr',\n  'global',\n  NULL,\n  'c0-create-pr',\n  'c0-create-pr',\n  'Create a GitHub pull request from a c0-managed repository. Use when the user asks to open, create, or submit a pull request for the current repository.',\n  'harness',\n  'built-in',\n  NULL,\n  NULL,\n  'builtin:c0-create-pr:v1',\n  1,\n  NULL,\n  0,\n  0,\n  NULL\n);\n",
  },
  {
    id: "0028_managed_admin_credentials.sql",
    sql: 'CREATE TABLE IF NOT EXISTS "managed_admin_credential" (\n  "userId" TEXT NOT NULL PRIMARY KEY,\n  "email" TEXT NOT NULL,\n  "createdAt" TEXT NOT NULL,\n  "updatedAt" TEXT NOT NULL\n);\n\nCREATE UNIQUE INDEX IF NOT EXISTS "idx_managed_admin_credential_email"\n  ON "managed_admin_credential" ("email");\n\n-- Sessions created before provider-capability enforcement do not record which\n-- provider established them. Revoke them once during rollout so every\n-- surviving session was issued under the new server-side policy.\nDELETE FROM "session";\n',
  },
  {
    id: "0029_session_subagents.sql",
    sql: "ALTER TABLE sessions ADD COLUMN subagents TEXT NOT NULL DEFAULT 'enabled';\n\nUPDATE sessions\nSET subagents = 'disabled'\nWHERE session_kind = 'sandbox';\n",
  },
  {
    id: "0030_s0_agent_skill_prefix.sql",
    sql: "UPDATE user_agent_skill_preferences\nSET skill_id = 'skill_s0_create_pr'\nWHERE skill_id = 'skill_c0_create_pr';\n\nUPDATE agent_skills\nSET\n  id = 'skill_s0_create_pr',\n  slug = 's0-create-pr',\n  name = 's0-create-pr',\n  description = 'Create a GitHub pull request from a SolZero-managed repository. Use when the user asks to open, create, or submit a pull request for the current repository.',\n  content_hash = 'builtin:s0-create-pr:v1'\nWHERE id = 'skill_c0_create_pr';\n",
  },
  {
    id: "0031_bots.sql",
    sql: "CREATE TABLE IF NOT EXISTS bots (\n  id            TEXT    PRIMARY KEY,\n  user_id       TEXT    NOT NULL,\n  name          TEXT    NOT NULL,\n  instructions  TEXT    NOT NULL DEFAULT '',\n  session_id    TEXT,\n  status        TEXT    NOT NULL DEFAULT 'active',\n  created_at    INTEGER NOT NULL,\n  updated_at    INTEGER NOT NULL\n);\n\nCREATE INDEX IF NOT EXISTS idx_bots_owner_updated\n  ON bots (user_id, status, updated_at DESC);\n\nCREATE INDEX IF NOT EXISTS idx_bots_session\n  ON bots (session_id);\n\nCREATE TABLE IF NOT EXISTS bot_routines (\n  id            TEXT    PRIMARY KEY,\n  bot_id        TEXT    NOT NULL,\n  user_id       TEXT    NOT NULL,\n  name          TEXT    NOT NULL,\n  kind          TEXT    NOT NULL,\n  cadence_json  TEXT    NOT NULL,\n  prompt        TEXT    NOT NULL,\n  until         INTEGER,\n  watch_json    TEXT    NOT NULL DEFAULT '{\"kind\":\"none\"}',\n  status        TEXT    NOT NULL DEFAULT 'active',\n  last_run_at   INTEGER,\n  created_at    INTEGER NOT NULL,\n  updated_at    INTEGER NOT NULL\n);\n\nCREATE INDEX IF NOT EXISTS idx_bot_routines_bot_updated\n  ON bot_routines (bot_id, status, updated_at DESC);\n\nCREATE INDEX IF NOT EXISTS idx_bot_routines_owner_updated\n  ON bot_routines (user_id, status, updated_at DESC);\n",
  },
]
