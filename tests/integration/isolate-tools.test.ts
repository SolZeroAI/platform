import * as Effect from "effect/Effect"
import { describe, expect, it } from "vitest"
import type { McpcfServerDefinition } from "../../packages/shared/src/session-tools"
import type { Env } from "../../packages/api/src/server/background/types"
import {
  buildIsolateTools,
  type IsolateWorkspaceRuntime,
} from "../../packages/api/src/server/background/isolate/tools"
import {
  buildInternalMcpcfMcpServerRegistrations,
  buildRemoteCustomMcpServerRegistrations,
  formatMcpcfMcpAuthError,
  formatMcpcfMcpSyncError,
  syncIsolateMcpServers,
  syncIsolateCustomMcpServers,
  type IsolateMcpManager,
} from "../../packages/api/src/server/background/isolate/mcp"
import {
  MCPCF_MCP_TIMEOUT_MS,
  MCPCF_SERVER_HEADER,
  getMcpcfIsolateMcpUrl,
  getMcpcfMcpServerName,
} from "../../packages/api/src/server/background/session/mcp-config"
import {
  buildIsolateSystemPrompt,
  buildIsolateSystemPromptFacts,
} from "../../packages/api/src/server/background/session/isolate/system"
import { compiledStageEnv } from "../fixtures/stage-metadata"

const MCPCF_SERVERS: McpcfServerDefinition[] = [
  {
    id: "server_grafana",
    slug: "grafana",
    label: "Grafana",
    description: "Grafana server",
    toolCount: 2,
  },
  {
    id: "server_firehydrant",
    slug: "firehydrant",
    label: "FireHydrant",
    description: "FireHydrant server",
    toolCount: 2,
  },
]

const runtime = {} as IsolateWorkspaceRuntime
const env = {} as Env
const prodStageEnv = compiledStageEnv("prod")
const docsRuntimeContext = { log: { error() {} } }
const timeMcpServer = {
  type: "remote" as const,
  url: "https://a.currenttimeutc.com/mcp",
  enabled: true,
}

type TestMcpRows = ReturnType<IsolateMcpManager["listServers"]>

function createTestMcpManager(
  overrides: Partial<
    Pick<IsolateMcpManager, "connectToServer" | "discoverIfConnected" | "removeServer">
  > = {},
): {
  manager: IsolateMcpManager
  rows: TestMcpRows
} {
  const rows: TestMcpRows = []
  const manager: IsolateMcpManager = {
    mcpConnections: {},
    listServers: () => rows,
    removeServer: async (id) => {
      const rowIndex = rows.findIndex((row) => row.id === id)
      if (rowIndex >= 0) {
        rows.splice(rowIndex, 1)
      }
      delete manager.mcpConnections[id]
    },
    registerServer: async (id, options) => {
      rows.push({
        id,
        name: options.name,
        server_url: options.url,
        callback_url: "",
        client_id: null,
        auth_url: null,
        server_options: JSON.stringify({
          transport: options.transport,
        }),
      })
      manager.mcpConnections[id] = {
        connectionState: "connecting",
      } as IsolateMcpManager["mcpConnections"][string]
      return id
    },
    connectToServer: async (id) => {
      manager.mcpConnections[id] = {
        connectionState: "connected",
      } as IsolateMcpManager["mcpConnections"][string]
      return { state: "connected" }
    },
    discoverIfConnected: async (id) => {
      manager.mcpConnections[id] = {
        connectionState: "ready",
      } as IsolateMcpManager["mcpConnections"][string]
      return { state: "ready", success: true }
    },
  }

  Object.assign(manager, overrides)
  return { manager, rows }
}

