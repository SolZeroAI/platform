/* oxlint-disable solzero/no-if-statement, solzero/no-ternary, solzero/no-return-in-arrow -- Control-plane dialect selection is an imperative adapter boundary between D1 sqlite and Hyperdrive postgres. */
import { AsyncLocalStorage } from "node:async_hooks"
import { defineRelations } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import {
  APP_DB_MODE_ENV,
  APP_HYPERDRIVE_BINDING,
  parseAppDbMode,
  DATABASE_ENV,
  databaseEngineFromRecord,
  type AppDbMode,
  type S0DatabaseEngine,
} from "@solzero/shared"
import type { ApiEnv } from "infra/types/env"
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- control-plane-db.ts builds openD1Drizzle from the D1 binding at the composition edge because d1ControlPlane owns drizzle construction.
import { openD1Drizzle, type D1DrizzleDatabase } from "./d1-drizzle"
import {
  asFiniteNumber,
  countStar,
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

type ControlPlaneCandidate = AppDrizzleDatabase | ControlPlaneDb | D1Database

export function isControlPlaneDb(value: ControlPlaneCandidate): value is ControlPlaneDb {
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
  // SAFETY: isControlPlaneDb splits AppDrizzleDatabase | ControlPlaneDb. The true arm is ControlPlaneDb and the false arm is the D1 drizzle handle.
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

interface DatabaseEngineSource {
  readonly [DATABASE_ENV]?: unknown
}

export function databaseEngineFromEnv(env: DatabaseEngineSource) {
  return databaseEngineFromRecord(env)
}

interface AppDbModeSource {
  readonly [APP_DB_MODE_ENV]?: unknown
}

export function appDbModeFromEnv(env: AppDbModeSource, fallback: AppDbMode): AppDbMode {
  return parseAppDbMode(env[APP_DB_MODE_ENV], fallback)
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
  if (Array.isArray(result)) {
    // SAFETY: Array.isArray established a row list. T is the caller's SQL row contract.
    return result as T[]
  }

  if (result && typeof result === "object" && "rows" in result) {
    // SAFETY: Postgres drivers put the caller's rows on the rows field. T is that SQL row contract.
    return (result as { rows?: T[] }).rows ?? []
  }

  return []
}

interface D1StatementMethods {
  readonly all?: unknown
  readonly first?: unknown
  readonly run?: unknown
}

async function runD1PreparedSql<T>(
  db: D1Database,
  sqliteSql: string,
  binds: unknown[],
): Promise<T[]> {
  // SAFETY: D1 prepared statements expose all, first, or run. Some bindings omit methods, so each one stays optional.
  const statement = db.prepare(sqliteSql).bind(...binds) as D1StatementMethods
  const all = statement.all

  if (typeof all === "function") {
    const result = await all.call(statement)

    if (result && typeof result === "object" && "results" in result) {
      // SAFETY: D1 all() puts the caller's rows on results. T is that SQL row contract.
      return (result as { results?: T[] }).results ?? []
    }

    return rawQueryRows<T>(result)
  }

  const first = statement.first

  if (typeof first === "function") {
    const row = await first.call(statement)

    // SAFETY: D1 first() returns one row of the caller's SQL contract T, or null when no row exists.
    return row ? [row as T] : []
  }

  const run = statement.run

  if (typeof run === "function") {
    await run.call(statement)

    return []
  }

  throw new Error("D1 statement must implement all(), first(), or run()")
}

const POSTGRES_DATE_OIDS = ["1184", "1082", "1083", "1114", "1182", "1185", "1115", "1231"] as const

export function serializePostgresDate(value: unknown) {
  return value instanceof Date ? value.toISOString() : value
}

export function serializePostgresDates(client: {
  readonly options?: { serializers?: Record<string, (value: unknown) => unknown> }
}) {
  const serializers = client.options?.serializers

  if (!serializers) return

  for (const oid of POSTGRES_DATE_OIDS) {
    serializers[oid] = serializePostgresDate
  }
}

interface PostgresSqlClient {
  readonly unsafe?: unknown
  readonly query?: unknown
}

function isPostgresQueryClient(value: unknown): value is PostgresSqlClient {
  return typeof value === "function" || (typeof value === "object" && value !== null)
}

async function queryPostgresClient<T>(
  client: PostgresSqlClient,
  text: string,
  binds: unknown[],
): Promise<T[]> {
  const unsafe = client.unsafe

  if (typeof unsafe === "function") {
    return rawQueryRows<T>(await unsafe.call(client, text, binds))
  }

  const query = client.query

  if (typeof query === "function") {
    return rawQueryRows<T>(await query.call(client, text, binds))
  }

  throw new Error("Postgres client is required when DATABASE is planetscale")
}

interface SqliteRawQueryDb {
  readonly execute?: unknown
}

interface DrizzleClientCarrier {
  readonly $client?: unknown
}

function withSqliteRawQueryCompat(db: SqliteRawQueryDb): AppDrizzleDatabase {
  const execute = db.execute

  const all = async <T>(query: unknown) => {
    if (typeof execute !== "function") {
      // SAFETY: a drizzle handle without execute has no rows. T is the caller's SQL row contract.
      return [] as T[]
    }

    return rawQueryRows<T>(await execute.call(db, query))
  }

  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- Object.assign keeps the driver drizzle instance. AppDrizzleDatabase is the D1 drizzle type and does not overlap that postgres handle.
  return Object.assign(db, { all }) as unknown as AppDrizzleDatabase
}

const requestControlPlane = new AsyncLocalStorage<ControlPlaneDb>()

type PostgresControlPlaneFactory = (env: ApiEnv, fallback: AppDbMode) => ControlPlaneDb

let postgresControlPlaneFactory = Option.none<PostgresControlPlaneFactory>()

export function registerPostgresControlPlaneFactory(factory: PostgresControlPlaneFactory) {
  postgresControlPlaneFactory = Option.some(factory)
}

export function makePostgresControlPlane(drizzle: SqliteRawQueryDb): ControlPlaneDb {
  return {
    engine: "planetscale",
    dialect: "postgres",
    drizzle: withSqliteRawQueryCompat(drizzle),
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- The pg schema module and sqlite AppSchema are different drizzle modules and do not overlap. The runtime dialect selects which schema is read.
    schema: pgSchema as unknown as AppSchema,
  }
}

export function requireD1Database(env: ApiEnv): D1Database {
  return Option.fromNullishOr(env.DB).pipe(
    Option.filter((db): db is D1Database => typeof db.prepare === "function"),
    Option.getOrThrowWith(() => new Error("D1 binding DB is required when DATABASE is d1")),
  )
}

interface HyperdriveBindingSource {
  readonly [APP_HYPERDRIVE_BINDING]?: {
    readonly connectionString?: string
  }
}

export function hyperdriveConnectionString(env: ApiEnv): string {
  // SAFETY: APP_HYPERDRIVE is the stage Hyperdrive binding. ApiEnv does not name that binding, and the binding exposes connectionString.
  const hyperdrive = (env as HyperdriveBindingSource)[APP_HYPERDRIVE_BINDING]

  return Option.fromNullishOr(hyperdrive?.connectionString).pipe(
    Option.filter((value) => value.length > 0),
    Option.getOrThrowWith(
      () => new Error(`${APP_HYPERDRIVE_BINDING} is required when DATABASE is planetscale`),
    ),
  )
}

function planetscaleControlPlane(env: ApiEnv, appDbModeFallback: AppDbMode): ControlPlaneDb {
  return Option.getOrThrowWith(
    postgresControlPlaneFactory,
    () =>
      new Error(
        "Postgres control-plane factory is not registered. Import @solzero/api/server on the Worker entry.",
      ),
  )(env, appDbModeFallback)
}

function d1ControlPlane(env: ApiEnv): ControlPlaneDb {
  return {
    engine: "d1",
    dialect: "sqlite",
    get drizzle() {
      return openD1Drizzle(requireD1Database(env))
    },
    schema: sqliteSchema,
  }
}

export function makeControlPlaneFromEnv(env: ApiEnv, appDbModeFallback: AppDbMode = "remote") {
  return Match.value(databaseEngineFromEnv(env)).pipe(
    Match.when("planetscale", () =>
      Option.getOrElse(Option.fromNullishOr(requestControlPlane.getStore()), () =>
        planetscaleControlPlane(env, appDbModeFallback),
      ),
    ),
    Match.orElse(() => d1ControlPlane(env)),
  )
}

export function withRequestControlPlane<A>(
  env: ApiEnv,
  body: () => A,
  appDbModeFallback: AppDbMode = "remote",
): A {
  return Option.match(Option.fromNullishOr(requestControlPlane.getStore()), {
    onSome: () => body(),
    onNone: () => requestControlPlane.run(makeControlPlaneFromEnv(env, appDbModeFallback), body),
  })
}

export async function runControlPlaneSql<T = Record<string, unknown>>(
  env: ApiEnv,
  sqliteSql: string,
  binds: unknown[] = [],
): Promise<T[]> {
  const engine = databaseEngineFromEnv(env)

  if (engine === "d1") {
    return runD1PreparedSql<T>(requireD1Database(env), sqliteSql, binds)
  }

  const db = makeControlPlaneFromEnv(env)
  const rewritten = rewriteSqlitePlaceholders(sqliteSql, "postgres")
  // SAFETY: PlanetScale drizzle stores the postgres.js client on $client. AppDrizzleDatabase names the D1 handle, which does not list that field.
  const client = (db.drizzle as DrizzleClientCarrier).$client

  // postgres.js clients are tagged-template functions (`typeof` is "function").
  if (!isPostgresQueryClient(client)) {
    throw new Error("Postgres client is required when DATABASE is planetscale")
  }

  return queryPostgresClient<T>(client, rewritten, binds)
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
    countStar: () => countStar(db.dialect),
    asFiniteNumber,
  }
}

export { pgRelations, pgSchema, sqliteRelations, sqliteSchema }
