import { describe, expect, it } from "vitest"
import { normalizeOpenCodeMcpServers } from "../../packages/shared/src/provider-config"
import {
  applyStoredSessionToolAvailability,
  appendSessionToolsToSearchParams,
  buildSessionToolRuntimePlan,
  getCustomMcpServerId,
  getMcpcfProxyServerAlias,
  getMcpcfProxyToolName,
  getSelectedMcpcfServerIds,
  getDefaultSessionCustomMcpServers,
  isCustomMcpServerId,
  parseCustomMcpServerId,
  parseCustomMcpToolKey,
  parseMcpcfProxyToolName,
  parseSessionToolsFromSearchParams,
  resolveStoredSessionTools,
  resolveSessionTools,
  summarizeSessionTools,
} from "../../packages/shared/src/session-tools"

const MCPCF_SERVERS = [
  {
    id: "server_grafana",
    slug: "grafana",
    label: "Grafana",
    description: "Grafana server",
    toolCount: 2,
  },
] as const

describe("session tool contract", () => {
  it("loads supported tools when stored sessions contain retired tool kinds", () => {
    expect(
      resolveStoredSessionTools(
        JSON.stringify([
          {
            kind: "ai_search",
            sourceId: "product-docs",
          },
          {
            kind: "retired_tool",
            configuration: {
              secret: "must-not-be-returned",
            },
          },
        ]),
      ),
    ).toEqual({
      tools: [
        {
          kind: "ai_search",
          sourceId: "product-docs",
        },
      ],
      unavailableTools: [
        {
          kind: "retired_tool",
          reason: "unknown_kind",
        },
      ],
    })
  })

  it("isolates malformed stored tool configuration from valid siblings", () => {
    expect(
      resolveStoredSessionTools(
        JSON.stringify([
          {
            kind: "ai_search",
            sourceId: 42,
          },
          {
            kind: "workflow_builder",
          },
        ]),
      ),
    ).toEqual({
      tools: [{ kind: "workflow_builder" }],
      unavailableTools: [
        {
          kind: "ai_search",
          reason: "invalid_config",
        },
      ],
    })
  })

  it("reports invalid stored tool payloads without throwing", () => {
    expect(resolveStoredSessionTools("not-json")).toEqual({
      tools: [],
      unavailableTools: [
        {
          kind: null,
          reason: "invalid_storage",
        },
      ],
    })
  })

  it("separates unavailable registered tools from executable session tools", () => {
    expect(
      applyStoredSessionToolAvailability(
        {
          tools: [
            {
              kind: "ai_search",
              sourceId: "product-docs",
            },
            {
              kind: "workflow_builder",
            },
          ],
          unavailableTools: [],
        },
        [
          {
            kind: "ai_search",
            toolId: "product-docs",
            reason: "disabled",
          },
        ],
      ),
    ).toEqual({
      tools: [{ kind: "workflow_builder" }],
      unavailableTools: [
        {
          kind: "ai_search",
          toolId: "product-docs",
          reason: "disabled",
        },
      ],
    })
  })

  it("round-trips repeated tool query params", () => {
    const params = appendSessionToolsToSearchParams(new URLSearchParams(), [
      {
        kind: "github_repo",
        repoOwner: "example-org",
        repoName: "AI",
      },
      {
        kind: "ai_search",
        sourceId: "product-docs",
      },
      {
        kind: "workflow_builder",
      },
      {
        kind: "mcpcf_server",
        serverId: "server_grafana",
      },
    ])

    expect(parseSessionToolsFromSearchParams(params)).toEqual([
      {
        kind: "github_repo",
        repoOwner: "example-org",
        repoName: "ai",
      },
      {
        kind: "ai_search",
        sourceId: "product-docs",
      },
      {
        kind: "mcpcf_server",
        serverId: "server_grafana",
      },
      {
        kind: "workflow_builder",
      },
    ])
  })

  it("merges legacy repo fields with canonical tools", () => {
    expect(
      resolveSessionTools({
        tools: [
          {
            kind: "ai_search",
            sourceId: "product-docs",
          },
        ],
        repoOwner: "example-org",
        repoName: "AI",
      }),
    ).toEqual([
      {
        kind: "github_repo",
        repoOwner: "example-org",
        repoName: "ai",
      },
      {
        kind: "ai_search",
        sourceId: "product-docs",
      },
    ])
  })

  it("rejects multiple GitHub repos in one session", () => {
    expect(() =>
      resolveSessionTools({
        tools: [
          {
            kind: "github_repo",
            repoOwner: "example-org",
            repoName: "ai",
          },
        ],
        queryTools: [
          {
            kind: "github_repo",
            repoOwner: "example-org",
            repoName: "other-repo",
          },
        ],
      }),
    ).toThrow("Only one GitHub repo can be attached to an agent")
  })

  it("accepts dynamic MCP Context Forge server ids and rejects legacy kinds", () => {
    expect(
      resolveSessionTools({
        tools: [
          {
            kind: "mcpcf_server",
            serverId: "server_grafana",
          },
        ],
      }),
    ).toEqual([{ kind: "mcpcf_server", serverId: "server_grafana" }])

    expect(() =>
      resolveSessionTools({
        tools: [
          {
            kind: "context_forge_server",
            serverId: "server_grafana",
          } as never,
        ],
      }),
    ).toThrow("Unknown session tool kind")
  })

  it("summarizes selected MCP Context Forge servers by provided label or count", () => {
    expect(
      summarizeSessionTools(
        [
          {
            kind: "mcpcf_server",
            serverId: "server_grafana",
          },
        ],
        { mcpcfServerLabels: { server_grafana: "Grafana" } },
      ),
    ).toBe("Grafana")

    expect(
      summarizeSessionTools([
        {
          kind: "mcpcf_server",
          serverId: "server_grafana",
        },
        {
          kind: "mcpcf_server",
          serverId: "server_atlassian",
        },
      ]),
    ).toBe("2 MCP Context Forge servers")
  })

  it("normalizes OpenCode-shaped custom MCP configs", () => {
    expect(
      normalizeOpenCodeMcpServers({
        " docs-mcp ": {
          type: "remote",
          url: " https://example.com/mcp ",
          enabled: true,
        },
        localTooling: {
          type: "local",
          command: [" node ", " ./server.js "],
        },
      }),
    ).toEqual({
      "docs-mcp": {
        type: "remote",
        url: "https://example.com/mcp",
        enabled: true,
      },
      localTooling: {
        type: "local",
        command: ["node", "./server.js"],
      },
    })
  })

  it("provides the time MCP as the default custom MCP example", () => {
    expect(getDefaultSessionCustomMcpServers()).toEqual({
      time: {
        type: "remote",
        url: "https://a.currenttimeutc.com/mcp",
        enabled: true,
      },
    })
  })

  it("uses a parseable custom MCP server id format", () => {
    expect(getCustomMcpServerId("qa")).toBe("custom_qa__2s0")
    expect(isCustomMcpServerId("custom_qa__2s0")).toBe(true)
    expect(isCustomMcpServerId("github_repo")).toBe(false)
    expect(parseCustomMcpServerId("custom_qa__2s0")).toEqual({
      serverName: "qa",
      hash: "2s0",
    })
    expect(parseCustomMcpToolKey("tool_custom_qa__2s0_check_status")).toEqual({
      serverName: "qa",
      mcpToolName: "check_status",
    })
    expect(parseCustomMcpToolKey("tool_custom_foo_2024__66jqvt_get_utc_time")).toEqual({
      serverName: "foo_2024",
      mcpToolName: "get_utc_time",
    })
  })

  it("rejects malformed custom MCP server ids", () => {
    expect(parseCustomMcpServerId("custom_a")).toBeNull()
    expect(parseCustomMcpServerId("custom___2s0")).toBeNull()
    expect(parseCustomMcpServerId("custom_qa__")).toBeNull()
  })

  it("normalizes long runs of custom MCP server name separators", () => {
    const repeatedSeparators = "_".repeat(10_000)
    const id = getCustomMcpServerId(`${repeatedSeparators}QA${repeatedSeparators}`)

    expect(parseCustomMcpServerId(id)?.serverName).toBe("qa")
  })

  it("uses parseable MCP Context Forge proxy tool names", () => {
    const serverAlias = getMcpcfProxyServerAlias("server_grafana")
    expect(serverAlias).toMatch(/^s[a-z0-9]{7}$/)
    expect(getMcpcfProxyToolName("server_grafana", "query_datasource")).toBe(
      `mcpcf_${serverAlias}__query_datasource`,
    )
    expect(parseMcpcfProxyToolName(`mcpcf_${serverAlias}__query_datasource`)).toEqual({
      serverAlias,
      upstreamToolName: "query_datasource",
    })
    expect(parseMcpcfProxyToolName("cf_grafana__query_datasource")).toBeNull()
    expect(parseMcpcfProxyToolName("mcpcf_grafana__query_datasource")).toBeNull()
    expect(parseMcpcfProxyToolName("mcpcf_bad-slug__query_datasource")).toBeNull()
  })

  it("returns selected MCP Context Forge server ids in canonical order", () => {
    expect(
      getSelectedMcpcfServerIds([
        { kind: "mcpcf_server", serverId: "server_z" },
        { kind: "workflow_builder" },
        { kind: "mcpcf_server", serverId: "server_a" },
        { kind: "mcpcf_server", serverId: "server_z" },
      ]),
    ).toEqual(["server_a", "server_z"])
  })

  it("builds one runtime plan shared by adapter-specific views", () => {
    const plan = buildSessionToolRuntimePlan({
      tools: [
        { kind: "workflow_builder" },
        { kind: "mcpcf_server", serverId: "server_grafana" },
        { kind: "ai_search", sourceId: "product-docs" },
        { kind: "github_repo", repoOwner: "example-org", repoName: "AI" },
      ],
      customMcpServers: {
        time: {
          type: "remote",
          url: "https://a.currenttimeutc.com/mcp",
          enabled: true,
        },
        disabled: {
          type: "remote",
          url: "https://example.com/mcp",
          enabled: false,
        },
        local: {
          type: "local",
          command: ["node", "server.js"],
        },
      },
      mcpcfServers: MCPCF_SERVERS,
    })

    expect(plan.selectedTools).toEqual([
      { kind: "github_repo", repoOwner: "example-org", repoName: "ai" },
      { kind: "ai_search", sourceId: "product-docs" },
      { kind: "mcpcf_server", serverId: "server_grafana" },
      { kind: "workflow_builder" },
    ])
    expect(plan.sandboxMcp.aiSearchSourceIds).toEqual(["product-docs"])
    expect(plan.sandboxMcp.workflowBuilderEnabled).toBe(true)
    expect(plan.sandboxMcp.mcpcfServers.map((server) => server.id)).toEqual(["server_grafana"])
    expect(plan.isolateAiSdkTools.repoTool).toEqual({
      kind: "github_repo",
      repoOwner: "example-org",
      repoName: "ai",
    })
    expect(plan.isolateAiSdkTools.aiSearchTools.map((tool) => tool.sourceId)).toEqual(
      plan.sandboxMcp.aiSearchSourceIds,
    )
    expect(plan.isolatePromptFacts).toMatchObject({
      hasRepoWorkspace: true,
      hasAiSearch: true,
      hasDocs: true,
      hasWorkflowBuilder: true,
      customMcpServerNames: ["time"],
    })
    expect(plan.mcpRegistration.remoteCustomMcpServers).toEqual([
      {
        id: "custom_time__24b0t",
        name: "time",
        server: {
          type: "remote",
          url: "https://a.currenttimeutc.com/mcp",
          enabled: true,
        },
        optional: true,
      },
    ])
    expect(plan.mcpRegistration.mcpcfServers).toEqual(plan.sandboxMcp.mcpcfServers)
  })
})