describe("isolate tools", () => {
  it("exposes docs search without requiring an attached repository", () => {
    const tools = buildIsolateTools({
      env,
      runtime,
      sessionId: "session-docs-only",
      userId: "user-1",
      selectedTools: [{ kind: "ai_search", sourceId: "product-docs" }],
      docsRuntimeContext,
    })

    expect(Object.keys(tools)).toEqual(["docs_search"])
  })

  it("exposes repository tools only when a repository is attached", () => {
    const tools = buildIsolateTools({
      env,
      runtime,
      sessionId: "session-with-repo",
      userId: "user-1",
      selectedTools: [{ kind: "github_repo", repoOwner: "example-org", repoName: "ai" }],
      docsRuntimeContext,
    })

    expect(Object.keys(tools)).toEqual([
      "read_file",
      "write_file",
      "glob_files",
      "search_files",
      "git_status",
      "git_diff",
      "git_log",
      "git_create_pull_request",
    ])
  })

  it("exposes workflow builder tools without requiring an attached repository", () => {
    const tools = buildIsolateTools({
      env,
      runtime,
      sessionId: "session-workflow-builder",
      userId: "user-1",
      selectedTools: [{ kind: "workflow_builder" }],
      docsRuntimeContext,
    })

    expect(Object.keys(tools)).toEqual([
      "get_workflow_node_catalog",
      "validate_workflow_manifest",
      "submit_workflow_draft",
    ])
  })

  it("does not require MCP Context Forge registry records for internal isolate tools", () => {
    const tools = buildIsolateTools({
      env,
      runtime,
      sessionId: "session-mcpcf-only",
      userId: "user-1",
      selectedTools: [{ kind: "mcpcf_server", serverId: "server_grafana" }],
      docsRuntimeContext,
    })

    expect(Object.keys(tools)).toEqual([])
  })
})

