CREATE TABLE IF NOT EXISTS workflows (
  id               TEXT    PRIMARY KEY,
  user_id          TEXT    NOT NULL,
  name             TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'active',
  manifest_version INTEGER NOT NULL,
  manifest_key     TEXT    NOT NULL,
  code_key         TEXT    NOT NULL,
  webhook_id       TEXT    NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflows_owner_updated
  ON workflows (user_id, status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_webhook_id
  ON workflows (webhook_id);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id                   TEXT    PRIMARY KEY,
  workflow_id          TEXT    NOT NULL,
  workflow_version     INTEGER NOT NULL,
  workflow_instance_id TEXT,
  user_id              TEXT    NOT NULL,
  trigger_kind         TEXT    NOT NULL,
  trigger_node_id      TEXT,
  status               TEXT    NOT NULL,
  input_json           TEXT    NOT NULL DEFAULT '{}',
  output_json          TEXT,
  error                TEXT,
  started_at           INTEGER NOT NULL,
  completed_at         INTEGER,
  updated_at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_updated
  ON workflow_runs (workflow_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS workflow_run_events (
  id          TEXT    PRIMARY KEY,
  workflow_id TEXT    NOT NULL,
  run_id      TEXT    NOT NULL,
  sequence    INTEGER NOT NULL,
  node_id     TEXT,
  event_type  TEXT    NOT NULL,
  level       TEXT    NOT NULL DEFAULT 'info',
  message     TEXT    NOT NULL,
  data_json   TEXT    NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_run_events_run_sequence
  ON workflow_run_events (run_id, sequence ASC);

CREATE INDEX IF NOT EXISTS idx_workflow_run_events_workflow_created
  ON workflow_run_events (workflow_id, created_at DESC);
