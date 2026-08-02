CREATE TABLE IF NOT EXISTS mcpcf_config (
  id TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  base_url TEXT NOT NULL DEFAULT '',
  admin_api_token_secret_key TEXT NOT NULL DEFAULT 'mcpcf.admin-api-token',
  user_oauth_provider_id TEXT NOT NULL DEFAULT '',
  expected_issuer TEXT,
  auth_type_allowlist_json TEXT NOT NULL DEFAULT '[]',
  server_blacklist_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mcpcf_servers (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  auth_type TEXT,
  tool_count INTEGER NOT NULL DEFAULT 0,
  tools_json TEXT NOT NULL DEFAULT '[]',
  source_status TEXT NOT NULL DEFAULT 'active',
  filter_reason TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  raw_metadata_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  verified_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcpcf_servers_slug ON mcpcf_servers(slug);
CREATE INDEX IF NOT EXISTS idx_mcpcf_servers_status_enabled ON mcpcf_servers(source_status, enabled, updated_at);

UPDATE sessions
SET tools_json = replace(tools_json, '"kind":"context_forge_server"', '"kind":"mcpcf_server"')
WHERE tools_json LIKE '%"context_forge_server"%';
