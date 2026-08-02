import { readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { afterEach, describe, expect, it, vi } from "vitest"
import { verifyPassword } from "../../packages/api/node_modules/better-auth/dist/crypto/index.mjs"
import {
  C0_CONFIG_BINDINGS,
  C0_CONFIG_KEYS,
  C0_CONFIG_LOCATIONS,
  C0ConfigStore,
} from "../../packages/api/src/server/background/db/c0-config"
import { getAuthProviderRegistry } from "../../packages/api/src/server/background/db/auth-config"
import { reconcileManagedAdminCredentialsUncached } from "../../packages/api/src/server/background/db/admin-credentials"
import {
  getLitellmModelRegistry,
  getLitellmProviderSnapshot,
  syncLitellmModels,
  updateLitellmProviderConfig,
} from "../../packages/api/src/server/background/ai-providers/litellm"
import {
  exportLitellmProviderConfig,
  resetLitellmProviderConfig,
} from "../../packages/api/src/server/background/ai-providers/litellm-admin-actions"
import type { Env } from "../../packages/api/src/server/background/types"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const migrationsDir = resolve(__dirname, "../../packages/infra/d1-migrations")
const encryptionKey = "test-repo-secrets-key-32-chars"
const adminPasswordEnv = "TEST_ADMIN_PASSWORD"
const litellmApiKeyEnv = "TEST_LITELLM_API_KEY"

function credentialAuthConfig() {
  return {
    defaultSignInProviderId: "credential",
    adminPassword: { env: adminPasswordEnv },
    providers: {
      credential: {
        kind: "credential",
        enabled: true,
        displayName: "Administrator",
        capabilities: { signIn: true, provisionUsers: true, link: false },
        provisioning: { scope: "configured-admins" },
      },
    },
  }
}

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

class MemoryKV {
  readonly values = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async put(key: string, value: string) {
    this.values.set(key, value)
  }

  async delete(key: string) {
    this.values.delete(key)
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

function createEnv(overrides: Record<string, unknown> = {}) {
  const sqlite = new DatabaseSync(":memory:")
  for (const filename of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync(resolve(migrationsDir, filename), "utf8"))
  }
  const kv = new MemoryKV()
  const env = {
    C0_CONFIG: kv,
    DB: new SqliteD1Database(sqlite),
    REPO_SECRETS_ENCRYPTION_KEY: encryptionKey,
    ...overrides,
  } as unknown as Env
  return { env, kv, sqlite }
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  })
}

