ALTER TABLE sessions ADD COLUMN subagents TEXT NOT NULL DEFAULT 'enabled';

UPDATE sessions
SET subagents = 'disabled'
WHERE session_kind = 'sandbox';
