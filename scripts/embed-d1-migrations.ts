import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const migrationsDir = resolve(repoRoot, "packages/infra/d1-migrations")
const outputPath = resolve(repoRoot, "packages/api/src/server/background/db/d1-migration-sql.ts")

const files = readdirSync(migrationsDir)
  .filter((filename) => filename.endsWith(".sql"))
  .sort()

const entries = files.map((filename) => {
  const sql = readFileSync(resolve(migrationsDir, filename), "utf8")
  return `  {\n    id: ${JSON.stringify(filename)},\n    sql: ${JSON.stringify(sql)},\n  }`
})

const contents = `/* Generated from packages/infra/d1-migrations. Run \`nub exec tsx scripts/embed-d1-migrations.ts\`. */
export interface D1MigrationSql {
  readonly id: string
  readonly sql: string
}

export const D1_MIGRATION_SQL: readonly D1MigrationSql[] = [
${entries.join(",\n")},
]
`

writeFileSync(outputPath, contents)
console.log(`Wrote ${files.length} migrations to ${outputPath}`)
