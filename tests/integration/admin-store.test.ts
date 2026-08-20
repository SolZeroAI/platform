import { readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AdminStore } from "../../packages/api/src/server/background/db/admin"
import { makeD1Drizzle } from "../../packages/api/src/server/effect/db/d1-drizzle"
import {
  requireAdmin,
  withAudit,
} from "../../packages/api/src/server/effect/handlers/admin/route-helpers"
import { agentSkillAuditMetadata } from "../../packages/api/src/server/effect/handlers/admin/skills"
import type { ControlPlaneContext } from "../../packages/api/src/server/effect/handlers/shared/control-plane"

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

function seedAdminRows(db: DatabaseSync) {
  db.prepare(
    `INSERT INTO "user" (
      id, name, email, emailVerified, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("user_1", "User One", "one@example.test", 1, "2026-01-01", "2026-01-01")
  db.prepare(
    `INSERT INTO "user" (
      id, name, email, emailVerified, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("user_2", "User Two", "two@example.test", 1, "2026-01-01", "2026-01-01")

  db.prepare(
    `INSERT INTO sessions (
      id, user_id, title, repo_owner, repo_name, model, session_kind, source, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "session_1",
    "user_1",
    "Debug Alpha",
    "example-org",
    "ai",
    "litellm/gpt-5.4-mini",
    "isolate",
    "web",
    "active",
    10,
    100,
  )
  db.prepare(
    `INSERT INTO sessions (
      id, user_id, title, repo_owner, repo_name, model, session_kind, source, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "session_2",
    "user_2",
    "API Repair",
    "example-org",
    "docs-sre",
    "litellm/gpt-5.4-mini",
    "sandbox",
    "api",
    "active",
    20,
    200,
  )
  db.prepare(
    `INSERT INTO sessions (
      id, user_id, title, repo_owner, repo_name, model, session_kind, source, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "session_3",
    "user_1",
    "Archived Debug",
    "example-org",
    "ai",
    "litellm/gpt-5.4-mini",
    "isolate",
    "web",
    "archived",
    30,
    300,
  )

  db.prepare(
    `INSERT INTO workflows (
      id, user_id, name, status, manifest_version, manifest_key, code_key, webhook_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "workflow_1",
    "user_1",
    "Daily Debug",
    "active",
    2,
    "user_1/workflows/workflow_1/v2/manifest.json",
    "user_1/workflows/workflow_1/v2/workflow.js",
    "webhook_1",
    50,
    500,
  )
  db.prepare(
    `INSERT INTO workflows (
      id, user_id, name, status, manifest_version, manifest_key, code_key, webhook_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "workflow_2",
    "user_2",
    "Archived Sweep",
    "archived",
    1,
    "user_2/workflows/workflow_2/v1/manifest.json",
    "user_2/workflows/workflow_2/v1/workflow.js",
    "webhook_2",
    40,
    400,
  )

  db.prepare(
    `INSERT INTO workflow_runs (
      id, workflow_id, workflow_version, workflow_instance_id, user_id, trigger_kind, trigger_node_id,
      status, input_json, output_json, error, started_at, completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "run_old",
    "workflow_1",
    2,
    "instance_old",
    "user_1",
    "manual",
    null,
    "completed",
    JSON.stringify({ trigger: "manual" }),
    JSON.stringify({ ok: true }),
    null,
    60,
    70,
    700,
  )
  db.prepare(
    `INSERT INTO workflow_runs (
      id, workflow_id, workflow_version, workflow_instance_id, user_id, trigger_kind, trigger_node_id,
      status, input_json, output_json, error, started_at, completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "run_latest",
    "workflow_1",
    2,
    "instance_latest",
    "user_1",
    "manual",
    null,
    "failed",
    JSON.stringify({ trigger: "manual" }),
    null,
    "boom",
    80,
    90,
    900,
  )

  db.prepare(
    `INSERT INTO workflow_run_events (
      id, workflow_id, run_id, sequence, node_id, event_type, level, message, data_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("event_2", "workflow_1", "run_latest", 2, "node_2", "step", "info", "second", "}", 902)
  db.prepare(
    `INSERT INTO workflow_run_events (
      id, workflow_id, run_id, sequence, node_id, event_type, level, message, data_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "event_1",
    "workflow_1",
    "run_latest",
    1,
    "node_1",
    "step",
    "info",
    "first",
    JSON.stringify({ order: 1 }),
    901,
  )

  db.prepare(
    `INSERT INTO "account" (
      id, userId, accountId, providerId, accessToken, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("account_1", "user_1", "github_1", "github", "secret", "2026-01-01", "2026-01-01")
  db.prepare(
    `INSERT INTO "account" (
      id, userId, accountId, providerId, accessToken, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("account_2", "user_2", "github_2", "github", "secret", "2026-01-01", "2026-01-01")
  db.prepare(
    `INSERT INTO "account" (
      id, userId, accountId, providerId, accessToken, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("account_3", "user_2", "okta_2", "okta", "secret", "2026-01-01", "2026-01-01")
}

describe("AdminStore", () => {
  let sqlite: DatabaseSync
  let store: AdminStore

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:")
    applyMigrations(sqlite)
    seedAdminRows(sqlite)
    store = new AdminStore(makeD1Drizzle(new SqliteD1Database(sqlite)))
  })

  afterEach(() => {
    sqlite.close()
  })

  it("lists sessions with real filters, joins, sorting, and pagination", async () => {
    const firstPage = await Effect.runPromise(
      store.listSessions({
        limit: "1",
        offset: "0",
        status: "active",
        sortBy: "updatedAt",
        sortDir: "desc",
      }),
    )

    expect(firstPage).toMatchObject({
      total: 2,
      limit: 1,
      offset: 0,
      hasMore: true,
      sessions: [
        {
          id: "session_2",
          userId: "user_2",
          userEmail: "two@example.test",
          sessionKind: "sandbox",
          source: "api",
        },
      ],
    })

    const debugSessions = await Effect.runPromise(
      store.listSessions({
        limit: "10",
        offset: "0",
        q: "debug",
        repoOwner: "example-org",
        repoName: "ai",
        sortBy: "updatedAt",
        sortDir: "asc",
      }),
    )

    expect(debugSessions.sessions.map((session) => session.id)).toEqual(["session_1", "session_3"])
  })

  it("lists workflows with latest run and run counts from real rows", async () => {
    const result = await Effect.runPromise(
      store.listWorkflows({
        limit: "10",
        offset: "0",
        q: "daily",
        status: "active",
        sortBy: "name",
        sortDir: "asc",
      }),
    )

    expect(result.total).toBe(1)
    expect(result.workflows[0]).toMatchObject({
      id: "workflow_1",
      userEmail: "one@example.test",
      latestRun: {
        id: "run_latest",
        status: "failed",
        error: "boom",
        input: { trigger: "manual" },
      },
      runCounts: [
        { status: "completed", count: 1 },
        { status: "failed", count: 1 },
      ],
    })
  })

  it("orders workflow run events and preserves invalid JSON diagnostics", async () => {
    const events = await Effect.runPromise(store.listWorkflowRunEvents("workflow_1", "run_latest"))

    expect(events.map((event) => event.id)).toEqual(["event_1", "event_2"])
    expect(events[0]?.data).toEqual({ order: 1 })
    expect(events[1]?.data).toMatchObject({ raw: "}" })
  })

  it("previews and deletes only GitHub linked accounts", async () => {
    await expect(Effect.runPromise(store.previewGitHubAccountCleanup())).resolves.toEqual({
      linkedAccounts: 2,
      affectedUsers: 2,
    })

    await expect(Effect.runPromise(store.cleanupGitHubAccounts())).resolves.toEqual({
      linkedAccounts: 2,
      affectedUsers: 2,
      userIds: ["user_1", "user_2"],
    })
    const remaining = sqlite.prepare(`SELECT providerId FROM "account"`).all()
    expect(remaining).toEqual([{ providerId: "okta" }])
  })

  it("requires configured admin access for global-skill mutations", async () => {
    const identityProvider = {
      getBetterAuthUserProfile: () =>
        Effect.succeed({
          id: "admin_1",
          name: "Admin",
          email: "admin@example.test",
          image: null,
        }),
      getGitHubAppUserAccessTokenForUserId: () => Effect.succeed(null),
      resolveOktaUserId: () => Effect.succeed(null),
    }
    const context = {
      request: new Request("https://api.example/api/admin/skills"),
      env: {
        DB: new SqliteD1Database(sqlite),
        S0_CONFIG_ADMIN: { adminEmails: ["admin@example.test"], adminDomains: [] },
      },
      principal: { kind: "api_key", keyId: "key_1", userId: "admin_1" },
      identityProvider,
    } as unknown as ControlPlaneContext

    await expect(Effect.runPromise(requireAdmin(context))).resolves.toEqual({
      userId: "admin_1",
      email: "admin@example.test",
    })

    const forbiddenContext = {
      ...context,
      env: {
        ...context.env,
        S0_CONFIG_ADMIN: { adminEmails: ["other@example.test"], adminDomains: [] },
      },
    }
    await expect(
      Effect.runPromise(requireAdmin(forbiddenContext as ControlPlaneContext)),
    ).rejects.toMatchObject({ _tag: "ControlPlaneFailure", status: 403 })
  })

  it("audits skill mutations without persisting SKILL.md content", async () => {
    const reason = agentSkillAuditMetadata({
      id: "skill_review_code",
      slug: "review-code",
      origin: "admin",
      contentHash: "sha256-content",
      defaultEnabled: true,
    })
    const db = new SqliteD1Database(sqlite)
    const context = {
      env: { DB: db },
      db: makeD1Drizzle(db),
    } as unknown as ControlPlaneContext

    const response = await Effect.runPromise(
      withAudit(
        {
          context,
          admin: { userId: "admin_1", email: "admin@example.test" },
          targetType: "agent_skill",
          targetId: "skill_review_code",
          action: "update_default",
          reason,
        },
        Effect.succeed(Response.json({ ok: true })),
      ),
    )

    expect(response.status).toBe(200)
    const audit = sqlite
      .prepare(
        "SELECT target_type, target_id, action, reason, result, status FROM admin_audit_events ORDER BY created_at DESC LIMIT 1",
      )
      .get() as Record<string, unknown>
    expect(audit).toMatchObject({
      target_type: "agent_skill",
      target_id: "skill_review_code",
      action: "update_default",
      reason,
      result: "success",
      status: 200,
    })
    expect(reason).not.toContain("SKILL.md")
    expect(reason).not.toContain("instructions")
  })
})
