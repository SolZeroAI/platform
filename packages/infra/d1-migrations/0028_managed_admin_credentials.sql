CREATE TABLE IF NOT EXISTS "managed_admin_credential" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_managed_admin_credential_email"
  ON "managed_admin_credential" ("email");

-- Sessions created before provider-capability enforcement do not record which
-- provider established them. Revoke them once during rollout so every
-- surviving session was issued under the new server-side policy.
DELETE FROM "session";
