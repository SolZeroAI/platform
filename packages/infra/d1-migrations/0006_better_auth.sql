CREATE TABLE IF NOT EXISTS "user" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  "image" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_email"
  ON "user" ("email");

CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_session_token"
  ON "session" ("token");

CREATE INDEX IF NOT EXISTS "idx_session_userId"
  ON "session" ("userId");

CREATE TABLE IF NOT EXISTS "account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TEXT,
  "refreshTokenExpiresAt" TEXT,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_account_provider_account"
  ON "account" ("providerId", "accountId");

CREATE INDEX IF NOT EXISTS "idx_account_userId"
  ON "account" ("userId");

CREATE TABLE IF NOT EXISTS "verification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_verification_identifier"
  ON "verification" ("identifier");
