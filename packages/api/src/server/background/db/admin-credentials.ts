import { CREDENTIAL_AUTH_PROVIDER_ID, type S0AuthConfig } from "@solzero/shared"
import { hashPassword, verifyPassword } from "better-auth/crypto"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { toError } from "../../lib/effect-errors"
import { runEffectPromise } from "../../lib/effect-promise"
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
  return Option.liftPredicate(env, hasControlPlane).pipe(
    Option.getOrThrowWith(
      () => new Error("Control-plane database is required to reconcile managed admin credentials"),
    ),
  )
}

function engineSql(env: Env, sql: { readonly planetscale: string; readonly sqlite: string }) {
  return Match.value(databaseEngineFromEnv(env)).pipe(
    Match.when("planetscale", () => sql.planetscale),
    Match.orElse(() => sql.sqlite),
  )
}

function insertIgnoreUserSql(env: Env) {
  return engineSql(env, {
    planetscale: `INSERT INTO "user"
         ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       VALUES (?1, ?2, ?3, TRUE, ?4, ?4)
       ON CONFLICT DO NOTHING`,
    sqlite: `INSERT OR IGNORE INTO "user"
         ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       VALUES (?1, ?2, ?3, 1, ?4, ?4)`,
  })
}

function insertIgnoreAccountSql(env: Env) {
  return engineSql(env, {
    planetscale: `INSERT INTO "account"
         ("id", "userId", "accountId", "providerId", "password", "createdAt", "updatedAt")
       VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT DO NOTHING`,
    sqlite: `INSERT OR IGNORE INTO "account"
         ("id", "userId", "accountId", "providerId", "password", "createdAt", "updatedAt")
       VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?5)`,
  })
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

async function findUserId(env: Env, email: string) {
  const row = await runControlPlaneSqlFirst<{ id: string }>(
    env,
    `SELECT "id" FROM "user" WHERE lower("email") = ?1 LIMIT 1`,
    [email],
  )

  return Option.map(Option.fromNullishOr(row), (user) => user.id)
}

async function createUser(env: Env, email: string, now: string) {
  await runControlPlaneSql(env, insertIgnoreUserSql(env), [
    crypto.randomUUID(),
    displayNameForEmail(email),
    email,
    now,
  ])

  const created = await findUserId(env, email)

  return Option.getOrThrowWith(
    created,
    () => new Error(`Failed to provision configured admin '${email}'`),
  )
}

async function findOrCreateUser(env: Env, email: string, now: string) {
  const existing = await findUserId(env, email)

  return Option.match(existing, {
    onNone: () => createUser(env, email, now),
    onSome: (userId) => userId,
  })
}

async function isPasswordCurrent(
  account: Option.Option<CredentialAccountRow>,
  plaintextPassword: string,
) {
  const hash = account.pipe(
    Option.flatMap((row) => Option.fromNullishOr(row.password)),
    Option.filter((password) => password.length > 0),
  )

  return Option.match(hash, {
    onNone: () => false,
    onSome: (current) => verifyPassword({ hash: current, password: plaintextPassword }),
  })
}

async function rotateAdminPassword(
  env: Env,
  userId: string,
  account: Option.Option<CredentialAccountRow>,
  plaintextPassword: string,
  now: string,
) {
  const password = await hashPassword(plaintextPassword)

  await Option.match(account, {
    onNone: () =>
      runControlPlaneSql(env, insertIgnoreAccountSql(env), [
        crypto.randomUUID(),
        userId,
        CREDENTIAL_AUTH_PROVIDER_ID,
        password,
        now,
      ]),
    onSome: (row) =>
      runControlPlaneSql(
        env,
        `UPDATE "account" SET "password" = ?1, "updatedAt" = ?2 WHERE "id" = ?3`,
        [password, now, row.id],
      ),
  })

  await runControlPlaneSql(env, `DELETE FROM "session" WHERE "userId" = ?1`, [userId])
}

async function reconcileAdmin(env: Env, email: string, plaintextPassword: string, now: string) {
  const userId = await findOrCreateUser(env, email, now)

  const accountRow = await runControlPlaneSqlFirst<CredentialAccountRow>(
    env,
    `SELECT "id", "password"
       FROM "account"
       WHERE "userId" = ?1 AND "providerId" = ?2
       LIMIT 1`,
    [userId, CREDENTIAL_AUTH_PROVIDER_ID],
  )

  const account = Option.fromNullishOr(accountRow)
  const passwordCurrent = await isPasswordCurrent(account, plaintextPassword)

  await Match.value(passwordCurrent).pipe(
    Match.when(false, () => rotateAdminPassword(env, userId, account, plaintextPassword, now)),
    Match.orElse(() => Promise.resolve()),
  )

  await runControlPlaneSql(
    env,
    `INSERT INTO "managed_admin_credential" ("userId", "email", "createdAt", "updatedAt")
       VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT("userId") DO UPDATE SET "email" = excluded."email", "updatedAt" = excluded."updatedAt"`,
    [userId, email, now],
  )
}

function reconcileAdmins(env: Env, emails: ReadonlyArray<string>) {
  const password = adminPassword(env)
  const now = new Date().toISOString()

  return Promise.all(emails.map((email) => reconcileAdmin(env, email, password, now)))
}

async function reconcileConfiguredAdmins(env: Env, configuredEmails: ReadonlySet<string>) {
  await Option.match(Option.liftPredicate([...configuredEmails], Arr.isArrayNonEmpty), {
    onNone: () => Promise.resolve([]),
    onSome: (emails) => reconcileAdmins(env, emails),
  })
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

  yield* promiseOrDie(() => reconcileConfiguredAdmins(controlPlane, configuredEmails))
  yield* promiseOrDie(() => removeStaleAdmins(controlPlane, configuredEmails))
})

export function reconcileManagedAdminCredentials(env: Env): Promise<void> {
  return Option.getOrElse(Option.fromUndefinedOr(reconciliationByEnv.get(env)), () =>
    startReconciliation(env),
  )
}

function startReconciliation(env: Env): Promise<void> {
  const reconciliation = runEffectPromise(reconcileManagedAdminCredentialsUncached(env)).catch(
    (error) => {
      reconciliationByEnv.delete(env)
      throw error
    },
  )

  reconciliationByEnv.set(env, reconciliation)

  return reconciliation
}
