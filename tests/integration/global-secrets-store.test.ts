import { readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import { beforeEach, describe, expect, it } from "vitest"
import { GlobalSecretsStore } from "../../packages/api/src/server/background/db/repo-secrets"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const migrationsDir = resolve(__dirname, "../../packages/infra/d1-migrations")

const ENCRYPTION_KEY = "test-repo-secrets-key-32-chars!!"

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

function applyMigrations(db: DatabaseSync) {
  for (const filename of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(resolve(migrationsDir, filename), "utf8"))
  }
}

describe("GlobalSecretsStore D1 filtering", () => {
  let store: GlobalSecretsStore

  beforeEach(async () => {
    const sqlite = new DatabaseSync(":memory:")
    applyMigrations(sqlite)
    store = new GlobalSecretsStore(new SqliteD1Database(sqlite), ENCRYPTION_KEY)

    await Effect.runPromise(
      store.setSecrets(
        [
          { key: "ALPHA_TOKEN", value: "a", tags: ["prod", "repo:acme/app"] },
          { key: "BETA_TOKEN", value: "b", tags: ["staging", "repo:acme/app"] },
          { key: "GAMMA_TOKEN", value: "c", tags: ["prod"] },
          { key: "A_B", value: "underscore", tags: ["prod"] },
          { key: "AXB", value: "wildcard", tags: ["prod"] },
        ],
        { userId: "user_1" },
      ),
    )
    await Effect.runPromise(
      store.setSecrets([{ key: "OTHER_USER_TOKEN", value: "x", tags: ["prod"] }], {
        userId: "user_2",
      }),
    )
    await Effect.runPromise(
      store.setSecrets([{ key: "mcpcf/contextforge-api-token", value: "m", tags: ["internal"] }], {
        userId: "user_1",
      }),
    )
  })

  it("scopes secrets to the user and excludes mcpcf-managed keys", async () => {
    const { secrets } = await Effect.runPromise(store.listSecrets({ userId: "user_1" }))
    const keys = secrets.map((secret) => secret.key)
    expect(keys).toEqual(["ALPHA_TOKEN", "AXB", "A_B", "BETA_TOKEN", "GAMMA_TOKEN"])
    expect(keys).not.toContain("OTHER_USER_TOKEN")
    expect(keys.some((key) => key.startsWith("mcpcf/"))).toBe(false)
  })

  it("includes mcpcf-managed keys when explicitly requested", async () => {
    const keys = await Effect.runPromise(
      store.listSecretKeys({ userId: "user_1", includeMcpcfManaged: true }),
    )
    expect(keys).toContain("mcpcf/contextforge-api-token")
    expect(keys).toContain("ALPHA_TOKEN")
    expect(keys).not.toContain("OTHER_USER_TOKEN")
  })

  it("returns the full tag catalog regardless of active filters", async () => {
    const unfiltered = await Effect.runPromise(store.listSecrets({ userId: "user_1" }))
    expect(unfiltered.tags).toEqual(["prod", "repo:acme/app", "staging"])

    const filtered = await Effect.runPromise(
      store.listSecrets({ userId: "user_1", tags: ["staging"] }),
    )
    expect(filtered.secrets.map((secret) => secret.key)).toEqual(["BETA_TOKEN"])
    expect(filtered.tags).toEqual(["prod", "repo:acme/app", "staging"])
  })

  it("filters by key search case-insensitively", async () => {
    const { secrets } = await Effect.runPromise(store.listSecrets({ userId: "user_1", q: "alpha" }))
    expect(secrets.map((secret) => secret.key)).toEqual(["ALPHA_TOKEN"])
  })

  it("treats key-search underscores literally, not as LIKE wildcards", async () => {
    const { secrets } = await Effect.runPromise(store.listSecrets({ userId: "user_1", q: "A_B" }))
    expect(secrets.map((secret) => secret.key)).toEqual(["A_B"])
  })

  it("filters by tag membership via json_each", async () => {
    const single = await Effect.runPromise(
      store.listSecrets({ userId: "user_1", tags: ["repo:acme/app"] }),
    )
    expect(single.secrets.map((secret) => secret.key)).toEqual(["ALPHA_TOKEN", "BETA_TOKEN"])

    const multiple = await Effect.runPromise(
      store.listSecrets({
        userId: "user_1",
        tags: ["staging", "repo:acme/app"],
      }),
    )
    expect(multiple.secrets.map((secret) => secret.key)).toEqual(["ALPHA_TOKEN", "BETA_TOKEN"])
  })

  it("combines key search and tag filters", async () => {
    const { secrets } = await Effect.runPromise(
      store.listSecrets({
        userId: "user_1",
        q: "token",
        tags: ["prod"],
      }),
    )
    expect(secrets.map((secret) => secret.key)).toEqual(["ALPHA_TOKEN", "GAMMA_TOKEN"])
  })

  it("ranks popular tags by frequency", async () => {
    const stats = await Effect.runPromise(store.listSecretTagStats({ userId: "user_1" }))
    expect(stats.tags).toEqual(["prod", "repo:acme/app", "staging"])
    expect(stats.popularTags).toEqual(["prod", "repo:acme/app", "staging"])
  })
})
