import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { PGLiteSocketServer } from "@electric-sql/pglite-socket"
import { drizzle } from "drizzle-orm/pglite"
import * as Effect from "effect/Effect"
import { afterEach, describe, expect, it } from "vitest"
import { GlobalSecretsStore } from "../../packages/api/src/server/background/db/repo-secrets"
import {
  controlPlaneSql,
  makeControlPlaneFromEnv,
  makePostgresControlPlane,
  pgRelations,
  registerPostgresControlPlaneFactory,
  runControlPlaneSql,
  serializePostgresDate,
  serializePostgresDates,
  withRequestControlPlane,
  type AppDrizzleDatabase,
} from "../../packages/api/src/server/effect/db/control-plane-db"
import {
  asFiniteNumber,
  rewriteSqlitePlaceholders,
} from "../../packages/api/src/server/effect/db/dialect"
import { LOCAL_PGLITE_PORT } from "../../packages/shared/src"
import { applyPostgresMigrationTree } from "./pg-migrations"

const migrationsFolder = resolve(import.meta.dirname, "../../packages/infra/migrations/pg")
const encryptionKey = "test-repo-secrets-key-32-chars!!"

async function openMigratedPglite() {
  const client = new PGlite()
  await applyPostgresMigrationTree(client)
  const drizzleDb = drizzle({ client, relations: pgRelations })
  return {
    client,
    controlPlane: makePostgresControlPlane(drizzleDb),
    drizzle: drizzleDb,
  }
}

