CREATE TABLE IF NOT EXISTS admin_audit_events (
  id            TEXT    PRIMARY KEY,
  admin_user_id TEXT    NOT NULL,
  admin_email   TEXT    NOT NULL,
  target_type   TEXT    NOT NULL,
  target_id     TEXT    NOT NULL,
  action        TEXT    NOT NULL,
  reason        TEXT,
  result        TEXT    NOT NULL,
  status        INTEGER NOT NULL,
  message       TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_events_created
  ON admin_audit_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_events_target
  ON admin_audit_events (target_type, target_id, created_at DESC);
