CREATE TABLE IF NOT EXISTS workflow_slack_apps (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  app_name TEXT NOT NULL,
  signing_secret_key TEXT NOT NULL,
  bot_token_secret_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_slack_apps_workflow
  ON workflow_slack_apps (workflow_id);

CREATE INDEX IF NOT EXISTS idx_workflow_slack_apps_owner
  ON workflow_slack_apps (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workflow_slack_trigger_registrations (
  id TEXT PRIMARY KEY NOT NULL,
  slack_app_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  command_name TEXT,
  event_types_json TEXT NOT NULL DEFAULT '[]',
  channel_name_pattern TEXT,
  keyword_rules_json TEXT NOT NULL DEFAULT '[]',
  action_ids_json TEXT NOT NULL DEFAULT '[]',
  cooldown_seconds INTEGER NOT NULL DEFAULT 0,
  dedupe_window_seconds INTEGER NOT NULL DEFAULT 300,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_slack_trigger_node
  ON workflow_slack_trigger_registrations (workflow_id, node_id);

CREATE INDEX IF NOT EXISTS idx_workflow_slack_trigger_app_surface
  ON workflow_slack_trigger_registrations (slack_app_id, surface, enabled);

CREATE INDEX IF NOT EXISTS idx_workflow_slack_trigger_workflow
  ON workflow_slack_trigger_registrations (workflow_id, enabled);

CREATE TABLE IF NOT EXISTS workflow_slack_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  slack_app_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  delivery_key TEXT NOT NULL,
  surface TEXT NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_slack_deliveries_dedupe
  ON workflow_slack_deliveries (slack_app_id, node_id, delivery_key);

CREATE INDEX IF NOT EXISTS idx_workflow_slack_deliveries_node_created
  ON workflow_slack_deliveries (slack_app_id, node_id, created_at DESC);
