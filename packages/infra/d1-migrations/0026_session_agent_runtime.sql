ALTER TABLE sessions ADD COLUMN agent_runtime TEXT NOT NULL DEFAULT 'isolate';

UPDATE sessions
SET agent_runtime = CASE
  WHEN session_kind = 'sandbox' THEN 'opencode'
  ELSE 'isolate'
END
WHERE agent_runtime IS NULL
  OR agent_runtime = ''
  OR agent_runtime = 'isolate';
