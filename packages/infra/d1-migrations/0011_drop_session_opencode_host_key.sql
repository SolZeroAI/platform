DROP INDEX IF EXISTS idx_sessions_opencode_host_key;

ALTER TABLE sessions DROP COLUMN opencode_host_key;
