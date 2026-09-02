import { drizzle } from "drizzle-orm/postgres-js"
import * as Match from "effect/Match"
import postgres from "postgres"
import type { ApiEnv } from "infra/types/env"
import type { AppDbMode } from "@solzero/shared"
import {
  appDbModeFromEnv,
  hyperdriveConnectionString,
  makePostgresControlPlane,
  pgRelations,
  registerPostgresControlPlaneFactory,
  serializePostgresDates,
} from "./control-plane-db"

function postgresMaxConnections(mode: AppDbMode) {
  return Match.value(mode).pipe(
    Match.when("local", () => 1),
    Match.orElse(() => 4),
  )
}

export function makePgPromiseDrizzle(connectionString: string, maxConnections: number) {
  const client = postgres(connectionString, {
    max: maxConnections,
    prepare: false,
    fetch_types: false,
  })
  const db = drizzle({ client, relations: pgRelations })
  serializePostgresDates(client)
  return db
}

function createPlanetscaleControlPlane(env: ApiEnv, fallback: AppDbMode) {
  return makePostgresControlPlane(
    makePgPromiseDrizzle(
      hyperdriveConnectionString(env),
      postgresMaxConnections(appDbModeFromEnv(env, fallback)),
    ),
  )
}

registerPostgresControlPlaneFactory(createPlanetscaleControlPlane)
