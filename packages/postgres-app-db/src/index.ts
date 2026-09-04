import { defineRelations } from "drizzle-orm"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import { PgClient } from "@effect/sql-pg"
import * as pgSchema from "@solzero/api/schema.pg"

const relations = defineRelations(pgSchema)

export type PostgresAppDrizzleDatabase = PgDrizzle.EffectPgDatabase<typeof relations> & {
  $client: PgClient.PgClient
}

export class PostgresAppDrizzle extends Context.Service<
  PostgresAppDrizzle,
  PostgresAppDrizzleDatabase
>()("s0/postgres-app-db/PostgresAppDrizzle") {}

export interface PostgresAppDrizzleLiveOptions {
  readonly connectionString: string
  readonly maxConnections: number
}

export function PostgresAppDrizzleLive(options: PostgresAppDrizzleLiveOptions) {
  return Layer.effect(
    PostgresAppDrizzle,
    PgDrizzle.makeWithDefaults({ relations }).pipe(
      Effect.map((db) => db as PostgresAppDrizzleDatabase),
    ),
  ).pipe(
    Layer.provide(
      PgClient.layer({
        url: Redacted.make(options.connectionString),
        maxConnections: options.maxConnections,
      }),
    ),
  )
}

export { pgSchema, relations as pgRelations }
