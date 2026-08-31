import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { PGlite } from "@electric-sql/pglite"

const migrationsFolder = resolve(import.meta.dirname, "../../packages/infra/migrations/pg")

export async function applyPostgresMigrationTree(client: PGlite) {
  for (const filename of readdirSync(migrationsFolder)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await client.exec(readFileSync(resolve(migrationsFolder, filename), "utf8"))
  }
}
