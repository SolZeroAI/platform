/* oxlint-disable effect/avoid-process-env -- Local PGLite Hyperdrive origin is an operator-selected process. */
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { PGLiteSocketServer } from "@electric-sql/pglite-socket"
import { LOCAL_PGLITE_DATABASE_URL, LOCAL_PGLITE_PORT } from "@solzero/shared"

const repoRoot = process.cwd()
const migrationsFolder = resolve(repoRoot, "packages/infra/migrations/pg")

const host = process.env.PGLITE_HOST ?? "127.0.0.1"
const port = Number(process.env.PGLITE_PORT ?? LOCAL_PGLITE_PORT)

const db = new PGlite()
for (const filename of readdirSync(migrationsFolder)
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  await db.exec(readFileSync(resolve(migrationsFolder, filename), "utf8"))
}

const server = new PGLiteSocketServer({
  db,
  host,
  port,
})
await server.start()

process.stdout.write(
  `PGLite listening at ${LOCAL_PGLITE_DATABASE_URL.replace(String(LOCAL_PGLITE_PORT), String(port))}\n`,
)

const stop = async () => {
  await server.stop()
  await db.close()
}

process.on("SIGINT", () => {
  void stop().then(() => process.exit(0))
})
process.on("SIGTERM", () => {
  void stop().then(() => process.exit(0))
})
