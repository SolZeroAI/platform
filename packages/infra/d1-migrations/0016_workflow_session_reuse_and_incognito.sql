ALTER TABLE sessions ADD COLUMN incognito INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS workflow_session_reuse_keys (
  user_id      TEXT    NOT NULL,
  workflow_id  TEXT    NOT NULL,
  node_id      TEXT    NOT NULL,
  session_kind TEXT    NOT NULL,
  key_hash     TEXT    NOT NULL,
  session_id   TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, workflow_id, node_id, session_kind, key_hash)
);

CREATE INDEX IF NOT EXISTS idx_workflow_session_reuse_keys_session
  ON workflow_session_reuse_keys (session_id);
