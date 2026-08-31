import { resolve } from "node:path"
import * as Output from "alchemy/Output"
import * as Planetscale from "alchemy/Planetscale"
import * as PlanetscaleLogicalDb from "alchemy-planetscale-logical-db"
import * as Effect from "effect/Effect"
import { INFRA_DIR } from "./runtime"

export interface CreatePlanetscaleAppDatabaseInput {
  readonly appName: string
  readonly stageName: string
}

export function pgMigrationsDir() {
  return resolve(INFRA_DIR, "migrations/pg")
}

export function createPlanetscaleAppDatabase(input: CreatePlanetscaleAppDatabaseInput) {
  return Effect.gen(function* () {
    const database = yield* Planetscale.PostgresDatabase("postgres", {
      clusterSize: "PS_10",
      name: `${input.appName}-postgres-${input.stageName}`,
    })
    const adminRole = yield* Planetscale.PostgresRole("postgres-admin", {
      branch: "main",
      database,
      inheritedRoles: ["postgres"],
      successor: "postgres",
    })
    const appRole = yield* Planetscale.PostgresRole("postgres-app", {
      branch: "main",
      database,
      inheritedRoles: [],
      successor: "postgres",
    })
    const logicalDatabase = yield* PlanetscaleLogicalDb.PostgresLogicalDatabase("app-database", {
      adminOrigin: adminRole.origin,
      appRoleName: Output.map(appRole.username, PlanetscaleLogicalDb.postgresRoleNameFromUsername),
      appRolePrivilegesVersion: 1,
      migrationsDir: pgMigrationsDir(),
      name: "s0",
    })
    return { database, adminRole, appRole, logicalDatabase }
  })
}