describe("PGLite control-plane flavor", () => {
  const clients: PGlite[] = []

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()))
  })

  it("applies the postgres migration tree without PlanetScale credentials", async () => {
    const opened = await openMigratedPglite()
    clients.push(opened.client)

    const tables = await opened.client.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    )
    const names = tables.rows.map((row) => row.table_name)
    expect(names).toContain("sessions")
    expect(names).toContain("global_secrets")
    expect(names).toContain("managed_admin_credential")
    expect(names).toContain("user")
    expect(names).toContain("account")
    expect(names).not.toContain("repo_secrets")
  })

  it("serializes Date binds for workerd postgres.js", () => {
    const date = new Date("2026-09-02T02:10:57.270Z")
    expect(serializePostgresDate(date)).toBe("2026-09-02T02:10:57.270Z")
    expect(serializePostgresDate("already")).toBe("already")
    const serializers: Record<string, (value: unknown) => unknown> = {
      "1184": (value) => value,
    }
    serializePostgresDates({ options: { serializers } })
    expect(serializers["1184"](date)).toBe("2026-09-02T02:10:57.270Z")
  })

  it("does not reuse a postgres.js client across request scopes", () => {
    const created: object[] = []
    registerPostgresControlPlaneFactory(() => {
      const client = Object.assign(function tagged() {}, { unsafe: async () => [] })
      created.push(client)
      return makePostgresControlPlane({ $client: client })
    })
    const env = { DATABASE: "planetscale" } as never
    const first = withRequestControlPlane(env, () => makeControlPlaneFromEnv(env))
    const second = withRequestControlPlane(env, () => makeControlPlaneFromEnv(env))
    expect(first).not.toBe(second)
    expect(created).toHaveLength(2)
    withRequestControlPlane(env, () => {
      expect(makeControlPlaneFromEnv(env)).toBe(makeControlPlaneFromEnv(env))
    })
    expect(created).toHaveLength(3)
  })

  it("runs raw SQL through a postgres.js function $client", async () => {
    const rows = [{ id: "admin_1" }]
    const client = Object.assign(
      function taggedTemplate() {
        return rows
      },
      {
        unsafe: async () => rows,
        query: async () => ({ rows }),
      },
    )
    expect(typeof client).toBe("function")
    registerPostgresControlPlaneFactory(() => makePostgresControlPlane({ $client: client }))
    await expect(
      runControlPlaneSql(
        { DATABASE: "planetscale" } as never,
        `SELECT "id" FROM "user" WHERE "id" = ?1`,
        ["admin_1"],
      ),
    ).resolves.toEqual(rows)
  })

  it("rewrites sqlite placeholders and json_each for postgres", () => {
    expect(rewriteSqlitePlaceholders(`SELECT * FROM "account" WHERE "id" = ?1`, "postgres")).toBe(
      `SELECT * FROM "account" WHERE "id" = $1`,
    )
    const sql = controlPlaneSql({
      engine: "planetscale",
      dialect: "postgres",
      drizzle: {} as AppDrizzleDatabase,
      schema: {} as never,
    })
    expect(sql.placeholder(2)).toBe("$2")
    expect(sql.rewrite(`SELECT * FROM "account" WHERE "id" = ?1`)).toBe(
      `SELECT * FROM "account" WHERE "id" = $1`,
    )
  })

  it("filters global secret tags through jsonb_array_elements", async () => {
    const opened = await openMigratedPglite()
    clients.push(opened.client)
    const store = new GlobalSecretsStore(opened.controlPlane, encryptionKey)

    await Effect.runPromise(
      store.setSecrets(
        [
          { key: "ALPHA_TOKEN", value: "a", tags: ["ops", "shared"] },
          { key: "BETA_TOKEN", value: "b", tags: ["ci"] },
        ],
        { userId: "user_1" },
      ),
    )

    const filtered = await Effect.runPromise(store.listSecrets({ userId: "user_1", tags: ["ops"] }))
    expect(filtered.secrets.map((secret) => secret.key)).toEqual(["ALPHA_TOKEN"])
  })

  it("boots pglite-socket as the documented Hyperdrive origin without PlanetScale tokens", async () => {
    const client = new PGlite()
    clients.push(client)
    await applyPostgresMigrationTree(client)
    const server = new PGLiteSocketServer({
      db: client,
      host: "127.0.0.1",
      port: 0,
    })
    await server.start()
    expect(LOCAL_PGLITE_PORT).toBe(15432)
    await server.stop()
  })

  it("keeps the hand-written postgres SQL aligned with the PlanetScale migration dir", () => {
    const sql = readFileSync(resolve(migrationsFolder, "0000_control_plane.sql"), "utf8")
    const emailVerified = readFileSync(
      resolve(migrationsFolder, "0001_email_verified_boolean.sql"),
      "utf8",
    )
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "managed_admin_credential"')
    expect(sql).toContain('"emailVerified" boolean DEFAULT false NOT NULL')
    expect(sql).toContain("ON CONFLICT")
    expect(sql).not.toContain("json_each")
    expect(sql).not.toContain("INSERT OR IGNORE")
    expect(emailVerified).toContain('ALTER TABLE "user" ALTER COLUMN "emailVerified" TYPE boolean')
  })

  it("stores Better Auth emailVerified as a postgres boolean", async () => {
    const opened = await openMigratedPglite()
    clients.push(opened.client)
    await opened.client.query(
      `INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       VALUES ('admin_1', 'Admin', 'admin@example.com', TRUE, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    const column = await opened.client.query<{ data_type: string; column_default: string }>(
      `SELECT data_type, column_default
         FROM information_schema.columns
        WHERE table_name = 'user' AND column_name = 'emailVerified'`,
    )
    expect(column.rows[0]?.data_type).toBe("boolean")
    const row = await opened.client.query<{ emailVerified: boolean }>(
      `SELECT "emailVerified" FROM "user" WHERE "id" = 'admin_1'`,
    )
    expect(row.rows[0]?.emailVerified).toBe(true)
  })

  it("sorts popular secret tags by numeric count, not int8 string order", async () => {
    expect(asFiniteNumber("10")).toBe(10)
    expect(asFiniteNumber("2")).toBe(2)
    expect(["10", "2"].sort()[0]).toBe("10")
    const opened = await openMigratedPglite()
    clients.push(opened.client)
    const store = new GlobalSecretsStore(opened.controlPlane, encryptionKey)
    const popular = Array.from({ length: 10 }, (_, index) => ({
      key: `POPULAR_${index}`,
      value: `v${index}`,
      tags: ["popular"],
    }))
    await Effect.runPromise(
      store.setSecrets(
        [
          ...popular,
          { key: "RARE_1", value: "r1", tags: ["rare"] },
          { key: "RARE_2", value: "r2", tags: ["rare"] },
        ],
        { userId: "user_1" },
      ),
    )
    const stats = await Effect.runPromise(store.listSecretTagStats({ userId: "user_1" }))
    expect(stats.popularTags[0]).toBe("popular")
    expect(stats.popularTags).toContain("rare")
  })
})
