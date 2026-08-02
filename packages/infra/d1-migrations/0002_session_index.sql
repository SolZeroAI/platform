CREATE TABLE IF NOT EXISTS sessions (
  id               TEXT    PRIMARY KEY,
  user_id          TEXT    NOT NULL,
  title            TEXT,
  repo_owner       TEXT    NOT NULL,
  repo_name        TEXT    NOT NULL,
  model            TEXT    NOT NULL,
  reasoning_effort TEXT,
  status           TEXT    NOT NULL DEFAULT 'created',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_status_updated
  ON sessions (user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_repo
  ON sessions (user_id, repo_owner, repo_name, updated_at DESC);

CREATE TABLE IF NOT EXISTS repo_metadata (
  repo_owner           TEXT NOT NULL,
  repo_name            TEXT NOT NULL,
  description          TEXT,
  aliases              TEXT,
  channel_associations TEXT,
  keywords             TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  PRIMARY KEY (repo_owner, repo_name)
);