describe("isolate custom MCP servers", () => {
  it("builds deterministic remote MCP registrations from enabled custom MCPs", () => {
    const registrations = buildRemoteCustomMcpServerRegistrations({
      time: timeMcpServer,
      disabled: {
        type: "remote",
        url: "https://example.com/mcp",
        enabled: false,
      },
      local: {
        type: "local",
        command: ["node", "server.js"],
        enabled: true,
      },
    })

    expect(registrations).toHaveLength(1)
    expect(registrations[0]).toMatchObject({
      id: "custom_time__24b0t",
      name: "time",
      optional: true,
      options: {
        name: "time",
        url: "https://a.currenttimeutc.com/mcp",
        transport: { type: "auto" },
      },
    })
  })

  it("registers configured remote MCP servers for isolate turns", async () => {
    const { manager, rows } = createTestMcpManager()

    const result = await Effect.runPromise(
      syncIsolateCustomMcpServers(manager, {
        time: timeMcpServer,
      }),
    )

    expect(rows).toEqual([
      expect.objectContaining({
        id: "custom_time__24b0t",
        name: "time",
        server_url: "https://a.currenttimeutc.com/mcp",
      }),
    ])
    expect(result).toEqual({
      connectedServerNames: ["time"],
      skippedServers: [],
    })
    expect(manager.mcpConnections[rows[0].id]?.connectionState).toBe("ready")
  })

  it("builds an internal MCP Context Forge MCP registration for isolate turns", () => {
    const grafana = MCPCF_SERVERS.find((server) => server.label === "Grafana")!
    const grafanaName = getMcpcfMcpServerName(grafana)
    const registrations = buildInternalMcpcfMcpServerRegistrations({
      tools: [{ kind: "mcpcf_server", serverId: grafana.id }],
      mcpcfServers: MCPCF_SERVERS,
      sessionId: "session-mcpcf",
      stage: "dev",
      mcpcfCapability: "session-capability",
    })

    expect(registrations).toHaveLength(1)
    expect(registrations[0]).toMatchObject({
      id: grafanaName,
      name: grafanaName,
      optional: false,
      options: {
        name: grafanaName,
        url: getMcpcfIsolateMcpUrl("dev"),
        transport: {
          type: "auto",
          requestInit: {
            headers: {
              [MCPCF_SERVER_HEADER]: grafana.id,
              Authorization: "Bearer session-capability",
            },
          },
        },
      },
    })
    expect(registrations[0].server.timeout).toBe(MCPCF_MCP_TIMEOUT_MS)
    expect(JSON.stringify(registrations)).not.toContain("session-mcpcf")
  })

  it("sends MCP Context Forge isolate headers through streamable HTTP requestInit", () => {
    const firehydrant = MCPCF_SERVERS.find((server) => server.label === "FireHydrant")!
    const [registration] = buildInternalMcpcfMcpServerRegistrations({
      tools: [{ kind: "mcpcf_server", serverId: firehydrant.id }],
      mcpcfServers: MCPCF_SERVERS,
      sessionId: "session-mcpcf",
      stage: "dev",
      mcpcfCapability: "session-capability",
    })

    expect(registration?.options.transport).toMatchObject({
      type: "auto",
      requestInit: {
        headers: {
          [MCPCF_SERVER_HEADER]: firehydrant.id,
          Authorization: "Bearer session-capability",
        },
      },
    })
    expect(registration?.options.transport).not.toHaveProperty("headers")
  })

  it("uses the integration route with a session capability in production", () => {
    const grafana = MCPCF_SERVERS.find((server) => server.label === "Grafana")!
    const [registration] = buildInternalMcpcfMcpServerRegistrations({
      tools: [{ kind: "mcpcf_server", serverId: grafana.id }],
      mcpcfServers: MCPCF_SERVERS,
      sessionId: "session-mcpcf",
      stage: prodStageEnv,
      mcpcfCapability: "signed-session-capability",
    })

    expect(registration?.server.url).toBe(getMcpcfIsolateMcpUrl(prodStageEnv))
    expect(registration?.server.url).toBe("https://api.ai.example.org/integrations/mcpcf/mcp")
    expect(registration?.options.transport).toMatchObject({
      type: "auto",
      requestInit: {
        headers: {
          [MCPCF_SERVER_HEADER]: grafana.id,
          Authorization: "Bearer signed-session-capability",
        },
      },
    })
    expect(registration?.secretValues).toEqual(["signed-session-capability"])
  })

  it("extracts JSON-RPC errors from MCP Context Forge endpoint failures", () => {
    expect(
      formatMcpcfMcpSyncError(
        new Error(
          [
            "Failed to connect remote MCP server 'mcpcf_grafana':",
            'Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32603,"message":"MCP Context Forge session not found"},"id":7}',
          ].join(" "),
        ),
      ),
    ).toBe("MCP Context Forge session not found")
  })

  it("syncs custom and MCP Context Forge MCP servers for isolate turns", async () => {
    const grafana = MCPCF_SERVERS.find((server) => server.label === "Grafana")!
    const grafanaName = getMcpcfMcpServerName(grafana)
    const { manager, rows } = createTestMcpManager()

    const result = await Effect.runPromise(
      syncIsolateMcpServers(manager, {
        customMcpServers: { time: timeMcpServer },
        tools: [{ kind: "mcpcf_server", serverId: grafana.id }],
        mcpcfServers: MCPCF_SERVERS,
        sessionId: "session-mcpcf",
        stage: "dev",
      }),
    )

    expect(rows.map((row) => row.name).sort()).toEqual([grafanaName, "time"])
    expect(result).toEqual({
      connectedServerNames: ["time", grafanaName],
      skippedServers: [],
    })
  })

  it("rediscovers ready MCP Context Forge MCP servers before exposing cached tools", async () => {
    const grafana = MCPCF_SERVERS.find((server) => server.label === "Grafana")!
    const grafanaName = getMcpcfMcpServerName(grafana)
    const { manager } = createTestMcpManager()

    await Effect.runPromise(
      syncIsolateMcpServers(manager, {
        tools: [{ kind: "mcpcf_server", serverId: grafana.id }],
        mcpcfServers: MCPCF_SERVERS,
        sessionId: "session-mcpcf",
        stage: "dev",
      }),
    )

    let rediscoverCount = 0
    manager.discoverIfConnected = async () => {
      rediscoverCount += 1
      return {
        state: "connected",
        success: false,
        error: 'MCP error -32603: {"detail":"Invalid authentication credentials"}',
      }
    }

    await expect(
      Effect.runPromise(
        syncIsolateMcpServers(manager, {
          tools: [{ kind: "mcpcf_server", serverId: grafana.id }],
          mcpcfServers: MCPCF_SERVERS,
          sessionId: "session-mcpcf",
          stage: "dev",
        }),
      ),
    ).rejects.toThrow(`Failed to discover remote MCP server '${grafanaName}': MCP error -32603`)
    expect(rediscoverCount).toBe(1)
  })

  it("keeps matching MCP Context Forge rows when the streamable HTTP transport has a session id", async () => {
    const grafana = MCPCF_SERVERS.find((server) => server.label === "Grafana")!
    const { manager, rows } = createTestMcpManager()

    await Effect.runPromise(
      syncIsolateMcpServers(manager, {
        tools: [{ kind: "mcpcf_server", serverId: grafana.id }],
        mcpcfServers: MCPCF_SERVERS,
        sessionId: "session-mcpcf",
        stage: "dev",
      }),
    )

    const storedOptions = JSON.parse(rows[0]!.server_options!)
    rows[0]!.server_options = JSON.stringify({
      ...storedOptions,
      transport: {
        ...storedOptions.transport,
        sessionId: "mcp-streamable-http-session",
      },
    })

    let registerCount = 0
    let rediscoverCount = 0
    const registerServer = manager.registerServer
    manager.registerServer = async (...args) => {
      registerCount += 1
      return registerServer(...args)
    }
    manager.discoverIfConnected = async () => {
      rediscoverCount += 1
      return {
        state: "ready",
        success: true,
      }
    }

    await Effect.runPromise(
      syncIsolateMcpServers(manager, {
        tools: [{ kind: "mcpcf_server", serverId: grafana.id }],
        mcpcfServers: MCPCF_SERVERS,
        sessionId: "session-mcpcf",
        stage: "dev",
      }),
    )

    expect(registerCount).toBe(0)
    expect(rediscoverCount).toBe(1)
  })

  it("replaces legacy direct MCP Context Forge MCP rows with the internal proxy", async () => {
    const grafana = MCPCF_SERVERS.find((server) => server.label === "Grafana")!
    const grafanaName = getMcpcfMcpServerName(grafana)
    const { manager, rows } = createTestMcpManager()
    rows.push({
      id: grafanaName,
      name: grafanaName,
      server_url: "https://mcpcf.example.com/servers/legacy/mcp",
      callback_url: "",
      client_id: null,
      auth_url: null,
      server_options: "{}",
    })
    manager.mcpConnections[grafanaName] = {
      connectionState: "ready",
    } as IsolateMcpManager["mcpConnections"][string]

    await Effect.runPromise(
      syncIsolateMcpServers(manager, {
        tools: [{ kind: "mcpcf_server", serverId: grafana.id }],
        mcpcfServers: MCPCF_SERVERS,
        sessionId: "session-mcpcf",
        stage: "dev",
      }),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: grafanaName,
      name: grafanaName,
      server_url: getMcpcfIsolateMcpUrl("dev"),
    })
  })

  it("formats serialized MCP Context Forge Okta reconnect errors for user-visible isolate events", () => {
    expect(
      formatMcpcfMcpAuthError(
        new Error(
          "LinkedOAuthReconnectRequiredError: Reconnect your configured OAuth account to use MCP Context Forge tools.",
        ),
      ),
    ).toBe("Reconnect your configured OAuth account to use MCP Context Forge tools.")
  })

  it("formats nested MCP Context Forge Okta reconnect errors from MCP discovery", () => {
    expect(
      formatMcpcfMcpSyncError(
        new Error(
          "Failed to discover remote MCP server 'mcpcf_firehydrant': Streamable HTTP error: Error POSTing to endpoint: Error: LinkedOAuthReconnectRequiredError: Reconnect your configured OAuth account to use MCP Context Forge tools.",
        ),
      ),
    ).toBe("Reconnect your configured OAuth account to use MCP Context Forge tools.")
  })

  it("formats MCP Context Forge sync errors for terminal discovery events", () => {
    expect(
      formatMcpcfMcpSyncError(
        new Error(
          "Failed to discover remote MCP server 'mcpcf_firehydrant': Reconnect your configured OAuth account to use MCP Context Forge tools.",
        ),
      ),
    ).toBe("Reconnect your configured OAuth account to use MCP Context Forge tools.")
  })

  it("formats JSON-RPC MCP Context Forge reconnect errors for terminal discovery events", () => {
    const jsonRpcError = JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Reconnect your configured OAuth account to use MCP Context Forge tools.",
        data: { discoveryReason: "oauth_reconnect_required" },
      },
      id: 7,
    })

    expect(
      formatMcpcfMcpSyncError(
        new Error(
          `Failed to discover remote MCP server 'mcpcf_grafana': Streamable HTTP error: Error POSTing to endpoint: ${jsonRpcError}`,
        ),
      ),
    ).toBe("Reconnect your configured OAuth account to use MCP Context Forge tools.")
  })

  it("classifies JSON-RPC MCP Context Forge reconnect errors as OAuth reconnect failures", async () => {
    const grafana = MCPCF_SERVERS.find((server) => server.label === "Grafana")!
    const jsonRpcError = JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Reconnect your configured OAuth account to use MCP Context Forge tools.",
        data: { discoveryReason: "oauth_reconnect_required" },
      },
      id: 7,
    })
    const { manager } = createTestMcpManager({
      discoverIfConnected: async () => ({
        state: "failed",
        success: false,
        error: `Streamable HTTP error: Error POSTing to endpoint: ${jsonRpcError}`,
      }),
    })

    await expect(
      Effect.runPromise(
        syncIsolateMcpServers(manager, {
          tools: [{ kind: "mcpcf_server", serverId: grafana.id }],
          mcpcfServers: MCPCF_SERVERS,
          sessionId: "session-mcpcf",
          stage: "dev",
        }),
      ),
    ).rejects.toMatchObject({
      discoveryReason: "oauth_reconnect_required",
      serverName: getMcpcfMcpServerName(grafana),
    })
  })

  it("skips the default time MCP when discovery fails", async () => {
    const { manager, rows } = createTestMcpManager({
      connectToServer: async () => ({
        state: "failed",
        error: "network unavailable",
      }),
      discoverIfConnected: async () => ({ state: "failed", success: false }),
    })

    const result = await Effect.runPromise(
      syncIsolateCustomMcpServers(manager, {
        time: timeMcpServer,
      }),
    )

    expect(rows).toEqual([])
    expect(result).toEqual({
      connectedServerNames: [],
      skippedServers: [
        {
          name: "time",
          error: "Failed to connect remote MCP server 'time': network unavailable",
        },
      ],
    })
  })

  it("keeps explicit custom MCP failures fatal", async () => {
    const { manager } = createTestMcpManager({
      connectToServer: async () => ({
        state: "failed",
        error: "network unavailable",
      }),
      discoverIfConnected: async () => ({ state: "failed", success: false }),
    })

    await expect(
      Effect.runPromise(
        syncIsolateCustomMcpServers(manager, {
          linear: {
            type: "remote",
            url: "https://linear.example.com/mcp",
            enabled: true,
          },
        }),
      ),
    ).rejects.toThrow("Failed to connect remote MCP server 'linear': network unavailable")
  })
})

