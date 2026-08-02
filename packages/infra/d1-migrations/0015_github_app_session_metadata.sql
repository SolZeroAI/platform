ALTER TABLE sessions ADD COLUMN github_installation_id INTEGER;
ALTER TABLE sessions ADD COLUMN github_repo_id INTEGER;
ALTER TABLE sessions ADD COLUMN repo_default_branch TEXT;
ALTER TABLE sessions ADD COLUMN branch_name TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_github_installation
  ON sessions (github_installation_id, github_repo_id);
