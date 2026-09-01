/* oxlint-disable s0-lint/no-if-statement, s0-lint/prefer-option-over-null, effect/imperative-loops -- Schema presence and SQL splitting are imperative D1 persistence boundaries. */
import * as Effect from "effect/Effect"
import { toError } from "../../lib/effect-errors"
import { D1_MIGRATION_SQL } from "./d1-migration-sql"
import type { Env } from "../types"

type QueryableEnv = Env & {
  DB: D1Database & {
    prepare: (...args: unknown[]) => D1PreparedStatement
    batch: <T = unknown>(statements: D1PreparedStatement[]) => Promise<D1Result<T>[]>
  }
}

const schemaByEnv = new WeakMap<object, Promise<void>>()

function promiseOrDie<A>(tryPromise: () => Promise<A>) {
  return Effect.tryPromise({ try: tryPromise, catch: toError }).pipe(Effect.orDie)
}

function queryableEnv(env: Env): QueryableEnv {
  if (!env.DB) {
    throw new Error("D1 is required to apply the control-plane schema")
  }
  // SAFETY: Env.DB is the Worker D1 binding; prepare and batch are the apply surface.
  return env as QueryableEnv
}

async function hasUserTable(db: QueryableEnv["DB"]): Promise<boolean> {
  const row = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user' LIMIT 1`)
    .first<{ name: string }>()
  return Boolean(row?.name)
}

/**
 * Split a migration file into executable statements. Local workerd D1 `exec()`
 * rejects multi-line SQL (`incomplete input`), so the Worker applies one
 * prepared statement at a time.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ""
  let quote = ""
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]
    const next = sql[index + 1]
    if (quote.length > 0) {
      current += character
      if (character === quote) {
        if (next === quote) {
          current += next
          index += 1
        } else {
          quote = ""
        }
      }
      continue
    }
    if (character === "-" && next === "-") {
      const newline = sql.indexOf("\n", index)
      if (newline === -1) break
      index = newline
      current += "\n"
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      current += character
      continue
    }
    if (character === ";") {
      const statement = current.trim()
      if (statement.length > 0) statements.push(statement)
      current = ""
      continue
    }
    current += character
  }
  const trailing = current.trim()
  if (trailing.length > 0) statements.push(trailing)
  return statements
}

function applyMigration(db: QueryableEnv["DB"], sql: string): Promise<void> {
  const statements = splitSqlStatements(sql)
  if (statements.length === 0) return Promise.resolve()
  return db.batch(statements.map((statement) => db.prepare(statement))).then(() => undefined)
}

export const ensureD1SchemaUncached = Effect.fn("db.ensureD1Schema")(function* (env: Env) {
  const db = queryableEnv(env).DB
  if (yield* promiseOrDie(() => hasUserTable(db))) {
    return
  }

  yield* Effect.forEach(
    D1_MIGRATION_SQL,
    (migration) => promiseOrDie(() => applyMigration(db, migration.sql)),
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
