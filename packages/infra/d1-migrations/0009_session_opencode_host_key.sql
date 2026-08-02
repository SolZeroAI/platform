ALTER TABLE sessions ADD COLUMN opencode_host_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_opencode_host_key
  ON sessions (opencode_host_key);
