import { readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SessionIndexStore } from "../../packages/api/src/server/background/db/session-index"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const migrationsDir = resolve(__dirname, "../../packages/infra/d1-migrations")

type SqliteValue = string | number | bigint | null | Uint8Array

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
    const columns = statement.columns().map((column) => column.name)
    const rows = statement.all(...this.params) as Record<string, unknown>[]
    return rows.map((row) => columns.map((column) => row[column])) as T[]
  }
}

class SqliteD1Database implements D1Database {
  constructor(private readonly db: DatabaseSync) {}

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this.db, query)
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return Promise.all(statements.map((statement) => statement.run<T>()))
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.db.exec(query)
    return { count: 0, duration: 0 }
  }
}

function toSqliteValue(value: unknown): SqliteValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value === null ||
    value instanceof Uint8Array
  ) {
    return value
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0
  }
  throw new TypeError(`Unsupported SQLite bind value: ${String(value)}`)
}

function getMigrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((filename) => filename.endsWith(".sql"))
    .sort()
}

function applyMigrations(db: DatabaseSync) {
  for (const filename of getMigrationFiles()) {
    db.exec(readFileSync(resolve(migrationsDir, filename), "utf8"))
  }
}

describe("SessionIndexStore.list", () => {
  let sqlite: DatabaseSync
  let store: SessionIndexStore

  beforeEach(async () => {
    sqlite = new DatabaseSync(":memory:")
    applyMigrations(sqlite)
    store = new SessionIndexStore(new SqliteD1Database(sqlite))

    await seedSessions(store)
  })

  afterEach(() => {
    sqlite.close()
  })

  it("defaults to updatedAt desc while excluding archived and incognito sessions", async () => {
    const firstPage = await Effect.runPromise(
      store.list({
        userId: "user-1",
        excludeStatus: "archived",
        limit: 1,
        offset: 0,
      }),
    )

    expect(firstPage.sessions.map((session) => session.id)).toEqual(["beta"])
    expect(firstPage.total).toBe(2)
    expect(firstPage.hasMore).toBe(true)

    const secondPage = await Effect.runPromise(
      store.list({
        userId: "user-1",
        excludeStatus: "archived",
        limit: 1,
        offset: 1,
      }),
    )

    expect(secondPage.sessions.map((session) => session.id)).toEqual(["alpha"])
    expect(secondPage.total).toBe(2)
    expect(secondPage.hasMore).toBe(false)
  })

  it("searches and filters sessions on the server side", async () => {
    const result = await Effect.runPromise(
      store.list({
        userId: "user-1",
        excludeStatus: "archived",
        q: "runbooks",
        sessionKind: "isolate",
        source: "web",
        repoOwner: "example-org",
        repoName: "sre",
        limit: 10,
        offset: 0,
      }),
    )

    expect(result.sessions.map((session) => session.id)).toEqual(["alpha"])
    expect(result.total).toBe(1)

    const mismatch = await Effect.runPromise(
      store.list({
        userId: "user-1",
        excludeStatus: "archived",
        q: "runbooks",
        source: "api",
        limit: 10,
        offset: 0,
      }),
    )

    expect(mismatch.sessions).toEqual([])
    expect(mismatch.total).toBe(0)
  })

  it("uses allowlisted sorting and falls back to updatedAt for unsupported sort fields", async () => {
    const titleAscending = await Effect.runPromise(
      store.list({
        userId: "user-1",
        excludeStatus: "archived",
        sortBy: "title",
        sortDir: "asc",
        limit: 10,
        offset: 0,
      }),
    )

    expect(titleAscending.sessions.map((session) => session.id)).toEqual(["alpha", "beta"])

    const unsupportedSort = await Effect.runPromise(
      store.list({
        userId: "user-1",
        excludeStatus: "archived",
        sortBy: "not_a_column",
        sortDir: "sideways",
        limit: 10,
        offset: 0,
      }),
    )

    expect(unsupportedSort.sessions.map((session) => session.id)).toEqual(["beta", "alpha"])
  })

  it("defaults isolate sessions to enabled sub-agents and ignores the option for sandboxes", async () => {
    const isolate = Option.getOrThrow(await Effect.runPromise(store.getById("alpha")))
    const sandbox = Option.getOrThrow(await Effect.runPromise(store.getById("beta")))

    expect(isolate.subagents).toBe("enabled")
    expect(sandbox.subagents).toBe("disabled")

    await Effect.runPromise(
      store.updateTooling({
        id: "alpha",
        repoOwner: isolate.repo_owner,
        repoName: isolate.repo_name,
        tools: [{ kind: "github_repo", repoOwner: "example-org", repoName: "sre" }],
        customMcpServers: {},
        subagents: "disabled",
        updatedAt: 101,
      }),
    )
    await Effect.runPromise(
      store.updateTooling({
        id: "beta",
        repoOwner: sandbox.repo_owner,
        repoName: sandbox.repo_name,
        tools: [{ kind: "github_repo", repoOwner: "example-org", repoName: "docs" }],
        customMcpServers: {},
        subagents: "enabled",
        updatedAt: 201,
      }),
    )

    expect(Option.getOrThrow(await Effect.runPromise(store.getById("alpha"))).subagents).toBe(
      "disabled",
    )
    expect(Option.getOrThrow(await Effect.runPromise(store.getById("beta"))).subagents).toBe(
      "disabled",
    )
  })
})

