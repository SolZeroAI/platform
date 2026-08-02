DELETE FROM sessions;
DELETE FROM "account";
DELETE FROM "session";
DELETE FROM "user";
DELETE FROM user_provider_preferences;
DELETE FROM user_provider_configs;

INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
VALUES (
  'user-session-run',
  'Vitest Session User',
  'vitest-session@example.com',
  1,
  NULL,
  '2026-01-01T00:00:00.000Z',
  '2026-01-01T00:00:00.000Z'
);