describe("C0_CONFIG and LiteLLM model sync", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("reads JSON values and stores encrypted secrets in KV", async () => {
    const { env, sqlite } = createEnv()
    try {
      const store = new C0ConfigStore(env.C0_CONFIG, encryptionKey)
      const missing = await Effect.runPromise(store.getJson("missing"))
      expect(Option.isNone(missing)).toBe(true)

      await Effect.runPromise(store.putJson("config/test", { ok: true }))
      await expect(Effect.runPromise(store.getJson("config/test"))).resolves.toEqual(
        Option.some({ ok: true }),
      )

      await Effect.runPromise(
        store.setEncryptedSecret(C0_CONFIG_KEYS.aiProviders.litellmApiKey, "litellm-secret"),
      )
      await expect(
        Effect.runPromise(store.getEncryptedSecret(C0_CONFIG_KEYS.aiProviders.litellmApiKey)),
      ).resolves.toEqual(Option.some("litellm-secret"))
    } finally {
      sqlite.close()
    }
  })

  it("uses explicit compiled bindings while runtime registries remain KV-only", () => {
    expect(C0_CONFIG_BINDINGS).toEqual({
      admin: "C0_CONFIG_ADMIN",
      auth: "C0_CONFIG_AUTH",
      litellm: "C0_CONFIG_LITELLM",
      mcpcf: "C0_CONFIG_MCPCF",
    })
    expect(C0_CONFIG_KEYS.aiProviders.litellmModels).toBe("registry/ai-providers/litellm/models")
    expect(C0_CONFIG_KEYS.mcpcf.serverIndex).toBe("registry/mcpcf/server-index")
  })

  it("uses the deployment auth registry and its explicit secret reference", async () => {
    const providerSecretEnv = "TEST_EXAMPLE_OIDC_CLIENT_SECRET"
    const { env, sqlite } = createEnv({
      [C0_CONFIG_BINDINGS.auth]: {
        defaultSignInProviderId: "example-oidc",
        adminPassword: { env: adminPasswordEnv },
        providers: {
          "example-oidc": {
            kind: "oidc",
            enabled: true,
            displayName: "Example Identity",
            issuer: "https://issuer.example.com/",
            clientId: "env-client-id",
            clientSecret: { env: providerSecretEnv },
            scopes: ["openid", "email"],
            capabilities: { signIn: true, provisionUsers: true, link: true },
          },
        },
      },
      [providerSecretEnv]: "env-client-secret",
    })
    try {
      const store = new C0ConfigStore(env.C0_CONFIG, encryptionKey)
      await Effect.runPromise(
        store.putJson(C0_CONFIG_KEYS.auth.config, {
          defaultSignInProviderId: "kv-oidc",
          providers: {
            "kv-oidc": {
              kind: "oidc",
              enabled: true,
              displayName: "KV Identity",
              issuer: "https://issuer.kv.example.com",
              clientId: "kv-client-id",
              capabilities: { signIn: true, provisionUsers: true, link: true },
            },
          },
        }),
      )
      await Effect.runPromise(
        store.setEncryptedSecret(
          C0_CONFIG_KEYS.auth.providerClientSecret("kv-oidc"),
          "kv-client-secret",
        ),
      )

      await expect(Effect.runPromise(getAuthProviderRegistry(env))).resolves.toEqual({
        defaultSignInProviderId: "example-oidc",
        providers: {
          "example-oidc": {
            kind: "oidc",
            enabled: true,
            displayName: "Example Identity",
            issuer: "https://issuer.example.com",
            clientId: "env-client-id",
            scopes: ["openid", "email"],
            capabilities: { signIn: true, provisionUsers: true, link: true },
            clientSecret: "env-client-secret",
          },
        },
      })
    } finally {
      sqlite.close()
    }
  })

  it("provisions explicit admins and rotates deployment-managed credential hashes", async () => {
    const { env, sqlite } = createEnv({
      [C0_CONFIG_BINDINGS.admin]: {
        adminEmails: ["admin@example.test"],
        adminDomains: ["example.test"],
      },
      [C0_CONFIG_BINDINGS.auth]: credentialAuthConfig(),
      [adminPasswordEnv]: "first-deployment-password",
    })
    try {
      await Effect.runPromise(reconcileManagedAdminCredentialsUncached(env))
      const user = sqlite.prepare(`SELECT "id", "email", "emailVerified" FROM "user"`).get() as {
        id: string
        email: string
        emailVerified: number
      }
      const account = sqlite
        .prepare(`SELECT "password" FROM "account" WHERE "providerId" = 'credential'`)
        .get() as { password: string }
      expect(user).toMatchObject({ email: "admin@example.test", emailVerified: 1 })
      await expect(
        verifyPassword({ hash: account.password, password: "first-deployment-password" }),
      ).resolves.toBe(true)

      sqlite
        .prepare(
          `INSERT INTO "session" ("id", "userId", "token", "expiresAt", "createdAt", "updatedAt")
           VALUES ('session_1', ?, 'token_1', ?, ?, ?)`,
        )
        .run(
          user.id,
          new Date(Date.now() + 60_000).toISOString(),
          new Date().toISOString(),
          new Date().toISOString(),
        )
      Reflect.set(env, adminPasswordEnv, "second-deployment-password")
      await Effect.runPromise(reconcileManagedAdminCredentialsUncached(env))

      const rotated = sqlite
        .prepare(`SELECT "password" FROM "account" WHERE "providerId" = 'credential'`)
        .get() as { password: string }
      await expect(
        verifyPassword({ hash: rotated.password, password: "first-deployment-password" }),
      ).resolves.toBe(false)
      await expect(
        verifyPassword({ hash: rotated.password, password: "second-deployment-password" }),
      ).resolves.toBe(true)
      expect(sqlite.prepare(`SELECT count(*) AS count FROM "session"`).get()).toEqual({ count: 0 })
    } finally {
      sqlite.close()
    }
  })

  it("does not provision credential users from admin domains", async () => {
    const { env, sqlite } = createEnv({
      [C0_CONFIG_BINDINGS.admin]: { adminEmails: [], adminDomains: ["example.test"] },
      [C0_CONFIG_BINDINGS.auth]: credentialAuthConfig(),
      [adminPasswordEnv]: "deployment-password",
    })
    try {
      await Effect.runPromise(reconcileManagedAdminCredentialsUncached(env))
      expect(sqlite.prepare(`SELECT count(*) AS count FROM "user"`).get()).toEqual({ count: 0 })
    } finally {
      sqlite.close()
    }
  })

  it("uses deployment LiteLLM config and secret with KV-backed registry state", async () => {
    const envRegistry = {
      providerId: "litellm",
      baseUrl: "https://env-litellm.example.com",
      models: {
        "env-model": {
          id: "env-model",
          provider: "openai",
          upstreamModel: "openai/env-model",
          supportedOpenAIParams: ["reasoning_effort"],
          supportsReasoning: true,
          supportsReasoningEffort: true,
          supportsThinking: false,
          contextWindow: 128000,
          maxInputTokens: 128000,
          maxOutputTokens: 8192,
          defaultAdapter: "@ai-sdk/openai",
          adapterOverride: null,
          aiSdkAdapter: "@ai-sdk/openai",
          reasoningEfforts: ["low", "medium"],
          defaultReasoningLevel: "medium",
          updatedAt: 123,
        },
      },
      updatedAt: 123,
    }
    const { env, sqlite } = createEnv({
      [C0_CONFIG_BINDINGS.litellm]: {
        enabled: true,
        baseUrl: "https://env-litellm.example.com",
        defaultModel: "env-model",
        defaultReasoningLevel: "medium",
        adapterOverrides: {},
        apiKey: { env: litellmApiKeyEnv },
      },
      [litellmApiKeyEnv]: "env-litellm-secret",
    })
    try {
      const store = new C0ConfigStore(env.C0_CONFIG, encryptionKey)
      await Effect.runPromise(
        store.putJson(C0_CONFIG_KEYS.aiProviders.litellmConfig, {
          enabled: false,
          baseUrl: "https://kv-litellm.example.com",
        }),
      )
      await Effect.runPromise(
        store.setEncryptedSecret(C0_CONFIG_KEYS.aiProviders.litellmApiKey, "kv-secret"),
      )
      await Effect.runPromise(store.putJson(C0_CONFIG_KEYS.aiProviders.litellmModels, envRegistry))

      const snapshot = await Effect.runPromise(getLitellmProviderSnapshot(env))
      const registry = await Effect.runPromise(getLitellmModelRegistry(env))

      expect(snapshot).toMatchObject({
        configured: true,
        apiKeyConfigured: true,
        configSource: "deployment",
        configLocked: true,
        apiKeySource: "deployment",
        apiKeyLocked: true,
        registrySource: "kv",
        registryLocked: false,
        registryEnvVarName: null,
      })
      expect(snapshot.config.baseUrl).toBe("https://env-litellm.example.com")
      expect(registry?.models["env-model"]).toBeDefined()
    } finally {
      sqlite.close()
    }
  })

  it("uses KV when the deployment omits LiteLLM", async () => {
    const { env, sqlite } = createEnv()
    try {
      const store = new C0ConfigStore(env.C0_CONFIG, encryptionKey)
      await Effect.runPromise(
        store.putJson(C0_CONFIG_KEYS.aiProviders.litellmConfig, {
          enabled: true,
          baseUrl: "https://kv-litellm.example.com",
        }),
      )
      const snapshot = await Effect.runPromise(getLitellmProviderSnapshot(env))
      expect(snapshot.configSource).toBe("kv")
      expect(snapshot.config.baseUrl).toBe("https://kv-litellm.example.com")
    } finally {
      sqlite.close()
    }
  })

  it("rejects admin LiteLLM updates when config is deployment-managed", async () => {
    const { env, sqlite } = createEnv({
      [C0_CONFIG_BINDINGS.litellm]: {
        enabled: true,
        baseUrl: "https://env-litellm.example.com",
        defaultModel: null,
        defaultReasoningLevel: null,
        adapterOverrides: {},
      },
    })
    try {
      await expect(
        Effect.runPromise(
          updateLitellmProviderConfig(env, {
            enabled: true,
            baseUrl: "https://admin-litellm.example.com",
          }),
        ),
      ).rejects.toThrow(C0_CONFIG_LOCATIONS.litellm)
    } finally {
      sqlite.close()
    }
  })

  it("exports KV-backed LiteLLM values as a JSONC fragment plus a secret assignment", async () => {
    const { env, sqlite } = createEnv()
    try {
      const store = new C0ConfigStore(env.C0_CONFIG, encryptionKey)
      await Effect.runPromise(
        updateLitellmProviderConfig(env, {
          enabled: true,
          baseUrl: "https://litellm.example.com",
          defaultModel: "gpt-5.4-mini",
          defaultReasoningLevel: null,
          adapterOverrides: {},
          apiKey: "sk-test",
        }),
      )
      await Effect.runPromise(
        store.putJson(C0_CONFIG_KEYS.aiProviders.litellmModels, {
          providerId: "litellm",
          baseUrl: "https://litellm.example.com",
          models: {},
          updatedAt: 123,
        }),
      )

      const result = await Effect.runPromise(exportLitellmProviderConfig(env))

      expect(result).toMatchObject({
        variableCount: 2,
        includesSecret: true,
        includesRegistry: false,
      })
      expect(result.dotenv).toContain('"aiProviders":{"litellm"')
      expect(result.dotenv).toContain('"apiKey":{"env":"C0_LITELLM_API_KEY"}')
      expect(result.dotenv).toContain("C0_LITELLM_API_KEY='sk-test'")
      expect(result.dotenv).not.toContain("createdAt")
    } finally {
      sqlite.close()
    }
  })

  it("resets only KV-backed LiteLLM values", async () => {
    const { env, kv, sqlite } = createEnv({
      [C0_CONFIG_BINDINGS.litellm]: {
        enabled: true,
        baseUrl: "https://env-litellm.example.com",
        defaultModel: null,
        defaultReasoningLevel: null,
        adapterOverrides: {},
      },
    })
    try {
      const store = new C0ConfigStore(env.C0_CONFIG, encryptionKey)
      await Effect.runPromise(
        store.putJson(C0_CONFIG_KEYS.aiProviders.litellmConfig, {
          enabled: true,
          baseUrl: "https://kv-litellm.example.com",
        }),
      )
      await Effect.runPromise(
        store.setEncryptedSecret(C0_CONFIG_KEYS.aiProviders.litellmApiKey, "kv-secret"),
      )
      await Effect.runPromise(
        store.putJson(C0_CONFIG_KEYS.aiProviders.litellmModels, {
          providerId: "litellm",
          baseUrl: "https://kv-litellm.example.com",
          models: {},
          updatedAt: 123,
        }),
      )

      const result = await Effect.runPromise(resetLitellmProviderConfig(env))
      const snapshot = await Effect.runPromise(getLitellmProviderSnapshot(env))

      expect(result.deletedKeys).toEqual([
        C0_CONFIG_KEYS.aiProviders.litellmConfig,
        C0_CONFIG_KEYS.aiProviders.litellmApiKey,
        C0_CONFIG_KEYS.aiProviders.litellmModels,
      ])
      expect(kv.values.has(C0_CONFIG_KEYS.aiProviders.litellmConfig)).toBe(false)
      expect(kv.values.has(C0_CONFIG_KEYS.aiProviders.litellmApiKey)).toBe(false)
      expect(kv.values.has(C0_CONFIG_KEYS.aiProviders.litellmModels)).toBe(false)
      expect(snapshot.configSource).toBe("deployment")
      expect(snapshot.config.baseUrl).toBe("https://env-litellm.example.com")
    } finally {
      sqlite.close()
    }
  })

  it("writes LiteLLM model registry and successful cron run", async () => {
    const { env, sqlite } = createEnv()
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse({
            data: [
              {
                model_name: "gpt-5.4-mini",
                litellm_params: { model: "openai/gpt-5.4-mini" },
                model_info: {
                  max_input_tokens: 128000,
                  max_output_tokens: 8192,
                },
                supported_openai_params: ["reasoning_effort", "tools"],
              },
            ],
          }),
        ),
      )
      await Effect.runPromise(
        updateLitellmProviderConfig(env, {
          enabled: true,
          baseUrl: "https://litellm.example.com",
          apiKey: "sk-test",
        }),
      )

      const result = await Effect.runPromise(syncLitellmModels(env, { trigger: "manual" }))
      const registry = await Effect.runPromise(getLitellmModelRegistry(env))
      const snapshot = await Effect.runPromise(getLitellmProviderSnapshot(env))

      expect(result).toMatchObject({ status: "success", models: 1 })
      expect(registry?.models["gpt-5.4-mini"]).toMatchObject({
        aiSdkAdapter: "@ai-sdk/openai",
        supportsReasoningEffort: true,
      })
      expect(snapshot.cronStatus.latestSuccess?.status).toBe("success")
    } finally {
      sqlite.close()
    }
  })

  it("records failed LiteLLM sync runs with sanitized errors", async () => {
    const { env, sqlite } = createEnv()
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse({ error: "Bearer secret-token failed" }, { status: 502 })),
      )
      await Effect.runPromise(
        updateLitellmProviderConfig(env, {
          enabled: true,
          baseUrl: "https://litellm.example.com",
          apiKey: "sk-test",
        }),
      )

      const result = await Effect.runPromise(syncLitellmModels(env, { trigger: "manual" }))
      const snapshot = await Effect.runPromise(getLitellmProviderSnapshot(env))

      expect(result.status).toBe("failure")
      expect(snapshot.cronStatus.latestFailure?.errorMessage).toContain("Bearer [redacted]")
      expect(snapshot.cronStatus.latestFailure?.errorMessage).not.toContain("secret-token")
    } finally {
      sqlite.close()
    }
  })
})
