import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { describe, expect, it, vi } from "vitest"
import { getMcpcfProxyToolName } from "../../packages/shared/src/session-tools"
import {
  createMcpcfMcpServer,
  formatMcpcfBearerCredential,
  getMcpcfServerMcpUrl,
  resolveMcpcfMcpContext,
  type McpcfUpstreamClient,
} from "../../packages/api/src/server/mcp/mcpcf-server"
import { createJsonRpcErrorResponse } from "../../packages/api/src/server/mcp/json-rpc-error"
import { GlobalSecretsStore } from "../../packages/api/src/server/background/db/repo-secrets"
import {
  getUserMcpcfAuthTokenSecretKey,
  getUserMcpcfGatewayApiTokenSecretKey,
  UserMcpcfServerConfigStore,
} from "../../packages/api/src/server/background/db/user-mcpcf"
import { getMcpcfMcpServerName } from "../../packages/api/src/server/background/session/mcp-config"
import type { Env } from "../../packages/api/src/server/background/types"
import {
  config,
  createLog,
  createContext,
  createResolverRequest,
  createResolverStore,
  createTestUpstreamClient,
  firehydrantToken,
  grafana,
  invokeServerRequest,
  seedMcpcfConfig,
  seedMcpcfServer,
  seedOktaAccount,
  seedSession,
  type TestMcpServer,
} from "./mcpcf-mcp/fixtures"

