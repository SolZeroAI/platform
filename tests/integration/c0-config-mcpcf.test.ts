import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { describe, expect, it, vi } from "vitest"
import { getMcpcfAdminResponse } from "../../packages/api/src/server/effect/handlers/admin/mcpcf"
import {
  C0_CONFIG_BINDINGS,
  C0_CONFIG_KEYS,
  C0_CONFIG_LOCATIONS,
  C0ConfigStore,
} from "../../packages/api/src/server/background/db/c0-config"
import {
  McpcfRegistryStore,
  type McpcfConfigRecord,
} from "../../packages/api/src/server/background/db/mcpcf"
import {
  exportMcpcfConfig,
  resetMcpcfConfig,
} from "../../packages/api/src/server/background/mcpcf/admin-actions"
import type { Env } from "../../packages/api/src/server/background/types"
import type { ControlPlaneContext } from "../../packages/api/src/server/effect/handlers/shared/control-plane"
import { config, createResolverStore, seedMcpcfConfig, seedMcpcfServer } from "./mcpcf-mcp/fixtures"

const encryptionKey = "test-repo-secrets-key-32-chars"
const adminApiTokenEnv = "TEST_MCPCF_ADMIN_API_TOKEN"

function createEnv(overrides: Record<string, unknown> = {}) {
  const { sqlite, db, c0Config } = createResolverStore()
  const env = {
    C0_CONFIG: c0Config,
    DB: db,
    REPO_SECRETS_ENCRYPTION_KEY: encryptionKey,
    ...overrides,
  } as unknown as Env
  return { sqlite, db, c0Config, env }
}

