import { readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { BotStore } from "../../packages/api/src/server/background/db/bots"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const migrationsDir = resolve(__dirname, "../../packages/infra/d1-migrations")

type SqliteValue = string | number | bigint | null | Uint8Array

function toSqliteValue(value: unknown): SqliteValue {
  if (value === undefined) {
    return null
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value === null ||
    value instanceof Uint8Array
  ) {
    return value
  }
  throw new Error("Unsupported SQLite bind value")
}

class SqliteD1Statement implements D1PreparedStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly query: string,
    private readonly params: SqliteValue[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteD1Statement(this.db, this.query, values.map(toSqliteValue))
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    const row = this.db.prepare(this.query).get(...this.params) as Record<string, T> | undefined
    if (!row) {
      return null
    }
    if (columnName) {
      return row[columnName] ?? null
    }
    return row as T
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    const result = this.db.prepare(this.query).run(...this.params)
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(result.changes),
        duration: 0,
        last_row_id: Number(result.lastInsertRowid),
      },
    }
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const results = this.db.prepare(this.query).all(...this.params) as T[]
    return {
      results,
      success: true,
      meta: { duration: 0 },
    }
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const statement = this.db.prepare(this.query)
    const rows = statement.all(...this.params) as Record<string, unknown>[]
    const firstRow = rows[0]
    const columns = firstRow === undefined ? [] : Object.keys(firstRow)
    return rows.map((row) => columns.map((column) => row[column])) as T[]
  }
}

class SqliteD1Database implements D1Database {
  constructor(private readonly db: DatabaseSync) {}

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this.db, query)
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0)
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.db.exec(query)
    return { count: 0, duration: 0 }
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return Promise.all(statements.map((statement) => statement.all<T>()))
  }
}

function applyMigrations(db: DatabaseSync) {
  for (const filename of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(resolve(migrationsDir, filename), "utf8"))
  }
}

describe("bot store", () => {
  let sqlite: DatabaseSync
  let store: BotStore

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:")
    applyMigrations(sqlite)
    store = new BotStore(new SqliteD1Database(sqlite) as unknown as D1Database)
  })

  afterEach(() => {
    sqlite.close()
  })

  it("lets a bot create standing and temporary routines, then delete the temporary one", async () => {
    const bot = await Effect.runPromise(store.create("user-1", { name: "CI watcher" }))
    const standing = await Effect.runPromise(
      store.createRoutine("user-1", bot.id, {
        name: "Hourly inbox",
        kind: "standing",
        cadence: { kind: "cron", cron: "0 * * * *" },
        prompt: "Triage new mentions",
      }),
    )
    const temporary = await Effect.runPromise(
      store.createRoutine("user-1", bot.id, {
        name: "Watch PR 12 CI",
        kind: "temporary",
        cadence: { kind: "interval", intervalSeconds: 120 },
        prompt: "Check lint and validation on PR 12",
        until: Date.parse("2026-08-20T12:00:00.000Z"),
        watch: {
          kind: "github_pull_request",
          owner: "SolZeroAI",
          repo: "platform",
          pullNumber: 12,
          completeWhen: "checks_concluded",
        },
      }),
    )

    const listed = await Effect.runPromise(store.listRoutines("user-1", bot.id))
    expect(listed.map((routine) => routine.name).sort()).toEqual(["Hourly inbox", "Watch PR 12 CI"])

    await Effect.runPromise(store.deleteRoutine("user-1", bot.id, temporary.id))
    const remaining = await Effect.runPromise(store.listRoutines("user-1", bot.id))
    expect(remaining.map((routine) => routine.id)).toEqual([standing.id])
  })

  it("attaches a session so isolate tools can resolve the owning bot", async () => {
    const bot = await Effect.runPromise(store.create("user-1", { name: "Family bot" }))
    const attached = await Effect.runPromise(store.attachSession("user-1", bot.id, "session-1"))
    const found = await Effect.runPromise(store.getBySessionId("session-1"))

    expect(attached.sessionId).toBe("session-1")
    expect(Option.isSome(found)).toBe(true)
  })
})
