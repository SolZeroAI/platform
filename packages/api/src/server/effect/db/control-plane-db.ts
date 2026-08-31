/* oxlint-disable s0-lint/no-if-statement, s0-lint/no-ternary, s0-lint/no-return-in-arrow, s0-lint/no-return-in-callback -- Control-plane dialect selection is an imperative adapter boundary between D1 sqlite and Hyperdrive postgres. */
import { defineRelations } from "drizzle-orm"
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres"
import * as Context from "effect/Context"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import {
  APP_DB_MODE_ENV,
  APP_HYPERDRIVE_BINDING,
  parseAppDbMode,
  parseS0DatabaseEngine,
  S0_DATABASE_ENGINE_ENV,
  type AppDbMode,
  type S0DatabaseEngine,
} from "@solzero/shared"
import type { ApiEnv } from "infra/types/env"
import { makeD1Drizzle, type D1DrizzleDatabase } from "./d1-drizzle"
import {
  jsonArrayContainsAny,
  jsonArrayElementsFrom,
  jsonArrayElementValue,
  placeholder,
  rewriteSqlitePlaceholders,
  type ControlPlaneDialect,
} from "./dialect"
import * as sqliteSchema from "./schema"
import * as pgSchema from "./schema.pg"

export type AppSchema = typeof sqliteSchema
export type AppDrizzleDatabase = D1DrizzleDatabase
export type { ControlPlaneDialect }

const sqliteRelations = defineRelations(sqliteSchema)
const pgRelations = defineRelations(pgSchema)

export interface ControlPlaneDb {
  readonly engine: S0DatabaseEngine
  readonly dialect: ControlPlaneDialect
  readonly drizzle: AppDrizzleDatabase
  readonly schema: AppSchema
}

export class ControlPlane extends Context.Service<ControlPlane, ControlPlaneDb>()(
  "s0/api/ControlPlane",
) {}

export function isControlPlaneDb(value: unknown): value is ControlPlaneDb {
  return (
    typeof value === "object" &&
    value !== null &&
    "drizzle" in value &&
    "schema" in value &&
    "dialect" in value &&
    "engine" in value
  )
}

export function resolveControlPlaneHandle(db: AppDrizzleDatabase | ControlPlaneDb): ControlPlaneDb {
  return Match.value(isControlPlaneDb(db)).pipe(
    Match.when(true, () => db as ControlPlaneDb),
    Match.orElse(() => ({
      engine: "d1" as const,
      dialect: "sqlite" as const,
      drizzle: db as AppDrizzleDatabase,
      schema: sqliteSchema,
    })),
  )
}

export function controlPlaneDialectForEngine(engine: S0DatabaseEngine): ControlPlaneDialect {
  return Match.value(engine).pipe(
    Match.when("planetscale", () => "postgres" as const),
    Match.orElse(() => "sqlite" as const),
  )
}

export function databaseEngineFromEnv(env: Pick<ApiEnv, typeof S0_DATABASE_ENGINE_ENV> | object) {
  return parseS0DatabaseEngine((env as Record<string, unknown>)[S0_DATABASE_ENGINE_ENV])
}

export function appDbModeFromEnv(env: object, fallback: AppDbMode): AppDbMode {
  return parseAppDbMode((env as Record<string, unknown>)[APP_DB_MODE_ENV], fallback)
}

export function hasControlPlane(env: ApiEnv): boolean {
  return Match.value(databaseEngineFromEnv(env)).pipe(
    Match.when("planetscale", () => true),
    Match.orElse(() =>
      Option.fromNullishOr(env.DB).pipe(
        Option.filter((db) => typeof db.prepare === "function"),
        Option.isSome,
      ),
    ),
  )
}

function rawQueryRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows?: T[] }).rows ?? []) as T[]
  }
  return []
}

function withSqliteRawQueryCompat(db: object): AppDrizzleDatabase {
  const execute = Reflect.get(db, "execute")
  const all = async <T>(query: unknown) => {
    if (typeof execute !== "function") return [] as T[]
    return rawQueryRows<T>(await execute.call(db, query))
  }
  return Object.assign(db, { all }) as unknown as AppDrizzleDatabase
}

const postgresControlPlanes = new WeakMap<object, ControlPlaneDb>()

export function makePostgresControlPlane(drizzle: object): ControlPlaneDb {
  return {
    engine: "planetscale",
    dialect: "postgres",
    drizzle: withSqliteRawQueryCompat(drizzle),
    schema: pgSchema as unknown as AppSchema,
  }
}