describe("C0_CONFIG and MCP Context Forge", () => {
  it("uses deployment config and admin token with KV-backed registry state", async () => {
    const envConfig = {
      ...config,
      baseUrl: "https://env-mcpcf.example.com",
      authTypeAllowlist: ["oauth", "token"],
      updatedAt: 2,
    } satisfies McpcfConfigRecord
    const { env, sqlite } = createEnv({
      [C0_CONFIG_BINDINGS.mcpcf]: {
        ...envConfig,
        adminApiToken: { env: adminApiTokenEnv },
      },
      [adminApiTokenEnv]: "env-mcpcf-token",
    })
    try {
      seedMcpcfConfig(sqlite)
      seedMcpcfServer(sqlite, {
        id: "server_kv",
        slug: "kv_server",
        label: "KV Server",
        authType: "oauth",
      })

      const registry = new McpcfRegistryStore(env)
      const [configPresence, tokenPresence, indexPresence, servers, adminResponse] =
        await Effect.runPromise(
          Effect.all(
            [
              registry.getConfigWithPresence(),
              registry.getAdminApiTokenWithPresence(),
              registry.getServerIndexWithPresence(),
              registry.listServers(),
              getMcpcfAdminResponse({ env } as ControlPlaneContext),
            ],
            { concurrency: "unbounded" },
          ),
        )

      expect(configPresence).toMatchObject({
        configured: true,
        source: "deployment",
        locked: true,
        envVarName: C0_CONFIG_LOCATIONS.mcpcf,
      })
      expect(configPresence.config.baseUrl).toBe("https://env-mcpcf.example.com")
      expect(tokenPresence).toMatchObject({
        configured: true,
        source: "deployment",
        locked: true,
        envVarName: `${C0_CONFIG_LOCATIONS.mcpcf}.adminApiToken`,
      })
      expect(tokenPresence.adminApiToken).toEqual(Option.some("env-mcpcf-token"))
      expect(indexPresence).toMatchObject({
        serverIds: ["server_kv"],
        source: "kv",
        locked: false,
        envVarName: null,
      })
      expect(servers.map((server) => server.id)).toEqual(["server_kv"])
      expect(adminResponse.config).toMatchObject({
        baseUrl: "https://env-mcpcf.example.com",
        source: "deployment",
        locked: true,
        adminApiTokenConfigured: true,
        adminApiTokenSource: "deployment",
        adminApiTokenLocked: true,
      })
      expect(adminResponse).toMatchObject({
        registrySource: "kv",
        registryLocked: false,
        registryEnvVarName: null,
      })
    } finally {
      sqlite.close()
    }
  })

  it("rejects admin MCPCF config updates when config is deployment-managed", async () => {
    const envConfig = {
      ...config,
      baseUrl: "https://env-mcpcf.example.com",
    } satisfies McpcfConfigRecord
    const { env, sqlite } = createEnv({
      [C0_CONFIG_BINDINGS.mcpcf]: envConfig,
    })
    try {
      const registry = new McpcfRegistryStore(env)

      await expect(
        Effect.runPromise(
          registry.upsertConfig({
            enabled: true,
            baseUrl: "https://admin-mcpcf.example.com",
            userOauthProviderId: "okta",
          }),
        ),
      ).rejects.toThrow(C0_CONFIG_LOCATIONS.mcpcf)
    } finally {
      sqlite.close()
    }
  })

  it("writes discovered server records and index entries to KV during refresh", async () => {
    const { env, sqlite, c0Config } = createEnv({
      [C0_CONFIG_BINDINGS.mcpcf]: config,
    })
    try {
      const registry = new McpcfRegistryStore(env)
      const putSpy = vi.spyOn(c0Config, "put")
      await Effect.runPromise(
        registry.refresh({
          adminApiToken: "env-mcpcf-token",
          now: 10,
          client: {
            fetchServers: () =>
              Effect.succeed([
                {
                  id: "server_grafana",
                  name: "grafana-broker-mcp",
                  displayName: "Grafana",
                  auth: { type: "oauth" },
                },
                {
                  id: "server_not_indexed",
                  name: "not-indexed-broker-mcp",
                  displayName: "Not Indexed",
                  auth: { type: "oauth" },
                },
              ]),
            fetchServerTools: () =>
              Effect.succeed([{ name: "query_datasource", description: "Query datasource." }]),
          },
        }),
      )

      expect(JSON.parse(c0Config.values.get(C0_CONFIG_KEYS.mcpcf.serverIndex) ?? "[]")).toEqual([
        "server_grafana",
        "server_not_indexed",
      ])
      expect(
        putSpy.mock.calls.filter(([key]) => key === C0_CONFIG_KEYS.mcpcf.serverIndex),
      ).toHaveLength(1)
      expect(c0Config.values.get(C0_CONFIG_KEYS.mcpcf.server("server_grafana"))).toBeDefined()
      expect(c0Config.values.get(C0_CONFIG_KEYS.mcpcf.server("server_not_indexed"))).toBeDefined()
    } finally {
      sqlite.close()
    }
  })

  it("exports KV-backed MCPCF values as a JSONC fragment plus a secret assignment", async () => {
    const { env, sqlite } = createEnv()
    try {
      const registry = new McpcfRegistryStore(env)
      const store = new C0ConfigStore(env.C0_CONFIG, encryptionKey)
      await Effect.runPromise(
        registry.upsertConfig({
          enabled: true,
          baseUrl: "https://mcpcf.example.com",
          userOauthProviderId: "okta",
          expectedIssuer: "https://issuer.example.com",
          authTypeAllowlist: ["oauth"],
          serverBlacklist: ["blocked_server"],
        }),
      )
      await Effect.runPromise(
        store.setEncryptedSecret(C0_CONFIG_KEYS.mcpcf.adminApiToken, "mcpcf-secret"),
      )
      seedMcpcfServer(sqlite, {
        id: "server_grafana",
        slug: "grafana",
        label: "Grafana",
        authType: "oauth",
      })

      const result = await Effect.runPromise(exportMcpcfConfig(env))

      expect(result).toMatchObject({
        variableCount: 2,
        includesSecret: true,
        includesRegistry: false,
        serverCount: 0,
      })
      expect(result.dotenv).toContain('"mcpcf":{"enabled":true')
      expect(result.dotenv).toContain('"adminApiToken":{"env":"C0_MCPCF_ADMIN_API_TOKEN"}')
      expect(result.dotenv).toContain("C0_MCPCF_ADMIN_API_TOKEN='mcpcf-secret'")
      expect(result.dotenv).not.toContain("createdAt")
      expect(result.dotenv).not.toContain("updatedAt")
    } finally {
      sqlite.close()
    }
  })

  it("resets only KV-backed MCPCF values", async () => {
    const envConfig = {
      ...config,
      baseUrl: "https://env-mcpcf.example.com",
    } satisfies McpcfConfigRecord
    const { env, sqlite, c0Config } = createEnv({
      [C0_CONFIG_BINDINGS.mcpcf]: envConfig,
    })
    try {
      const registry = new McpcfRegistryStore(env)
      const store = new C0ConfigStore(env.C0_CONFIG, encryptionKey)
      await Effect.runPromise(
        store.putJson(C0_CONFIG_KEYS.mcpcf.config, {
          ...config,
          baseUrl: "https://kv-mcpcf.example.com",
        }),
      )
      await Effect.runPromise(
        store.setEncryptedSecret(C0_CONFIG_KEYS.mcpcf.adminApiToken, "kv-mcpcf-secret"),
      )
      seedMcpcfServer(sqlite, {
        id: "server_grafana",
        slug: "grafana",
        label: "Grafana",
        authType: "oauth",
      })

      const result = await Effect.runPromise(resetMcpcfConfig(env))
      const configPresence = await Effect.runPromise(registry.getConfigWithPresence())
      const serverIndexPresence = await Effect.runPromise(registry.getServerIndexWithPresence())

      expect(result.deletedKeys).toEqual([
        C0_CONFIG_KEYS.mcpcf.config,
        C0_CONFIG_KEYS.mcpcf.adminApiToken,
        C0_CONFIG_KEYS.mcpcf.serverIndex,
        C0_CONFIG_KEYS.mcpcf.server("server_grafana"),
      ])
      expect(c0Config.values.has(C0_CONFIG_KEYS.mcpcf.config)).toBe(false)
      expect(c0Config.values.has(C0_CONFIG_KEYS.mcpcf.adminApiToken)).toBe(false)
      expect(c0Config.values.has(C0_CONFIG_KEYS.mcpcf.serverIndex)).toBe(false)
      expect(c0Config.values.has(C0_CONFIG_KEYS.mcpcf.server("server_grafana"))).toBe(false)
      expect(configPresence.source).toBe("deployment")
      expect(configPresence.config.baseUrl).toBe("https://env-mcpcf.example.com")
      expect(serverIndexPresence.source).toBe("none")
      expect(serverIndexPresence.serverIds).toEqual([])
    } finally {
      sqlite.close()
    }
  })
})
