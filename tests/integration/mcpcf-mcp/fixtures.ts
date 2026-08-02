import { readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { expect, vi } from "vitest"
import {
  type McpcfMcpContext,
  type McpcfUpstreamClient,
} from "../../../packages/api/src/server/mcp/mcpcf-server"
import { MCPCF_SERVER_HEADER } from "../../../packages/api/src/server/background/session/mcp-config"
import type {
  McpcfConfigRecord,
  McpcfServerRecord,
} from "../../../packages/api/src/server/background/db/mcpcf"
import { C0_CONFIG_KEYS } from "../../../packages/api/src/server/background/db/c0-config"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const migrationsDir = resolve(__dirname, "../../../packages/infra/d1-migrations")

type SqliteValue = string | number | bigint | null | Uint8Array

export class MemoryKVNamespace {
  readonly values = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream) {
    this.values.set(key, typeof value === "string" ? value : String(value))
  }

  async delete(key: string) {
    this.values.delete(key)
  }

  async list() {
    return {
      keys: [...this.values.keys()].map((name) => ({ name })),
      list_complete: true,
      cursor: "",
      cacheStatus: null,
    }
  }

  getWithMetadata = vi.fn()
}

const kvBySqlite = new WeakMap<DatabaseSync, MemoryKVNamespace>()

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

export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number | string | null
  method: string
  params?: Record<string, unknown>
}

export interface TestProtocolServer {
  _requestHandlers: Map<string, (request: JsonRpcRequest) => unknown | Promise<unknown>>
}

export interface TestMcpServer {
  server: TestProtocolServer
}

export const config: McpcfConfigRecord = {
  id: "default",
  enabled: true,
  baseUrl: "https://mcpcf.example.com",
  adminApiTokenSecretKey: "mcpcf.admin-api-token",
  userOauthProviderId: "okta",
  expectedIssuer: "https://issuer.example.com",
  authTypeAllowlist: ["oauth"],
  serverBlacklist: [],
  createdAt: 1,
  updatedAt: 1,
}

export const grafana: McpcfServerRecord = {
  id: "server_grafana",
  slug: "grafana",
  label: "Grafana",
  description: "Grafana server",
  authType: "oauth",
  toolCount: 1,
  tools: [],
  sourceStatus: "active",
  filterReason: null,
  enabled: true,
  rawMetadata: {},
  firstSeenAt: 1,
  lastSeenAt: 1,
  verifiedAt: 1,
  updatedAt: 1,
}

export const firehydrantToken: McpcfServerRecord = {
  id: "server_firehydrant_token",
  slug: "firehydrant_broker_mcp_token",
  label: "FireHydrant",
  description: "FireHydrant server",
  authType: "token",
  toolCount: 1,
  tools: [],
  sourceStatus: "active",
  filterReason: null,
  enabled: true,
  rawMetadata: {},
  firstSeenAt: 1,
  lastSeenAt: 1,
  verifiedAt: 1,
  updatedAt: 1,
}

export async function invokeServerRequest(
  server: TestMcpServer,
  request: JsonRpcRequest,
): Promise<unknown> {
  const handler = server.server._requestHandlers.get(request.method)
  if (!handler) {
    throw new Error(`Missing MCP request handler for '${request.method}'`)
  }

  return handler(request)
}

