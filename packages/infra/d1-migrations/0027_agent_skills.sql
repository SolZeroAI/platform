CREATE TABLE IF NOT EXISTS agent_skills (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'user')),
  owner_user_id TEXT,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  runtime_scope TEXT NOT NULL CHECK (runtime_scope IN ('harness', 'isolate', 'all')),
  origin TEXT NOT NULL CHECK (origin IN ('built-in', 'admin', 'skills-sh', 'user')),
  source_id TEXT,
  source_hash TEXT,
  content_hash TEXT NOT NULL,
  default_enabled INTEGER NOT NULL DEFAULT 0 CHECK (default_enabled IN (0, 1)),
  created_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  CHECK (
    (scope = 'global' AND owner_user_id IS NULL) OR
    (scope = 'user' AND owner_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_skills_active_global_slug
  ON agent_skills (slug)
  WHERE scope = 'global' AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_skills_active_user_slug
  ON agent_skills (owner_user_id, slug)
  WHERE scope = 'user' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_skills_active_scope_runtime
  ON agent_skills (scope, runtime_scope, default_enabled, updated_at)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS user_agent_skill_preferences (
  user_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, skill_id),
  FOREIGN KEY (skill_id) REFERENCES agent_skills(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_agent_skill_preferences_skill
  ON user_agent_skill_preferences (skill_id, user_id);

INSERT OR IGNORE INTO agent_skills (
  id,
  scope,
  owner_user_id,
  slug,
  name,
  description,
  runtime_scope,
  origin,
  source_id,
  source_hash,
  content_hash,
  default_enabled,
  created_by_user_id,
  created_at,
  updated_at,
  deleted_at
) VALUES (
  'skill_c0_create_pr',
  'global',
  NULL,
  'c0-create-pr',
  'c0-create-pr',
  'Create a GitHub pull request from a c0-managed repository. Use when the user asks to open, create, or submit a pull request for the current repository.',
  'harness',
  'built-in',
  NULL,
  NULL,
  'builtin:c0-create-pr:v1',
  1,
  NULL,
  0,
  0,
  NULL
);
