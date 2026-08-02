CREATE TABLE IF NOT EXISTS cron_runs (
  id            TEXT    PRIMARY KEY,
  job_id        TEXT    NOT NULL,
  cron          TEXT,
  trigger       TEXT    NOT NULL,
  status        TEXT    NOT NULL,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER NOT NULL,
  duration_ms   INTEGER NOT NULL,
  result_json   TEXT    NOT NULL DEFAULT '{}',
  error_message TEXT,
  actor_user_id TEXT,
  actor_email   TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job_created
  ON cron_runs(job_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job_status_created
  ON cron_runs(job_id, status, created_at);
