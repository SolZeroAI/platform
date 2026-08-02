ALTER TABLE sessions
  ADD COLUMN isolate_step_limit INTEGER NOT NULL DEFAULT 8;

ALTER TABLE user_provider_preferences
  ADD COLUMN default_isolate_step_limit INTEGER NOT NULL DEFAULT 8;