async function seedSessions(store: SessionIndexStore) {
  await Effect.runPromise(
    store.create({
      id: "alpha",
      userId: "user-1",
      title: "Ask O11y Get Runbooks",
      repoOwner: "example-org",
      repoName: "sre",
      tools: [{ kind: "github_repo", repoOwner: "example-org", repoName: "sre" }],
      customMcpServers: {},
      model: "litellm/gpt-5.4-mini",
      reasoningEffort: "medium",
      sessionKind: "isolate",
      source: "web",
      status: "active",
      createdAt: 10,
      updatedAt: 100,
    }),
  )
  await Effect.runPromise(
    store.create({
      id: "beta",
      userId: "user-1",
      title: "Build Jira migration",
      repoOwner: "example-org",
      repoName: "docs",
      tools: [{ kind: "github_repo", repoOwner: "example-org", repoName: "docs" }],
      customMcpServers: {},
      model: "litellm/gpt-5.4-mini",
      reasoningEffort: "low",
      sessionKind: "sandbox",
      source: "api",
      status: "completed",
      createdAt: 20,
      updatedAt: 200,
    }),
  )
  await Effect.runPromise(
    store.create({
      id: "archived",
      userId: "user-1",
      title: "Archived session",
      repoOwner: "example-org",
      repoName: "ai",
      tools: [],
      customMcpServers: {},
      model: "litellm/gpt-5.4-mini",
      sessionKind: "isolate",
      source: "web",
      status: "archived",
      createdAt: 30,
      updatedAt: 300,
    }),
  )
  await Effect.runPromise(
    store.create({
      id: "incognito",
      userId: "user-1",
      title: "Incognito session",
      repoOwner: "",
      repoName: "",
      tools: [],
      customMcpServers: {},
      model: "litellm/gpt-5.4-mini",
      sessionKind: "isolate",
      source: "web",
      incognito: true,
      status: "active",
      createdAt: 40,
      updatedAt: 400,
    }),
  )
  await Effect.runPromise(
    store.create({
      id: "other-user",
      userId: "user-2",
      title: "Other user session",
      repoOwner: "example-org",
      repoName: "sre",
      tools: [],
      customMcpServers: {},
      model: "litellm/gpt-5.4-mini",
      sessionKind: "isolate",
      source: "web",
      status: "active",
      createdAt: 50,
      updatedAt: 500,
    }),
  )
}
