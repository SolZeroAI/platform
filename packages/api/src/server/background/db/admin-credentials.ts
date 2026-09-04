/* oxlint-disable s0-lint/no-if-statement, s0-lint/no-ternary -- Idempotent credential reconciliation is an imperative persistence boundary; explicit existence and rotation branches mirror the SQL operations. */
import { CREDENTIAL_AUTH_PROVIDER_ID, type S0AuthConfig } from "@solzero/shared"
import { hashPassword, verifyPassword } from "better-auth/crypto"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { toError } from "../../lib/effect-errors"
import {
  databaseEngineFromEnv,
  hasControlPlane,
  runControlPlaneSql,
  runControlPlaneSqlFirst,
} from "../../effect/db/control-plane-db"
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

const reconciliationByEnv = new WeakMap<object, Promise<void>>()

function promiseOrDie<A>(tryPromise: () => Promise<A>) {
  return Effect.tryPromise({ try: tryPromise, catch: toError }).pipe(Effect.orDie)
}

function requireControlPlane(env: Env): Env {
  if (!hasControlPlane(env)) {
    throw new Error("Control-plane database is required to reconcile managed admin credentials")
  }
  return env
}

function insertIgnoreUserSql(env: Env) {
  return databaseEngineFromEnv(env) === "planetscale"
    ? `INSERT INTO "user"
         ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       VALUES (?1, ?2, ?3, TRUE, ?4, ?4)
       ON CONFLICT DO NOTHING`
    : `INSERT OR IGNORE INTO "user"
         ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       VALUES (?1, ?2, ?3, 1, ?4, ?4)`
}

function insertIgnoreAccountSql(env: Env) {
  return databaseEngineFromEnv(env) === "planetscale"
    ? `INSERT INTO "account"
         ("id", "userId", "accountId", "providerId", "password", "createdAt", "updatedAt")
       VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT DO NOTHING`
    : `INSERT OR IGNORE INTO "account"
         ("id", "userId", "accountId", "providerId", "password", "createdAt", "updatedAt")
       VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?5)`
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

async function findOrCreateUser(env: Env, email: string, now: string) {
  const existing = await runControlPlaneSqlFirst<{ id: string }>(
    env,
    `SELECT "id" FROM "user" WHERE lower("email") = ?1 LIMIT 1`,
    [email],
  )
  if (existing) return existing.id

  const userId = crypto.randomUUID()
  await runControlPlaneSql(env, insertIgnoreUserSql(env), [
    userId,
    displayNameForEmail(email),
    email,
    now,
  ])
  const created = await runControlPlaneSqlFirst<{ id: string }>(
    env,
    `SELECT "id" FROM "user" WHERE lower("email") = ?1 LIMIT 1`,
    [email],
  )
  if (!created) throw new Error(`Failed to provision configured admin '${email}'`)
  return created.id
}

async function reconcileAdmin(env: Env, email: string, plaintextPassword: string, now: string) {
  const userId = await findOrCreateUser(env, email, now)
  const account = await runControlPlaneSqlFirst<CredentialAccountRow>(
    env,
    `SELECT "id", "password"
       FROM "account"
       WHERE "userId" = ?1 AND "providerId" = ?2
       LIMIT 1`,
    [userId, CREDENTIAL_AUTH_PROVIDER_ID],
  )
  const passwordCurrent = account?.password
    ? await verifyPassword({ hash: account.password, password: plaintextPassword })
    : false

  if (!passwordCurrent) {
    const password = await hashPassword(plaintextPassword)
    if (account) {
      await runControlPlaneSql(
        env,
        `UPDATE "account" SET "password" = ?1, "updatedAt" = ?2 WHERE "id" = ?3`,
        [password, now, account.id],
      )
    } else {
      await runControlPlaneSql(env, insertIgnoreAccountSql(env), [
        crypto.randomUUID(),
        userId,
        CREDENTIAL_AUTH_PROVIDER_ID,
        password,
        now,
      ])
    }
    await runControlPlaneSql(env, `DELETE FROM "session" WHERE "userId" = ?1`, [userId])
  }

  await runControlPlaneSql(
    env,
    `INSERT INTO "managed_admin_credential" ("userId", "email", "createdAt", "updatedAt")
       VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT("userId") DO UPDATE SET "email" = excluded."email", "updatedAt" = excluded."updatedAt"`,
    [userId, email, now],
  )
}

async function removeStaleAdmins(env: Env, configuredEmails: ReadonlySet<string>) {
  const rows = await runControlPlaneSql<ManagedAdminCredentialRow>(
    env,
    `SELECT "userId", "email" FROM "managed_admin_credential"`,
  )
  await Promise.all(
    rows
      .filter((row) => !configuredEmails.has(row.email.toLowerCase()))
      .map(async (row) => {
        await runControlPlaneSql(
          env,
          `DELETE FROM "account" WHERE "userId" = ?1 AND "providerId" = ?2`,
          [row.userId, CREDENTIAL_AUTH_PROVIDER_ID],
        )
        await runControlPlaneSql(env, `DELETE FROM "session" WHERE "userId" = ?1`, [row.userId])
        await runControlPlaneSql(
          env,
          `DELETE FROM "managed_admin_credential" WHERE "userId" = ?1`,
          [row.userId],
        )
      }),
  )
}

export const reconcileManagedAdminCredentialsUncached = Effect.fn(
  "auth.reconcileManagedAdminCredentials",
)(function* (env: Env) {
  const controlPlane = requireControlPlane(env)
  const config = yield* getAdminConfig(env)
  const configuredEmails = new Set(config.adminEmails.map((email) => email.trim().toLowerCase()))
  if (configuredEmails.size === 0) {
    return yield* promiseOrDie(() => removeStaleAdmins(controlPlane, configuredEmails))
  }

  const password = adminPassword(env)
  const now = new Date().toISOString()
  yield* promiseOrDie(() =>
    Promise.all(
      [...configuredEmails].map((email) => reconcileAdmin(controlPlane, email, password, now)),
    ).then(() => undefined),
  )
  yield* promiseOrDie(() => removeStaleAdmins(controlPlane, configuredEmails))
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
