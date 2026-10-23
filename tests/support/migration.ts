import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fork } from "node:child_process"
import { once } from "node:events"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { makeDrizzleCopyDestination } from "../../packages/api/src/cli/d1-to-planetscale-copy"
import { stopFixture } from "./fixture-process"

export async function withMigrationDatabases<T>(
  run: (fixture: {
    source: DatabaseSync
    postgres: {
      exec: (statement: string) => Promise<unknown>
      query: (statement: string) => Promise<{ rows: readonly Record<string, unknown>[] }>
    }
    destination: ReturnType<typeof makeDrizzleCopyDestination>
    queryParameterCounts: number[]
    url: string
  }) => Promise<T>,
): Promise<T> {
  const source = new DatabaseSync(":memory:")
  const child = fork(resolve("tests/support/postgres-fixture.ts"), [], {
    execArgv: ["--import", import.meta.resolve("tsx")],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  })
  const closed = once(child, "exit")
  const ready = new Promise<string>((accept, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Local Postgres fixture did not become ready")),
      30_000,
    )
    child.once("message", (message) => {
      clearTimeout(timeout)
      if (
        typeof message !== "object" ||
        message === null ||
        !("url" in message) ||
        typeof message.url !== "string"
      )
        return reject(new Error("Invalid Postgres fixture readiness message"))
      accept(message.url)
    })
    child.once("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once("exit", () => {
      clearTimeout(timeout)
      reject(new Error("Postgres fixture exited before readiness"))
    })
  })
  let client: ReturnType<typeof postgres> | undefined
  const queryParameterCounts: number[] = []
  try {
    const sqliteDir = resolve("packages/infra/d1-migrations")
    for (const name of readdirSync(sqliteDir)
      .filter((name) => name.endsWith(".sql") && name < "0030")
      .sort())
      source.exec(readFileSync(resolve(sqliteDir, name), "utf8"))
    source.exec("PRAGMA foreign_keys = ON")
    const url = await ready
    client = postgres(url, {
      max: 1,
      prepare: false,
      fetch_types: false,
      connect_timeout: 10,
    })
    const connection = client
    const database = drizzle({
      client: connection,
      logger: {
        logQuery(_query, params) {
          queryParameterCounts.push(params.length)
        },
      },
    })
    return await run({
      source,
      postgres: {
        exec: (statement) => connection.unsafe(statement),
        query: async (statement) => ({ rows: [...(await connection.unsafe(statement))] }),
      },
      destination: makeDrizzleCopyDestination(database),
      queryParameterCounts,
      url,
    })
  } finally {
    source.close()
    await client?.end({ timeout: 1 })
    await stopFixture(child, closed)
  }
}