export function createTestUpstreamClient(input?: {
  accessToken?: string
  upstreamAccessToken?: string
}): McpcfUpstreamClient {
  const accessToken = input?.accessToken ?? "oauth_access_token"
  return {
    listTools: vi.fn((listInput) => {
      expect(listInput.accessToken).toBe(accessToken)
      expect(listInput.upstreamAccessToken).toBe(input?.upstreamAccessToken)
      return Effect.succeed([
        {
          name: "query_datasource",
          description: "Run a datasource query.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
      ])
    }),
    callTool: vi.fn((callInput) => {
      expect(callInput.accessToken).toBe(accessToken)
      expect(callInput.upstreamAccessToken).toBe(input?.upstreamAccessToken)
      return Effect.succeed({
        content: [
          {
            type: "text",
            text: `${callInput.server.label}:${callInput.toolName}:${
              callInput.arguments?.query ?? ""
            }`,
          },
        ],
      })
    }),
  }
}

export function createLog() {
  return {
    set: vi.fn(),
    emit: vi.fn(),
    error: vi.fn(),
  }
}

export function createContext(input: {
  accessToken?: string
  accessTokensByServerId?: Record<string, string>
  upstreamAccessTokensByServerId?: Record<string, string>
  serverSettingsById?: McpcfMcpContext["serverSettingsById"]
  upstreamClient?: McpcfUpstreamClient
  servers?: McpcfServerRecord[]
  authMode?: "mixed" | "mcpcf_oauth" | "mcpcf_token"
}): McpcfMcpContext {
  const servers = input.servers ?? [grafana]
  const accessToken = input.accessToken ?? "oauth_access_token"
  return {
    userId: Option.some("user_1"),
    oauthProviderId: Option.some("okta"),
    providerUserId: Option.some("00u-okta-user"),
    accessToken: Option.some(accessToken),
    accessTokensByServerId:
      input.accessTokensByServerId ??
      Object.fromEntries(servers.map((server) => [server.id, accessToken])),
    upstreamAccessTokensByServerId: input.upstreamAccessTokensByServerId ?? {},
    accessTokenIssuer: Option.some("https://issuer.example.com"),
    expectedAccessTokenIssuer: Option.some("https://issuer.example.com"),
    authMode: Option.some(input.authMode ?? "mcpcf_oauth"),
    serverSettingsById: input.serverSettingsById ?? {},
    config: Option.some(config),
    servers,
    upstreamClient: input.upstreamClient ?? createTestUpstreamClient({ accessToken }),
    log: createLog(),
  }
}

export function createResolverStore() {
  const sqlite = new DatabaseSync(":memory:")
  applyMigrations(sqlite)
  const db = new SqliteD1Database(sqlite)
  const c0Config = new MemoryKVNamespace()
  kvBySqlite.set(sqlite, c0Config)
  return { sqlite, db, c0Config }
}

export function seedSession(sqlite: DatabaseSync, input: { sessionId: string; serverId: string }) {
  sqlite
    .prepare(
      `INSERT INTO sessions (
        id, user_id, repo_owner, repo_name, model, status, created_at, updated_at, tools_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.sessionId,
      "user_1",
      "",
      "",
      "litellm/gpt-5.4-mini",
      "created",
      1,
      1,
      JSON.stringify([{ kind: "mcpcf_server", serverId: input.serverId }]),
    )
}

export function seedMcpcfConfig(sqlite: DatabaseSync) {
  sqlite
    .prepare(
      `INSERT INTO mcpcf_config (
        id, enabled, base_url, admin_api_token_secret_key, user_oauth_provider_id,
        expected_issuer, auth_type_allowlist_json, server_blacklist_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "default",
      1,
      "https://mcpcf.example.com",
      "mcpcf.admin-api-token",
      "okta",
      null,
      JSON.stringify(["oauth", "token"]),
      "[]",
      1,
      1,
    )
  const c0Config = kvBySqlite.get(sqlite)
  c0Config?.values.set(C0_CONFIG_KEYS.mcpcf.config, JSON.stringify(config))
}

export function seedMcpcfServer(
  sqlite: DatabaseSync,
  input: {
    id: string
    slug: string
    label: string
    authType: string
    rawMetadata?: Record<string, unknown>
  },
) {
  sqlite
    .prepare(
      `INSERT INTO mcpcf_servers (
        id, slug, label, description, auth_type, tool_count, tools_json, source_status,
        filter_reason, enabled, raw_metadata_json, first_seen_at, last_seen_at, verified_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.slug,
      input.label,
      "",
      input.authType,
      1,
      JSON.stringify([{ name: "list_runbooks" }]),
      "active",
      null,
      1,
      JSON.stringify(input.rawMetadata ?? {}),
      1,
      1,
      1,
      1,
    )
  const c0Config = kvBySqlite.get(sqlite)
  if (c0Config) {
    const server = {
      ...grafana,
      id: input.id,
      slug: input.slug,
      label: input.label,
      description: "",
      authType: input.authType,
      tools: [{ name: "list_runbooks" }],
      rawMetadata: input.rawMetadata ?? {},
    } satisfies McpcfServerRecord
    c0Config.values.set(C0_CONFIG_KEYS.mcpcf.server(input.id), JSON.stringify(server))
    const currentIndex = JSON.parse(
      c0Config.values.get(C0_CONFIG_KEYS.mcpcf.serverIndex) ?? "[]",
    ) as string[]
    c0Config.values.set(
      C0_CONFIG_KEYS.mcpcf.serverIndex,
      JSON.stringify([...new Set([...currentIndex, input.id])].sort()),
    )
  }
}

export function seedOktaAccount(sqlite: DatabaseSync) {
  sqlite
    .prepare(
      `INSERT INTO "account" (
        id, userId, accountId, providerId, accessToken, refreshToken, accessTokenExpiresAt,
        refreshTokenExpiresAt, scope, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "account_1",
      "user_1",
      "00u-okta-user",
      "okta",
      "okta_access_token",
      null,
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      null,
      "openid profile email",
      "2026-01-01",
      "2026-01-01",
    )
}

export function createResolverRequest(serverId: string) {
  return new Request("https://api.c0.example.com/integrations/mcpcf/mcp", {
    headers: {
      [MCPCF_SERVER_HEADER]: serverId,
    },
  })
}
