CREATE TABLE IF NOT EXISTS user_provider_configs (
  user_id           TEXT    NOT NULL,
  provider_id       TEXT    NOT NULL,
  scope             TEXT    NOT NULL,
  display_name      TEXT    NOT NULL,
  npm               TEXT,
  provider_json     TEXT    NOT NULL,
  api_key_encrypted TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_user_provider_configs_user_scope
  ON user_provider_configs (user_id, scope, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_provider_preferences (
  user_id       TEXT    NOT NULL PRIMARY KEY,
  default_model  TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
