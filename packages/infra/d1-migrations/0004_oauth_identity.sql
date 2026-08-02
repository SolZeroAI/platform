CREATE TABLE IF NOT EXISTS user_api_keys (
  key_id         TEXT    NOT NULL PRIMARY KEY,
  user_id        TEXT    NOT NULL,
  label          TEXT,
  key_hash       TEXT    NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  last_used_at   INTEGER,
  revoked_at     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_owner
  ON user_api_keys (user_id, revoked_at, created_at DESC);
