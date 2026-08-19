CREATE TABLE IF NOT EXISTS bots (
  id            TEXT    PRIMARY KEY,
  user_id       TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  instructions  TEXT    NOT NULL DEFAULT '',
  session_id    TEXT,
  status        TEXT    NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bots_owner_updated
  ON bots (user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bots_session
  ON bots (session_id);

CREATE TABLE IF NOT EXISTS bot_routines (
  id            TEXT    PRIMARY KEY,
  bot_id        TEXT    NOT NULL,
  user_id       TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  kind          TEXT    NOT NULL,
  cadence_json  TEXT    NOT NULL,
  prompt        TEXT    NOT NULL,
  until         INTEGER,
  watch_json    TEXT    NOT NULL DEFAULT '{"kind":"none"}',
  status        TEXT    NOT NULL DEFAULT 'active',
  last_run_at   INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bot_routines_bot_updated
  ON bot_routines (bot_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_routines_owner_updated
  ON bot_routines (user_id, status, updated_at DESC);
