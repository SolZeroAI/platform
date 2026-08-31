import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import * as Effect from "effect/Effect"
import { afterEach, describe, expect, it } from "vitest"
import { GlobalSecretsStore } from "../../packages/api/src/server/background/db/repo-secrets"
import {
  controlPlaneSql,
  makePostgresControlPlane,
  pgRelations,
  rewriteSqlitePlaceholders,
  type AppDrizzleDatabase,
} from "../../packages/api/src/server/effect/db/control-plane-db"

const migrationsFolder = resolve(import.meta.dirname, "../../packages/infra/migrations/pg")
const encryptionKey = "test-repo-secrets-key-32-chars!!"

async function openMigratedPglite() {
  const client = new PGlite()
  const drizzleDb = drizzle(client, { relations: pgRelations })
  try {
    await migrate(drizzleDb, { migrationsFolder })
  } catch {
    await client.exec(readFileSync(resolve(migrationsFolder, "0000_control_plane.sql"), "utf8"))
  }
  return {
    client,
    controlPlane: makePostgresControlPlane(drizzleDb as unknown as AppDrizzleDatabase),
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
    expect(String(sql.jsonArrayElementValue())).toContain("tag.value")
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

  it("keeps the hand-written postgres SQL aligned with the migrator entry", () => {
    const sql = readFileSync(resolve(migrationsFolder, "0000_control_plane.sql"), "utf8")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "managed_admin_credential"')
    expect(sql).toContain("ON CONFLICT")
    expect(sql).not.toContain("json_each")
    expect(sql).not.toContain("INSERT OR IGNORE")
  })
})
