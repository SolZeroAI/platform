import { readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createUserProviderConfigsStoreFromD1,
  type UserProviderConfigsStorePromise,
} from "../../packages/api/src/server/background/db/user-provider-configs"
import { buildProviderSettingsResponse } from "../../packages/api/src/server/background/provider-catalog"
import type { Env } from "../../packages/api/src/server/background/types"
import { MemoryKVNamespace } from "./mcpcf-mcp/fixtures"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const migrationsDir = resolve(__dirname, "../../packages/infra/d1-migrations")
const ENCRYPTION_KEY = "test-provider-configs-key-32!"

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

function applyMigrationsBefore(db: DatabaseSync, migrationPrefix: string) {
  for (const filename of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql") && name < migrationPrefix)
    .sort()) {
    db.exec(readFileSync(resolve(migrationsDir, filename), "utf8"))
  }
}

describe("UserProviderConfigsStore", () => {
  let sqlite: DatabaseSync
  let store: UserProviderConfigsStorePromise

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:")
    applyMigrationsBefore(sqlite, "0024_")
    store = createUserProviderConfigsStoreFromD1(new SqliteD1Database(sqlite), ENCRYPTION_KEY)
  })

  afterEach(() => {
    sqlite.close()
  })

  it("saves default step limits when OpenCode permission preferences are not migrated", async () => {
    const db = new SqliteD1Database(sqlite)
    await store.replaceSettings("user_1", {
      defaultModel: null,
      defaultIsolateStepLimit: 7,
      opencodePermission: null,
      sharedOverrides: [],
      customProviders: [],
    })

    const row = sqlite
      .prepare("SELECT default_isolate_step_limit FROM user_provider_preferences WHERE user_id = ?")
      .get("user_1") as { default_isolate_step_limit: number }
    expect(row.default_isolate_step_limit).toBe(7)

    const snapshot = await store.getSettingsSnapshot("user_1")
    expect(snapshot.defaultIsolateStepLimit).toBe(7)
    expect(snapshot.opencodePermission).toBeNull()

    const response = await buildProviderSettingsResponse(
      {
        S0_CONFIG: new MemoryKVNamespace() as unknown as KVNamespace,
        DB: db,
        REPO_SECRETS_ENCRYPTION_KEY: ENCRYPTION_KEY,
        TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY,
        STAGE: "dev",
      } as unknown as Env,
      "user_1",
    )
    expect(response.settings.defaultIsolateStepLimit).toBe(7)
    expect(response.settings.opencodePermission).toBeNull()
  })

  it("requires the OpenCode permission migration before saving custom permissions", async () => {
    await expect(
      store.replaceSettings("user_1", {
        defaultModel: null,
        defaultIsolateStepLimit: 7,
        opencodePermission: "allow",
        sharedOverrides: [],
        customProviders: [],
      }),
    ).rejects.toThrow(/0024_opencode_permission_preferences\.sql/)
  })
})
