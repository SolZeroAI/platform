ALTER TABLE sessions ADD COLUMN secret_keys_json TEXT NOT NULL DEFAULT '[]';
