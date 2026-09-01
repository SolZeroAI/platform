import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, "../..")
const migrationsDir = resolve(repoRoot, "packages/infra/d1-migrations")
const betterAuthMigration = resolve(migrationsDir, "0006_better_auth.sql")
const resourcesPath = resolve(repoRoot, "apps/api/infra/resources.ts")
const s0Path = resolve(repoRoot, "packages/infra/src/s0.ts")
const stackPath = resolve(repoRoot, "packages/infra/src/stack.ts")
const alchemyPatchPath = resolve(repoRoot, "patches/alchemy@2.0.0-beta.74.patch")

describe("numbered D1 migration apply path", () => {
  it("wires Cloudflare.D1.Database to packages/infra/d1-migrations", () => {
    const resources = readFileSync(resourcesPath, "utf8")
    const s0 = readFileSync(s0Path, "utf8")

    expect(s0).toContain('resolve(infraDir, "d1-migrations")')
    expect(s0).toContain("migrationsDir")
    expect(resources).toMatch(/Cloudflare\.D1\.Database\(\s*"db"/)
    expect(resources).toContain("migrations: migrationsDir")
    expect(resources).not.toContain("alchemy/Drizzle")
    expect(s0).not.toContain("alchemy/Drizzle")
  })

  it("creates Better Auth user from 0006_better_auth.sql on empty SQLite", () => {
    expect(existsSync(betterAuthMigration)).toBe(true)
    const sql = readFileSync(betterAuthMigration, "utf8")
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "user"/)

    const db = new DatabaseSync(":memory:")
    try {
      db.exec(sql)
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user' LIMIT 1`)
        .get() as { name?: string } | undefined
      expect(row?.name).toBe("user")
    } finally {
      db.close()
    }
  })

  it("selects Alchemy localState for local stages and Cloudflare.state for pre/prod", () => {
    const stack = readFileSync(stackPath, "utf8")
    expect(stack).toContain("getStageMetadataFromConfig")
    expect(stack).toContain("metadata.infra.alchemyStateStore")
    expect(stack).toContain("localState()")
    expect(stack).toContain("Cloudflare.state()")
    expect(stack).not.toContain("getAlchemyStateStoreKind")
    expect(stack).not.toContain("alchemyStateStoreKindFromStage")
    expect(stack).not.toContain("localD1HasAppliedMigrationRows")
  })

  it("does not patch Alchemy D1 ProviderLocal with a workerd bookkeeping probe", () => {
    const patch = readFileSync(alchemyPatchPath, "utf8")
    expect(patch).not.toContain("localD1HasAppliedMigrationRows")
    expect(patch).not.toContain("diff --git a/src/Cloudflare/D1/Database.ts")
  })
})