describe("isolate system prompt", () => {
  it("describes docs-only sessions as having no attached repository", () => {
    const prompt = buildIsolateSystemPrompt({
      runtimeModelId: "litellm/gpt-5.4-mini",
      providerId: "litellm",
      modelId: "gpt-5.4-mini",
      hasRepoWorkspace: false,
      hasDocs: true,
      hasWorkflowBuilder: true,
      customMcpServerNames: ["time"],
    })

    expect(prompt).toContain("Repository workspace: not attached")
    expect(prompt).toContain(
      "Structured repository tools: unavailable because no repository is attached",
    )
    expect(prompt).toContain("Internal knowledge tool: docs_search available")
    expect(prompt).toContain("Workflow builder tools: get_workflow_node_catalog")
    expect(prompt).toContain("Remote MCP tools: available from configured MCP servers: time")
    expect(prompt).toContain(
      "Do not attempt repository paths such as /repo unless a repository is attached.",
    )
  })

  it("describes selected MCP Context Forge MCP servers with exposed tool names", () => {
    const firehydrant = MCPCF_SERVERS.find((server) => server.label === "FireHydrant")!
    const firehydrantName = getMcpcfMcpServerName(firehydrant)
    const prompt = buildIsolateSystemPrompt({
      runtimeModelId: "litellm/gpt-5.4-mini",
      providerId: "litellm",
      modelId: "gpt-5.4-mini",
      hasRepoWorkspace: false,
      hasDocs: false,
      hasWorkflowBuilder: false,
      mcpcfMcpServers: [
        {
          label: firehydrant.label,
          serverName: firehydrantName,
          description: firehydrant.description,
          toolNames: [
            "tool_mcpcf_firehydrant_list_incidents",
            "tool_mcpcf_firehydrant_get_incident",
          ],
        },
      ],
    })

    expect(prompt).toContain(
      "Remote MCP tools: available through the MCP Context Forge servers listed below",
    )
    expect(prompt).not.toContain("Remote MCP tools: unavailable")
    expect(prompt).toContain(
      "External network access: unavailable except through configured tools and remote MCP servers",
    )
    expect(prompt).toContain("MCP Context Forge servers:")
    expect(prompt).toContain(`FireHydrant (${firehydrantName})`)
    expect(prompt).toContain("tool_mcpcf_firehydrant_list_incidents")
    expect(prompt).toContain("Treat MCP Context Forge session metadata as selection metadata only")
  })

  it("builds isolate prompt facts when MCP Context Forge servers are selected", () => {
    const facts = buildIsolateSystemPromptFacts({
      tools: [
        { kind: "mcpcf_server", serverId: "server_grafana" },
        { kind: "ai_search", sourceId: "product-docs" },
        { kind: "workflow_builder" },
      ],
      customMcpServers: { time: timeMcpServer },
    })

    expect(facts.hasDocs).toBe(true)
    expect(facts.hasWorkflowBuilder).toBe(true)
    expect(facts.hasRepoWorkspace).toBe(false)
    expect(facts.customMcpServerNames).toEqual(["time"])
  })
})