export function requireD1Database(env: ApiEnv): D1Database {
  return Option.fromNullishOr(env.DB).pipe(
    Option.filter((db): db is D1Database => typeof db.prepare === "function"),
    Option.getOrThrowWith(
      () => new Error("D1 binding DB is required when S0_DATABASE_ENGINE is d1"),
    ),
  )
}

export function hyperdriveConnectionString(env: ApiEnv): string {
  const hyperdrive = (env as unknown as Record<string, { connectionString?: string } | undefined>)[
    APP_HYPERDRIVE_BINDING
  ]
  return Option.fromNullishOr(hyperdrive?.connectionString).pipe(
    Option.filter((value) => value.length > 0),
    Option.getOrThrowWith(
      () =>
        new Error(`${APP_HYPERDRIVE_BINDING} is required when S0_DATABASE_ENGINE is planetscale`),
    ),
  )
}

export function makePgPromiseDrizzle(connectionString: string, maxConnections: number) {
  return drizzlePg({
    connection: { connectionString, max: maxConnections },
    relations: pgRelations,
  })
}

function postgresMaxConnections(mode: AppDbMode) {
  return Match.value(mode).pipe(
    Match.when("local", () => 1),
    Match.orElse(() => 4),
  )
}

function planetscaleControlPlane(env: ApiEnv, appDbModeFallback: AppDbMode): ControlPlaneDb {
  return makePostgresControlPlane(
    makePgPromiseDrizzle(
      hyperdriveConnectionString(env),
      postgresMaxConnections(appDbModeFromEnv(env, appDbModeFallback)),
    ),
  )
}

function d1ControlPlane(env: ApiEnv): ControlPlaneDb {
  return {
    engine: "d1",
    dialect: "sqlite",
    drizzle: makeD1Drizzle(requireD1Database(env)),
    schema: sqliteSchema,
  }
}

export function makeControlPlaneFromEnv(env: ApiEnv, appDbModeFallback: AppDbMode = "remote") {
  return Match.value(databaseEngineFromEnv(env)).pipe(
    Match.when("planetscale", () => {
      const cached = postgresControlPlanes.get(env)
      if (cached) return cached
      const created = planetscaleControlPlane(env, appDbModeFallback)
      postgresControlPlanes.set(env, created)
      return created
    }),
    Match.orElse(() => d1ControlPlane(env)),
  )
}

export async function runControlPlaneSql<T = Record<string, unknown>>(
  env: ApiEnv,
  sqliteSql: string,
  binds: unknown[] = [],
): Promise<T[]> {
  const engine = databaseEngineFromEnv(env)
  if (engine === "d1") {
    const result = await requireD1Database(env)
      .prepare(sqliteSql)
      .bind(...binds)
      .all<T>()
    return result.results ?? []
  }
  const db = makeControlPlaneFromEnv(env)
  const rewritten = rewriteSqlitePlaceholders(sqliteSql, "postgres")
  const client = (
    db.drizzle as {
      $client?: { query: (text: string, values: unknown[]) => Promise<{ rows: T[] }> }
    }
  ).$client
  if (!client) {
    throw new Error("Postgres client is required when S0_DATABASE_ENGINE is planetscale")
  }
  const result = await client.query(rewritten, binds)
  return result.rows ?? []
}

export async function runControlPlaneSqlFirst<T = Record<string, unknown>>(
  env: ApiEnv,
  sqliteSql: string,
  binds: unknown[] = [],
): Promise<T | null> {
  const rows = await runControlPlaneSql<T>(env, sqliteSql, binds)
  return rows[0] ?? null
}

export function controlPlaneSql(db: ControlPlaneDb) {
  return {
    placeholder: (index: number) => placeholder(db.dialect, index),
    rewrite: (query: string) => rewriteSqlitePlaceholders(query, db.dialect),
    jsonArrayContainsAny: (
      column: Parameters<typeof jsonArrayContainsAny>[1],
      values: readonly string[],
    ) => jsonArrayContainsAny(db.dialect, column, values),
    jsonArrayElementsFrom: (column: Parameters<typeof jsonArrayElementsFrom>[1]) =>
      jsonArrayElementsFrom(db.dialect, column),
    jsonArrayElementValue: () => jsonArrayElementValue(db.dialect),
  }
}

export { pgRelations, pgSchema, sqliteRelations, sqliteSchema }
