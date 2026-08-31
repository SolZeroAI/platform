INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
VALUES
  ('user_verified', 'Verified User', 'verified@example.com', 1, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('user_pending', 'Pending User', 'pending@example.com', 0, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO "global_secrets" ("key", "encrypted_value", "tags", "created_at", "updated_at")
VALUES
  ('user_verified/ALPHA_TOKEN', 'encrypted-alpha', '["ops","shared"]', 1700000000000, 1700000000000);
