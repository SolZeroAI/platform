CREATE TABLE IF NOT EXISTS user_mcpcf_server_configs (
  user_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  auth_token_secret_key TEXT,
  default_tools_enabled INTEGER NOT NULL DEFAULT 1,
  disabled_tools_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_user_mcpcf_server_configs_user
  ON user_mcpcf_server_configs(user_id, updated_at);
