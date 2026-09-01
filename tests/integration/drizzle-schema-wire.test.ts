import { readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { getTableName } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { user } from "../../packages/api/src/server/effect/db/schema"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const drizzleOutDir = resolve(__dirname, "../../packages/infra/drizzle")

function getDrizzleMigrationSql(): string {
  const dirs = readdirSync(drizzleOutDir)
    .filter((name) => /^\d{14}_/.test(name))
    .sort()
  expect(dirs.length).toBeGreaterThan(0)
  return dirs
    .map((dir) => readFileSync(resolve(drizzleOutDir, dir, "migration.sql"), "utf8"))
    .join("\n")
}

describe("Drizzle.Schema control-plane wire", () => {
  it("defines Better Auth user in the sqlite schema module", () => {
    expect(getTableName(user)).toBe("user")
  })

  it("emits CREATE TABLE user from the committed Drizzle.Schema out directory", () => {
    const sql = getDrizzleMigrationSql()
    expect(sql).toMatch(/CREATE TABLE `user`/)
  })

  it("applies the Drizzle.Schema SQL to an empty SQLite database including user", () => {
    const db = new DatabaseSync(":memory:")
    try {
      db.exec(getDrizzleMigrationSql().replaceAll("--> statement-breakpoint", ""))
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user' LIMIT 1`)
        .get() as { name?: string } | undefined
      expect(row?.name).toBe("user")
    } finally {
      db.close()
    }
  })
})