describe("MCP Context Forge MCP server", () => {
  it("formats bearer credentials without double-prefixing pasted header values", () => {
    expect(formatMcpcfBearerCredential("fh-token")).toBe("Bearer fh-token")
    expect(formatMcpcfBearerCredential("Bearer fh-token")).toBe("Bearer fh-token")
    expect(formatMcpcfBearerCredential("bearer fh-token")).toBe("bearer fh-token")
  })

  it("uses the gateway token for token-auth registry servers without upstream auth", async () => {
    const { sqlite, db, c0Config } = createResolverStore()
    try {
      seedSession(sqlite, { sessionId: "session-token", serverId: "server_runbooks" })
      seedMcpcfConfig(sqlite)
      seedMcpcfServer(sqlite, {
        id: "server_runbooks",
        slug: "runbooks",
        label: "Runbooks",
        authType: "token",
      })
      await Effect.runPromise(
        new GlobalSecretsStore(db, "test-repo-secrets-key-32-chars").setSecrets(
          {
            [getUserMcpcfGatewayApiTokenSecretKey()]: "user_contextforge_api_token",
          },
          { userId: "user_1" },
        ),
      )

      const context = await Effect.runPromise(
        resolveMcpcfMcpContext(
          createResolverRequest("server_runbooks"),
          {
            C0_CONFIG: c0Config,
            DB: db,
            REPO_SECRETS_ENCRYPTION_KEY: "test-repo-secrets-key-32-chars",
          } as Env,
          { log: createLog() },
          "session-token",
        ),
      )

      expect(context).toMatchObject({
        authMode: Option.some("mcpcf_token"),
        accessToken: Option.some("user_contextforge_api_token"),
        accessTokensByServerId: {
          server_runbooks: "user_contextforge_api_token",
        },
        upstreamAccessTokensByServerId: {},
        oauthProviderId: Option.none(),
        providerUserId: Option.none(),
      })
    } finally {
      sqlite.close()
    }
  })

  it("forwards a user token only when upstream token auth is explicit", async () => {
    const { sqlite, db, c0Config } = createResolverStore()
    try {
      seedSession(sqlite, { sessionId: "session-upstream-token", serverId: "server_runbooks" })
      seedMcpcfConfig(sqlite)
      seedMcpcfServer(sqlite, {
        id: "server_runbooks",
        slug: "runbooks",
        label: "Runbooks",
        authType: "token",
        rawMetadata: { upstreamAuthType: "token" },
      })
      const secretKey = getUserMcpcfAuthTokenSecretKey("server_runbooks")
      await Effect.runPromise(
        new UserMcpcfServerConfigStore(db).upsert({
          userId: "user_1",
          serverId: "server_runbooks",
          authTokenSecretKey: secretKey,
        }),
      )
      await Effect.runPromise(
        new GlobalSecretsStore(db, "test-repo-secrets-key-32-chars").setSecrets(
          {
            [secretKey]: "user_runbook_token",
            [getUserMcpcfGatewayApiTokenSecretKey()]: "user_contextforge_api_token",
          },
          { userId: "user_1" },
        ),
      )

      const context = await Effect.runPromise(
        resolveMcpcfMcpContext(
          createResolverRequest("server_runbooks"),
          {
            C0_CONFIG: c0Config,
            DB: db,
            REPO_SECRETS_ENCRYPTION_KEY: "test-repo-secrets-key-32-chars",
          } as Env,
          { log: createLog() },
          "session-upstream-token",
        ),
      )

      expect(context).toMatchObject({
        authMode: Option.some("mcpcf_token"),
        accessToken: Option.some("user_contextforge_api_token"),
        accessTokensByServerId: {
          server_runbooks: "user_contextforge_api_token",
        },
        upstreamAccessTokensByServerId: {
          server_runbooks: "user_runbook_token",
        },
      })
    } finally {
      sqlite.close()
    }
  })

  it("uses the linked user OAuth token for OAuth registry servers", async () => {
    const { sqlite, db, c0Config } = createResolverStore()
    try {
      seedSession(sqlite, { sessionId: "session-oauth", serverId: "server_grafana" })
      seedMcpcfConfig(sqlite)
      seedMcpcfServer(sqlite, {
        id: "server_grafana",
        slug: "grafana",
        label: "Grafana",
        authType: "oauth",
      })
      seedOktaAccount(sqlite)

      const context = await Effect.runPromise(
        resolveMcpcfMcpContext(
          createResolverRequest("server_grafana"),
          {
            C0_CONFIG: c0Config,
            C0_CONFIG_AUTH: {
              defaultSignInProviderId: "okta",
              adminPassword: { env: "TEST_ADMIN_PASSWORD" },
              providers: {
                okta: {
                  kind: "oidc",
                  enabled: true,
                  displayName: "Okta",
                  issuer: "https://example.okta.com/oauth2/default",
                  clientId: "okta-client",
                  clientSecret: { env: "TEST_OKTA_CLIENT_SECRET" },
                  capabilities: { signIn: true, provisionUsers: true, link: true },
                },
              },
            },
            TEST_OKTA_CLIENT_SECRET: "okta-client-secret",
            DB: db,
            REPO_SECRETS_ENCRYPTION_KEY: "test-repo-secrets-key-32-chars",
          } as Env,
          { log: createLog() },
          "session-oauth",
        ),
      )

      expect(context).toMatchObject({
        authMode: Option.some("mcpcf_oauth"),
        accessToken: Option.some("okta_access_token"),
        oauthProviderId: Option.some("okta"),
        providerUserId: Option.some("00u-okta-user"),
      })
    } finally {
      sqlite.close()
    }
  })

  it("lists single-server upstream tools with compact names and preserved schemas", async () => {
    const upstreamClient = createTestUpstreamClient()
    const server = createMcpcfMcpServer(
      createContext({ upstreamClient }),
    ) as unknown as TestMcpServer

    const listedTools = await invokeServerRequest(server, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    })

    expect(listedTools).toMatchObject({
      tools: [
        expect.objectContaining({
          name: "query_datasource",
          description: expect.stringContaining("[Grafana] Run a datasource query."),
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        }),
      ],
    })
    expect(upstreamClient.listTools).toHaveBeenCalledWith({
      config,
      server: grafana,
      accessToken: "oauth_access_token",
    })
  })

  it("does not expose tools when the server default is disabled for new sessions", async () => {
    const upstreamClient = createTestUpstreamClient()
    const server = createMcpcfMcpServer(
      createContext({
        upstreamClient,
        serverSettingsById: {
          [grafana.id]: {
            defaultToolsEnabled: false,
            disabledTools: [],
          },
        },
      }),
    ) as unknown as TestMcpServer

    const listedTools = await invokeServerRequest(server, {
      jsonrpc: "2.0",
      id: "disabled-default",
      method: "tools/list",
      params: {},
    })

    expect(listedTools).toEqual({ tools: [] })
    await expect(
      invokeServerRequest(server, {
        jsonrpc: "2.0",
        id: "disabled-call",
        method: "tools/call",
        params: {
          name: "query_datasource",
          arguments: {
            query: "up",
          },
        },
      }),
    ).rejects.toThrow("disabled by default")
    expect(upstreamClient.callTool).not.toHaveBeenCalled()
  })

  it("keeps single-server MCP Context Forge tool names under the model limit", async () => {
    const upstreamToolName = "firehydrant-broker-mcp-firehydrant-list-retrospectives"
    const upstreamClient: McpcfUpstreamClient = {
      listTools: vi.fn(() =>
        Effect.succeed([
          {
            name: upstreamToolName,
            description: "List retrospectives.",
            inputSchema: { type: "object", properties: {} },
          },
        ]),
      ),
      callTool: vi.fn(() => Effect.succeed({ content: [] })),
    }
    const server = createMcpcfMcpServer(
      createContext({
        upstreamClient,
        servers: [firehydrantToken],
      }),
    ) as unknown as TestMcpServer

    const listedTools = (await invokeServerRequest(server, {
      jsonrpc: "2.0",
      id: "long-name",
      method: "tools/list",
      params: {},
    })) as { tools: Array<{ name: string }> }

    expect(listedTools.tools[0]?.name).toBe(upstreamToolName)
    expect(`tool_${getMcpcfMcpServerName(firehydrantToken)}_${upstreamToolName}`).toHaveLength(94)
  })

  it("uses short MCP Context Forge tool aliases when one MCP server exposes multiple servers", async () => {
    const upstreamClient = createTestUpstreamClient()
    const server = createMcpcfMcpServer(
      createContext({
        upstreamClient,
        servers: [grafana, firehydrantToken],
      }),
    ) as unknown as TestMcpServer

    const listedTools = (await invokeServerRequest(server, {
      jsonrpc: "2.0",
      id: "multi-server",
      method: "tools/list",
      params: {},
    })) as { tools: Array<{ name: string }> }

    expect(listedTools.tools.map((tool) => tool.name)).toEqual([
      getMcpcfProxyToolName(grafana.id, "query_datasource"),
      getMcpcfProxyToolName(firehydrantToken.id, "query_datasource"),
    ])
  })

  it("keeps multi-server MCP Context Forge tool aliases under the model limit", async () => {
    const upstreamToolName = "firehydrant-broker-mcp-firehydrant-list-retrospectives"
    const proxyToolName = getMcpcfProxyToolName(firehydrantToken.id, upstreamToolName)

    expect(proxyToolName).toMatch(/^mcpcf_s[a-z0-9]{7}__/)
    expect(`tool_mcpcf_${proxyToolName}`.length).toBeLessThanOrEqual(128)
  })

  it("routes proxied tool calls to the selected upstream server with the user OAuth token", async () => {
    const upstreamClient = createTestUpstreamClient()
    const server = createMcpcfMcpServer(
      createContext({ upstreamClient }),
    ) as unknown as TestMcpServer

    const result = await invokeServerRequest(server, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "query_datasource",
        arguments: {
          query: "rate(errors[5m])",
        },
      },
    })

    expect(result).toMatchObject({
      content: [
        {
          type: "text",
          text: "Grafana:query_datasource:rate(errors[5m])",
        },
      ],
    })
    expect(upstreamClient.callTool).toHaveBeenCalledWith({
      config,
      server: grafana,
      accessToken: "oauth_access_token",
      toolName: "query_datasource",
      arguments: {
        query: "rate(errors[5m])",
      },
    })
  })

  it("routes short-alias tool calls to the selected upstream server", async () => {
    const upstreamClient = createTestUpstreamClient()
    const server = createMcpcfMcpServer(
      createContext({
        upstreamClient,
        servers: [grafana, firehydrantToken],
      }),
    ) as unknown as TestMcpServer

    const result = await invokeServerRequest(server, {
      jsonrpc: "2.0",
      id: "alias-call",
      method: "tools/call",
      params: {
        name: getMcpcfProxyToolName(firehydrantToken.id, "query_datasource"),
        arguments: {
          query: "incidents",
        },
      },
    })

    expect(result).toMatchObject({
      content: [
        {
          type: "text",
          text: "FireHydrant:query_datasource:incidents",
        },
      ],
    })
    expect(upstreamClient.callTool).toHaveBeenCalledWith({
      config,
      server: firehydrantToken,
      accessToken: "oauth_access_token",
      toolName: "query_datasource",
      arguments: {
        query: "incidents",
      },
    })
  })

  it("routes token-auth servers with gateway auth and no upstream user auth by default", async () => {
    const upstreamClient = createTestUpstreamClient({
      accessToken: "gateway_access_token",
    })
    const server = createMcpcfMcpServer(
      createContext({
        accessToken: "gateway_access_token",
        accessTokensByServerId: {
          [firehydrantToken.id]: "gateway_access_token",
        },
        authMode: "mcpcf_token",
        servers: [firehydrantToken],
        upstreamClient,
      }),
    ) as unknown as TestMcpServer

    await invokeServerRequest(server, {
      jsonrpc: "2.0",
      id: "token-list",
      method: "tools/list",
      params: {},
    })
    await invokeServerRequest(server, {
      jsonrpc: "2.0",
      id: "token-call",
      method: "tools/call",
      params: {
        name: "query_datasource",
        arguments: {
          query: "latest incidents",
        },
      },
    })

    expect(upstreamClient.listTools).toHaveBeenCalledWith({
      config,
      server: firehydrantToken,
      accessToken: "gateway_access_token",
    })
    expect(upstreamClient.callTool).toHaveBeenCalledWith({
      config,
      server: firehydrantToken,
      accessToken: "gateway_access_token",
      toolName: "query_datasource",
      arguments: {
        query: "latest incidents",
      },
    })
  })

  it("routes explicit upstream token-auth servers with gateway auth and upstream user auth", async () => {
    const upstreamFirehydrantToken = {
      ...firehydrantToken,
      rawMetadata: { upstreamAuthType: "token" },
    }
    const upstreamClient = createTestUpstreamClient({
      accessToken: "gateway_access_token",
      upstreamAccessToken: "user_firehydrant_token",
    })
    const server = createMcpcfMcpServer(
      createContext({
        accessToken: "gateway_access_token",
        accessTokensByServerId: {
          [upstreamFirehydrantToken.id]: "gateway_access_token",
        },
        upstreamAccessTokensByServerId: {
          [upstreamFirehydrantToken.id]: "user_firehydrant_token",
        },
        authMode: "mcpcf_token",
        servers: [upstreamFirehydrantToken],
        upstreamClient,
      }),
    ) as unknown as TestMcpServer

    await invokeServerRequest(server, {
      jsonrpc: "2.0",
      id: "explicit-upstream-token-list",
      method: "tools/list",
      params: {},
    })
    await invokeServerRequest(server, {
      jsonrpc: "2.0",
      id: "explicit-upstream-token-call",
      method: "tools/call",
      params: {
        name: "query_datasource",
        arguments: {
          query: "latest incidents",
        },
      },
    })

    expect(upstreamClient.listTools).toHaveBeenCalledWith({
      config,
      server: upstreamFirehydrantToken,
      accessToken: "gateway_access_token",
      upstreamAccessToken: "user_firehydrant_token",
    })
    expect(upstreamClient.callTool).toHaveBeenCalledWith({
      config,
      server: upstreamFirehydrantToken,
      accessToken: "gateway_access_token",
      upstreamAccessToken: "user_firehydrant_token",
      toolName: "query_datasource",
      arguments: {
        query: "latest incidents",
      },
    })
  })

  it("rejects legacy slug-prefixed tool calls for a single selected server", async () => {
    const upstreamClient = createTestUpstreamClient()
    const server = createMcpcfMcpServer(
      createContext({ upstreamClient }),
    ) as unknown as TestMcpServer

    await expect(
      invokeServerRequest(server, {
        jsonrpc: "2.0",
        id: "legacy-call",
        method: "tools/call",
        params: {
          name: "mcpcf_grafana__query_datasource",
          arguments: {
            query: "up",
          },
        },
      }),
    ).rejects.toThrow("Unknown MCP Context Forge tool")
    expect(upstreamClient.callTool).not.toHaveBeenCalled()
  })

  it("rejects unselected MCP Context Forge proxy tool calls", async () => {
    const upstreamClient = createTestUpstreamClient()
    const server = createMcpcfMcpServer(
      createContext({ upstreamClient }),
    ) as unknown as TestMcpServer

    await expect(
      invokeServerRequest(server, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: getMcpcfProxyToolName("server_atlassian", "search"),
          arguments: {},
        },
      }),
    ).rejects.toThrow("server alias")
    expect(upstreamClient.callTool).not.toHaveBeenCalled()
  })

  it("redacts OAuth access tokens from upstream errors", async () => {
    const accessToken = "oauth_secret_access_token"
    const upstreamClient: McpcfUpstreamClient = {
      listTools: vi.fn(() => Effect.fail(new Error(`401 Unauthorized: Bearer ${accessToken}`))),
      callTool: vi.fn(() => Effect.fail(new Error(`403 Forbidden for ${accessToken}`))),
    }
    const server = createMcpcfMcpServer(
      createContext({ accessToken, upstreamClient }),
    ) as unknown as TestMcpServer

    await expect(
      invokeServerRequest(server, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/list",
        params: {},
      }),
    ).rejects.not.toThrow(accessToken)

    await expect(
      invokeServerRequest(server, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "mcpcf_grafana__query_datasource",
          arguments: {},
        },
      }),
    ).rejects.not.toThrow(accessToken)
  })

  it("builds upstream MCP URLs from configured base URL and virtual server IDs", () => {
    expect(getMcpcfServerMcpUrl(config, grafana)).toBe(
      "https://mcpcf.example.com/servers/server_grafana/mcp",
    )
  })

  it("preserves JSON-RPC request ids in error responses", async () => {
    const response = await Effect.runPromise(
      createJsonRpcErrorResponse(
        new Request("https://api.c0.example.com/integrations/mcpcf/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 7,
            method: "initialize",
            params: {},
          }),
        }),
        { message: "MCP Context Forge session not found" },
      ),
    )

    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "MCP Context Forge session not found",
      },
      id: 7,
    })
    expect(response.status).toBe(500)
  })

  it("includes structured JSON-RPC error data when provided", async () => {
    const response = await Effect.runPromise(
      createJsonRpcErrorResponse(
        new Request("https://api.c0.example.com/integrations/mcpcf/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "request-1",
            method: "initialize",
            params: {},
          }),
        }),
        {
          message: "Reconnect your configured OAuth account to use MCP Context Forge tools.",
          data: { discoveryReason: "oauth_reconnect_required" },
        },
      ),
    )

    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Reconnect your configured OAuth account to use MCP Context Forge tools.",
        data: { discoveryReason: "oauth_reconnect_required" },
      },
      id: "request-1",
    })
  })
})
