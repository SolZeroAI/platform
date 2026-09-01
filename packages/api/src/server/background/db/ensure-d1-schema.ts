/* oxlint-disable s0-lint/no-if-statement -- Schema presence is an imperative D1 persistence boundary. */
import * as Effect from "effect/Effect"
import { toError } from "../../lib/effect-errors"
import { D1_MIGRATION_SQL } from "./d1-migration-sql"
import type { Env } from "../types"

type QueryableEnv = Env & {
  DB: D1Database & {
    prepare: (...args: unknown[]) => D1PreparedStatement
    exec: (query: string) => Promise<D1ExecResult>
  }
}

const schemaByEnv = new WeakMap<object, Promise<void>>()

function promiseOrDie<A>(tryPromise: () => Promise<A>) {
  return Effect.tryPromise({ try: tryPromise, catch: toError }).pipe(Effect.orDie)
}

function queryableEnv(env: Env): QueryableEnv {
  if (!env.DB || typeof env.DB.prepare !== "function" || typeof env.DB.exec !== "function") {
    throw new Error("D1 is required to apply the control-plane schema")
  }
  return env as QueryableEnv
}

async function hasUserTable(db: QueryableEnv["DB"]): Promise<boolean> {
  const row = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user' LIMIT 1`)
    .first<{ name: string }>()
  return Boolean(row?.name)
}

export const ensureD1SchemaUncached = Effect.fn("db.ensureD1Schema")(function* (env: Env) {
  const db = queryableEnv(env).DB
  if (yield* promiseOrDie(() => hasUserTable(db))) {
    return
  }

  yield* Effect.forEach(
    D1_MIGRATION_SQL,
    (migration) => promiseOrDie(() => db.exec(migration.sql).then(() => undefined)),
    { concurrency: 1, discard: true },
  )
  yield* Effect.logInfo("Applied D1 control-plane schema").pipe(
    Effect.annotateLogs({
      migrationCount: D1_MIGRATION_SQL.length,
      reason: "missing-user-table",
    }),
  )
})

export function ensureD1Schema(env: Env): Promise<void> {
  const existing = schemaByEnv.get(env)
  if (existing) return existing

  // oxlint-disable-next-line effect/effect-run-in-body -- Worker adapters consume this idempotent schema apply as a cached Promise.
  const work = Effect.runPromise(ensureD1SchemaUncached(env)).catch((error) => {
    schemaByEnv.delete(env)
    throw error
  })
  schemaByEnv.set(env, work)
  return work
}
