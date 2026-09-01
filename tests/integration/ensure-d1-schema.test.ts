import { DatabaseSync } from "node:sqlite"
import * as Effect from "effect/Effect"
import { describe, expect, it } from "vitest"
import { reconcileManagedAdminCredentialsUncached } from "../../packages/api/src/server/background/db/admin-credentials"
import {
  ensureD1Schema,
  ensureD1SchemaUncached,
} from "../../packages/api/src/server/background/db/ensure-d1-schema"
import { S0_CONFIG_BINDINGS } from "../../packages/api/src/server/background/db/s0-config"
import type { Env } from "../../packages/api/src/server/background/types"

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
    if (!row) return null
    return columnName ? (row[columnName] ?? null) : (row as T)
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
    return {
      results: this.db.prepare(this.query).all(...this.params) as T[],
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

function emptyEnv() {
  const sqlite = new DatabaseSync(":memory:")
  const env = {
    DB: new SqliteD1Database(sqlite),
    [S0_CONFIG_BINDINGS.admin]: {
      adminEmails: ["admin@example.test"],
      adminDomains: [],
    },
    [S0_CONFIG_BINDINGS.auth]: {
      defaultSignInProviderId: "credential",
      adminPassword: { env: "TEST_ADMIN_PASSWORD" },
      providers: {
        credential: {
          kind: "credential",
          enabled: true,
          displayName: "Administrator",
          capabilities: { signIn: true, provisionUsers: true, link: false },
          provisioning: { scope: "configured-admins" },
        },
      },
    },
    TEST_ADMIN_PASSWORD: "test-admin-password-at-least-32-bytes",
  } as unknown as Env
  return { env, sqlite }
}

describe("ensure D1 schema", () => {
  it("creates Better Auth tables on an empty database", async () => {
    const { env, sqlite } = emptyEnv()
    try {
      expect(
        sqlite
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'`)
          .get(),
      ).toBeUndefined()

      await ensureD1Schema(env)

      expect(
        sqlite
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'`)
          .get(),
      ).toEqual({ name: "user" })
      expect(
        sqlite
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'account'`)
          .get(),
      ).toEqual({ name: "account" })
      expect(
        sqlite
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'managed_admin_credential'`,
          )
          .get(),
      ).toEqual({ name: "managed_admin_credential" })
    } finally {
      sqlite.close()
    }
  })

  it("lets managed admin reconciliation run after bootstrap", async () => {
    const { env, sqlite } = emptyEnv()
    try {
      await expect(
        Effect.runPromise(reconcileManagedAdminCredentialsUncached(env)),
      ).rejects.toThrow(/no such table: user/i)

      await ensureD1Schema(env)
      await Effect.runPromise(reconcileManagedAdminCredentialsUncached(env))

      expect(
        sqlite.prepare(`SELECT email FROM "user" WHERE email = 'admin@example.test'`).get(),
      ).toEqual({ email: "admin@example.test" })
    } finally {
      sqlite.close()
    }
  })

  it("is a no-op when the user table already exists", async () => {
    const { env, sqlite } = emptyEnv()
    try {
      await Effect.runPromise(ensureD1SchemaUncached(env))
      sqlite.exec(`INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
        VALUES ('keep-me', 'Keep', 'keep@example.test', 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`)

      await Effect.runPromise(ensureD1SchemaUncached(env))

      expect(sqlite.prepare(`SELECT count(*) AS count FROM "user"`).get()).toEqual({ count: 1 })
    } finally {
      sqlite.close()
    }
  })
})
