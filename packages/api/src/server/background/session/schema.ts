import { DEFAULT_ISOLATE_STEP_LIMIT } from "@c0-agent/shared"

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS session (
  id               TEXT PRIMARY KEY,
  session_name     TEXT,
  session_kind     TEXT NOT NULL DEFAULT 'isolate',
  agent_runtime    TEXT NOT NULL DEFAULT 'isolate',
  title            TEXT,
  repo_owner       TEXT NOT NULL,
  repo_name        TEXT NOT NULL,
  github_installation_id INTEGER,
  github_repo_id   INTEGER,
  repo_default_branch TEXT,
  branch_name      TEXT,
  tools_json       TEXT NOT NULL DEFAULT '[]',
  custom_mcp_json  TEXT NOT NULL DEFAULT '{}',
  secret_keys_json TEXT NOT NULL DEFAULT '[]',
  isolate_step_limit INTEGER NOT NULL DEFAULT ${DEFAULT_ISOLATE_STEP_LIMIT},
  subagents        TEXT NOT NULL DEFAULT 'enabled',
  model            TEXT NOT NULL,
  reasoning_effort TEXT,
  status           TEXT NOT NULL DEFAULT 'created',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  github_login       TEXT,
  github_name        TEXT,
  github_email       TEXT,
  ws_auth_token      TEXT,
  ws_token_created_at INTEGER,
  role               TEXT NOT NULL DEFAULT 'member',
  joined_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participant_ws_tokens (
  id             TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  token_hash     TEXT NOT NULL UNIQUE,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  FOREIGN KEY (participant_id) REFERENCES participants(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id               TEXT PRIMARY KEY,
  author_id        TEXT NOT NULL,
  content          TEXT NOT NULL,
  source           TEXT NOT NULL,
  model            TEXT,
  reasoning_effort TEXT,
  execution_mode   TEXT NOT NULL DEFAULT 'sync',
  attachments      TEXT,
  callback_context TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  error_message    TEXT,
  created_at       INTEGER NOT NULL,
  started_at       INTEGER,
  completed_at     INTEGER,
  FOREIGN KEY (author_id) REFERENCES participants(id)
);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  data       TEXT NOT NULL,
  message_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  url        TEXT,
  metadata   TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sandbox (
  id                  TEXT PRIMARY KEY,
  sandbox_id          TEXT,
  auth_token          TEXT,
  opencode_session_id TEXT,
  opencode_server_port INTEGER,
  opencode_config_signature TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  last_heartbeat      INTEGER,
  last_activity       INTEGER,
  last_spawn_error    TEXT,
  last_spawn_error_at INTEGER,
  created_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sandbox_activity (
  id          TEXT PRIMARY KEY,
  sandbox_id  TEXT,
  type        TEXT NOT NULL,
  summary     TEXT NOT NULL,
  status_from TEXT,
  status_to   TEXT,
  keep_alive  INTEGER,
  reason      TEXT,
  data        TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ws_client_mapping (
  ws_id          TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  client_id      TEXT,
  created_at     INTEGER NOT NULL,
  FOREIGN KEY (participant_id) REFERENCES participants(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at, id);
CREATE INDEX IF NOT EXISTS idx_sandbox_activity_created ON sandbox_activity(created_at, id);
CREATE INDEX IF NOT EXISTS idx_participants_user ON participants(user_id);
CREATE INDEX IF NOT EXISTS idx_participant_ws_tokens_hash ON participant_ws_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_participant_ws_tokens_participant ON participant_ws_tokens(participant_id);
`

function runMigration(sql: SqlStorage, statement: string): void {
  // oxlint-disable-next-line effect/avoid-try-catch -- Idempotent DDL boundary: SqlStorage.exec throws synchronously on "duplicate column"/"already exists" for already-applied migrations, which must be swallowed while other errors rethrow.
  try {
    sql.exec(statement)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("duplicate column") || message.includes("already exists")) {
      return
    }
    throw error
  }
}

export function initSchema(sql: SqlStorage): void {
  sql.exec(SCHEMA_SQL)

  runMigration(sql, "ALTER TABLE session ADD COLUMN reasoning_effort TEXT")
  runMigration(sql, "ALTER TABLE session ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'isolate'")
  runMigration(sql, "ALTER TABLE session ADD COLUMN agent_runtime TEXT NOT NULL DEFAULT 'isolate'")
  sql.exec(
    "UPDATE session SET agent_runtime = CASE WHEN session_kind = 'sandbox' THEN 'opencode' ELSE 'isolate' END WHERE agent_runtime IS NULL OR agent_runtime = '' OR agent_runtime = 'isolate'",
  )
  runMigration(sql, "ALTER TABLE session ADD COLUMN tools_json TEXT NOT NULL DEFAULT '[]'")
  runMigration(sql, "ALTER TABLE session ADD COLUMN custom_mcp_json TEXT NOT NULL DEFAULT '{}'")
  runMigration(sql, "ALTER TABLE session ADD COLUMN secret_keys_json TEXT NOT NULL DEFAULT '[]'")
  runMigration(
    sql,
    `ALTER TABLE session ADD COLUMN isolate_step_limit INTEGER NOT NULL DEFAULT ${DEFAULT_ISOLATE_STEP_LIMIT}`,
  )
  runMigration(sql, "ALTER TABLE session ADD COLUMN subagents TEXT NOT NULL DEFAULT 'enabled'")
  sql.exec("UPDATE session SET subagents = 'disabled' WHERE session_kind = 'sandbox'")
  runMigration(sql, "ALTER TABLE session ADD COLUMN github_installation_id INTEGER")
  runMigration(sql, "ALTER TABLE session ADD COLUMN github_repo_id INTEGER")
  runMigration(sql, "ALTER TABLE session ADD COLUMN repo_default_branch TEXT")
  runMigration(sql, "ALTER TABLE session ADD COLUMN branch_name TEXT")
  runMigration(sql, "ALTER TABLE messages ADD COLUMN model TEXT")
  runMigration(sql, "ALTER TABLE messages ADD COLUMN reasoning_effort TEXT")
  runMigration(sql, "ALTER TABLE messages ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'sync'")
  runMigration(sql, "ALTER TABLE messages ADD COLUMN callback_context TEXT")
  runMigration(sql, "ALTER TABLE participants ADD COLUMN ws_auth_token TEXT")
  runMigration(sql, "ALTER TABLE participants ADD COLUMN ws_token_created_at INTEGER")
  runMigration(sql, "ALTER TABLE sandbox ADD COLUMN opencode_session_id TEXT")
  runMigration(sql, "ALTER TABLE sandbox ADD COLUMN opencode_server_port INTEGER")
  runMigration(sql, "ALTER TABLE sandbox ADD COLUMN opencode_config_signature TEXT")
  runMigration(sql, "ALTER TABLE sandbox ADD COLUMN last_activity INTEGER")
}
