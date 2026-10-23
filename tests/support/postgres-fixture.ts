import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { PGLiteSocketServer } from "@electric-sql/pglite-socket"
import { randomBytes } from "node:crypto"

const database = new PGlite()
const directory = resolve("packages/infra/migrations/pg")
for (const name of readdirSync(directory)
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await database.exec(readFileSync(resolve(directory, name), "utf8"))
const server = new PGLiteSocketServer({ db: database, host: "127.0.0.1", port: 0 })
await server.start()
process.send?.({
  url: `postgres://postgres:${randomBytes(32).toString("hex")}@${server.getServerConn()}/postgres`,
})
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await server.stop()
  await database.close()
  process.disconnect?.()
}
process.on("message", () => {
  void stop()
})
process.on("disconnect", () => {
  void stop()
})
process.on("SIGINT", () => {
  void stop()
})
process.on("SIGTERM", () => {
  void stop()
})
