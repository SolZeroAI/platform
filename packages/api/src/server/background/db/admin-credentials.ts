/* oxlint-disable s0-lint/no-if-statement, s0-lint/no-ternary -- Idempotent D1 reconciliation is an imperative persistence boundary; explicit existence and rotation branches mirror the SQL operations. */
import { CREDENTIAL_AUTH_PROVIDER_ID, type S0AuthConfig } from "@solzero/shared"
import { hashPassword, verifyPassword } from "better-auth/crypto"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { toError } from "../../lib/effect-errors"
import { getAdminConfig } from "./admin-config"
import { S0_CONFIG_BINDINGS, getS0DeploymentConfig, getS0DeploymentSecret } from "./s0-config"
import type { Env } from "../types"

interface ManagedAdminCredentialRow {
  userId: string
  email: string
}

interface CredentialAccountRow {
  id: string
  password: string | null
}

type QueryableEnv = Env & {
  DB: D1Database & { prepare: (...args: unknown[]) => D1PreparedStatement }
}

const reconciliationByEnv = new WeakMap<object, Promise<void>>()

function promiseOrDie<A>(tryPromise: () => Promise<A>) {
  return Effect.tryPromise({ try: tryPromise, catch: toError }).pipe(Effect.orDie)
}

function queryableEnv(env: Env): QueryableEnv {
  if (!env.DB || typeof env.DB.prepare !== "function") {
    throw new Error("D1 is required to reconcile managed admin credentials")
  }
  return env as QueryableEnv
}

function adminPassword(env: Env): string {
  return getS0DeploymentConfig<S0AuthConfig>(env, S0_CONFIG_BINDINGS.auth).pipe(
    Option.flatMap((config) => getS0DeploymentSecret(env, config.adminPassword)),
    Option.getOrThrowWith(
      () => new Error("auth.adminPassword is required when credential sign-in is enabled"),
    ),
  )
}

function displayNameForEmail(email: string): string {
  return email.split("@", 1)[0] || "Administrator"
}

async function findOrCreateUser(db: QueryableEnv["DB"], email: string, now: string) {
  const existing = await db
    .prepare(`SELECT "id" FROM "user" WHERE lower("email") = ?1 LIMIT 1`)
    .bind(email)
    .first<{ id: string }>()
  if (existing) return existing.id

  const userId = crypto.randomUUID()
  await db
    .prepare(
      `INSERT OR IGNORE INTO "user"
         ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       VALUES (?1, ?2, ?3, 1, ?4, ?4)`,
    )
    .bind(userId, displayNameForEmail(email), email, now)
    .run()
  const created = await db
    .prepare(`SELECT "id" FROM "user" WHERE lower("email") = ?1 LIMIT 1`)
    .bind(email)
    .first<{ id: string }>()
  if (!created) throw new Error(`Failed to provision configured admin '${email}'`)
  return created.id
}

async function reconcileAdmin(
  db: QueryableEnv["DB"],
  email: string,
  plaintextPassword: string,
  now: string,
) {
  const userId = await findOrCreateUser(db, email, now)
  const account = await db
    .prepare(
      `SELECT "id", "password"
       FROM "account"
       WHERE "userId" = ?1 AND "providerId" = ?2
       LIMIT 1`,
    )
    .bind(userId, CREDENTIAL_AUTH_PROVIDER_ID)
    .first<CredentialAccountRow>()
  const passwordCurrent = account?.password
    ? await verifyPassword({ hash: account.password, password: plaintextPassword })
    : false

  if (!passwordCurrent) {
    const password = await hashPassword(plaintextPassword)
    if (account) {
      await db
        .prepare(`UPDATE "account" SET "password" = ?1, "updatedAt" = ?2 WHERE "id" = ?3`)
        .bind(password, now, account.id)
        .run()
    } else {
      await db
        .prepare(
          `INSERT OR IGNORE INTO "account"
             ("id", "userId", "accountId", "providerId", "password", "createdAt", "updatedAt")
           VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?5)`,
        )
        .bind(crypto.randomUUID(), userId, CREDENTIAL_AUTH_PROVIDER_ID, password, now)
        .run()
    }
    await db.prepare(`DELETE FROM "session" WHERE "userId" = ?1`).bind(userId).run()
  }

  await db
    .prepare(
      `INSERT INTO "managed_admin_credential" ("userId", "email", "createdAt", "updatedAt")
       VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT("userId") DO UPDATE SET "email" = excluded."email", "updatedAt" = excluded."updatedAt"`,
    )
    .bind(userId, email, now)
    .run()
}

async function removeStaleAdmins(db: QueryableEnv["DB"], configuredEmails: ReadonlySet<string>) {
  const rows = await db
    .prepare(`SELECT "userId", "email" FROM "managed_admin_credential"`)
    .all<ManagedAdminCredentialRow>()
  await Promise.all(
    rows.results
      .filter((row) => !configuredEmails.has(row.email.toLowerCase()))
      .map(async (row) => {
        await db.batch([
          db
            .prepare(`DELETE FROM "account" WHERE "userId" = ?1 AND "providerId" = ?2`)
            .bind(row.userId, CREDENTIAL_AUTH_PROVIDER_ID),
          db.prepare(`DELETE FROM "session" WHERE "userId" = ?1`).bind(row.userId),
          db.prepare(`DELETE FROM "managed_admin_credential" WHERE "userId" = ?1`).bind(row.userId),
        ])
      }),
  )
}

export const reconcileManagedAdminCredentialsUncached = Effect.fn(
  "auth.reconcileManagedAdminCredentials",
)(function* (env: Env) {
  const db = queryableEnv(env).DB
  const config = yield* getAdminConfig(env)
  const configuredEmails = new Set(config.adminEmails.map((email) => email.trim().toLowerCase()))
  if (configuredEmails.size === 0) {
    return yield* promiseOrDie(() => removeStaleAdmins(db, configuredEmails))
  }

  const password = adminPassword(env)
  const now = new Date().toISOString()
  yield* promiseOrDie(() =>
    Promise.all(
      [...configuredEmails].map((email) => reconcileAdmin(db, email, password, now)),
    ).then(() => undefined),
  )
  yield* promiseOrDie(() => removeStaleAdmins(db, configuredEmails))
})

export function reconcileManagedAdminCredentials(env: Env): Promise<void> {
  const existing = reconciliationByEnv.get(env)
  if (existing) return existing

  // oxlint-disable-next-line effect/effect-run-in-body -- Worker adapters consume this idempotent reconciliation as a cached Promise.
  const reconciliation = Effect.runPromise(reconcileManagedAdminCredentialsUncached(env)).catch(
    (error) => {
      reconciliationByEnv.delete(env)
      throw error
    },
  )
  reconciliationByEnv.set(env, reconciliation)
  return reconciliation
}
