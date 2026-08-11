import { describe, expect, it } from "vitest"
import {
  buildSessionToolRuntimePlan,
  type McpcfServerDefinition,
} from "../../packages/shared/src/session-tools"
import { getStageMetadataSync } from "../../packages/shared/src/stageMetadata"
import {
  buildSessionMcpServers,
  buildSessionMcpServersFromPlan,
  AI_SEARCH_SESSION_HEADER,
  AI_SEARCH_SOURCE_HEADER,
  INTERNAL_AI_SEARCH_MCP_SERVER_NAME,
  INTERNAL_MCPCF_MCP_SERVER_NAME,
  INTERNAL_WORKFLOW_BUILDER_MCP_SERVER_NAME,
  MCPCF_MCP_TIMEOUT_MS,
  MCPCF_SERVER_HEADER,
  WORKFLOW_BUILDER_SESSION_HEADER,
  getAiSearchMcpUrl,
  getMcpcfIsolateMcpUrl,
  getMcpcfMcpServerName,
  getMcpcfMcpUrl,
  getWorkflowBuilderMcpUrl,
} from "../../packages/api/src/server/background/session/mcp-config"
import { buildIsolateMcpServerRegistrationsFromPlan } from "../../packages/api/src/server/background/isolate/mcp"
import { compiledStageEnv } from "../fixtures/stage-metadata"

const PRE_STAGE_ENV = compiledStageEnv("pre")
const PROD_STAGE_ENV = compiledStageEnv("prod")

const MCPCF_SERVERS: McpcfServerDefinition[] = [
  {
    id: "server_grafana",
    slug: "grafana",
    label: "Grafana",
    description: "Grafana server",
    toolCount: 2,
  },
  {
    id: "server_atlassian",
    slug: "atlassian",
    label: "Atlassian",
    description: "Atlassian server",
    toolCount: 3,
  },
  {
    id: "server_firehydrant",
    slug: "firehydrant",
    label: "FireHydrant",
    description: "FireHydrant server",
    toolCount: 1,
  },
]

describe("session MCP config", () => {
  it("generates the internal AI Search MCP server from selected sources (production)", () => {
    const mcpServers = buildSessionMcpServers({
      tools: [
        {
          kind: "ai_search",
          sourceId: "product-docs",
        },
      ],
      sessionId: "session-123",
      stage: PROD_STAGE_ENV,
    })

    expect(mcpServers).toEqual({
      [INTERNAL_AI_SEARCH_MCP_SERVER_NAME]: {
        type: "remote",
        url: getAiSearchMcpUrl(PROD_STAGE_ENV),
        enabled: true,
        oauth: false,
        headers: {
          [AI_SEARCH_SOURCE_HEADER]: "product-docs",
          [AI_SEARCH_SESSION_HEADER]: "session-123",
        },
        timeout: 30_000,
      },
    })
  })

  it("uses Docker host URL with port for MCP in dev stage", () => {
    const mcpServers = buildSessionMcpServers({
      tools: [{ kind: "ai_search", sourceId: "product-docs" }],
      sessionId: "session-456",
      stage: "dev",
    })

    expect(mcpServers[INTERNAL_AI_SEARCH_MCP_SERVER_NAME]).toMatchObject({
      url: "http://host.docker.internal:1337/mcp",
    })
  })

  it("getAiSearchMcpUrl derives URL from stage metadata", () => {
    expect(getAiSearchMcpUrl("dev")).toBe("http://host.docker.internal:1337/mcp")
    expect(getAiSearchMcpUrl(PROD_STAGE_ENV)).toBe("http://s0-ai-search.internal/mcp")
    expect(getAiSearchMcpUrl(PRE_STAGE_ENV)).toBe("http://s0-ai-search.internal/mcp")
  })

  it("generates the internal workflow builder MCP server from the hidden builder tool", () => {
    const mcpServers = buildSessionMcpServers({
      tools: [{ kind: "workflow_builder" }],
      sessionId: "session-builder",
      stage: "dev",
    })

    expect(mcpServers).toEqual({
      [INTERNAL_WORKFLOW_BUILDER_MCP_SERVER_NAME]: {
        type: "remote",
        url: getWorkflowBuilderMcpUrl("dev"),
        enabled: true,
        oauth: false,
        headers: {
          [WORKFLOW_BUILDER_SESSION_HEADER]: "session-builder",
        },
        timeout: 30_000,
      },
    })
  })

  it("generates one internal MCP Context Forge server per selected registry server", () => {
    const grafana = MCPCF_SERVERS[0]
    const atlassian = MCPCF_SERVERS[1]
    const grafanaName = getMcpcfMcpServerName(grafana)
    const atlassianName = getMcpcfMcpServerName(atlassian)
    const mcpServers = buildSessionMcpServers({
      tools: [
        { kind: "mcpcf_server", serverId: atlassian.id },
        { kind: "mcpcf_server", serverId: grafana.id },
      ],
      mcpcfServers: MCPCF_SERVERS,
      sessionId: "session-mcpcf",
      mcpcfCapability: "session-capability",
      stage: PROD_STAGE_ENV,
    })

    expect(mcpServers).toEqual({
      [grafanaName]: {
        type: "remote",
        url: getMcpcfMcpUrl(PROD_STAGE_ENV),
        enabled: true,
        oauth: false,
        headers: {
          [MCPCF_SERVER_HEADER]: grafana.id,
          Authorization: "Bearer session-capability",
        },
        timeout: MCPCF_MCP_TIMEOUT_MS,
      },
      [atlassianName]: {
        type: "remote",
        url: getMcpcfMcpUrl(PROD_STAGE_ENV),
        enabled: true,
        oauth: false,
        headers: {
          [MCPCF_SERVER_HEADER]: atlassian.id,
          Authorization: "Bearer session-capability",
        },
        timeout: MCPCF_MCP_TIMEOUT_MS,
      },
    })
    expect(JSON.stringify(mcpServers)).not.toContain("session-mcpcf")
  })

  it("getMcpcfMcpUrl derives URL from stage metadata", () => {
    expect(getMcpcfMcpUrl("dev")).toBe("http://host.docker.internal:1337/integrations/mcpcf/mcp")
    expect(getMcpcfMcpUrl(PROD_STAGE_ENV)).toBe(
      "http://s0-ai-search.internal/integrations/mcpcf/mcp",
    )
    expect(getMcpcfMcpUrl(PRE_STAGE_ENV)).toBe(
      "http://s0-ai-search.internal/integrations/mcpcf/mcp",
    )
  })

  it("getMcpcfIsolateMcpUrl uses the worker route in local dev", () => {
    expect(getMcpcfIsolateMcpUrl("dev")).toBe("http://localhost:1337/integrations/mcpcf/mcp")
    expect(getMcpcfIsolateMcpUrl(PROD_STAGE_ENV)).toBe(
      "https://api.ai.example.org/integrations/mcpcf/mcp",
    )
    expect(getMcpcfIsolateMcpUrl(PRE_STAGE_ENV)).toBe(
      "https://api.ai-pre.example.org/integrations/mcpcf/mcp",
    )
  })

  it("getMcpcfIsolateMcpUrl uses env-aware stage metadata for deployed stages", () => {
    expect(
      getMcpcfIsolateMcpUrl({
        ...compiledStageEnv("pre-42"),
      }),
    ).toBe("https://api.ai-pre-42.example.org/integrations/mcpcf/mcp")
  })

  it("defines stage-specific internal MCP container outbound behavior", () => {
    expect(getStageMetadataSync("dev").infra.internalMcpOutboundHost).toBeNull()
    expect(getStageMetadataSync("dev").infra.internalMcpWorkerRouteEnabled).toBe(true)

    expect(getStageMetadataSync(PRE_STAGE_ENV).infra.internalMcpOutboundHost).toBe(
      "s0-ai-search.internal",
    )
    expect(getStageMetadataSync(PRE_STAGE_ENV).infra.internalMcpWorkerRouteEnabled).toBe(false)

    expect(getStageMetadataSync(PROD_STAGE_ENV).infra.internalMcpOutboundHost).toBe(
      "s0-ai-search.internal",
    )
    expect(getStageMetadataSync(PROD_STAGE_ENV).infra.internalMcpWorkerRouteEnabled).toBe(false)
  })

  it("merges generated AI Search MCP config with custom MCP servers", () => {
    const mcpServers = buildSessionMcpServers({
      tools: [
        {
          kind: "ai_search",
          sourceId: "product-docs",
        },
      ],
      customMcpServers: {
        customDocs: {
          type: "remote",
          url: "https://example.com/mcp",
        },
      },
    })

    expect(mcpServers.customDocs).toEqual({
      type: "remote",
      url: "https://example.com/mcp",
    })
    expect(mcpServers[INTERNAL_AI_SEARCH_MCP_SERVER_NAME]).toBeDefined()
  })

  it("rejects custom MCP servers that collide with the reserved internal name", () => {
    expect(() =>
      buildSessionMcpServers({
        tools: [],
        customMcpServers: {
          [INTERNAL_AI_SEARCH_MCP_SERVER_NAME]: {
            type: "remote",
            url: "https://example.com/mcp",
          },
        },
      }),
    ).toThrow("reserved for internal s0 tools")
  })

  it("rejects custom MCP servers that collide with the workflow builder name", () => {
    expect(() =>
      buildSessionMcpServers({
        tools: [],
        customMcpServers: {
          [INTERNAL_WORKFLOW_BUILDER_MCP_SERVER_NAME]: {
            type: "remote",
            url: "https://example.com/mcp",
          },
        },
      }),
    ).toThrow("reserved for internal s0 tools")
  })

  it("rejects custom MCP servers that collide with the MCP Context Forge name", () => {
    expect(() =>
      buildSessionMcpServers({
        tools: [],
        customMcpServers: {
          [INTERNAL_MCPCF_MCP_SERVER_NAME]: {
            type: "remote",
            url: "https://example.com/mcp",
          },
        },
      }),
    ).toThrow("reserved for internal s0 tools")
  })

  it("rejects custom MCP servers that collide with MCP Context Forge virtual server names", () => {
    const firehydrant = MCPCF_SERVERS[2]
    expect(() =>
      buildSessionMcpServers({
        tools: [{ kind: "mcpcf_server", serverId: firehydrant.id }],
        mcpcfServers: MCPCF_SERVERS,
        customMcpServers: {
          [getMcpcfMcpServerName(firehydrant)]: {
            type: "remote",
            url: "https://example.com/mcp",
          },
        },
      }),
    ).toThrow("reserved for internal s0 tools")
  })

  it("rejects custom MCP servers that collide with unselected MCP Context Forge virtual names", () => {
    const grafana = MCPCF_SERVERS[0]
    expect(() =>
      buildSessionMcpServers({
        tools: [],
        mcpcfServers: MCPCF_SERVERS,
        customMcpServers: {
          [getMcpcfMcpServerName(grafana)]: {
            type: "remote",
            url: "https://example.com/mcp",
          },
        },
      }),
    ).toThrow("reserved for internal s0 tools")
  })

  it("renders sandbox and isolate MCP adapters from the same runtime plan", () => {
    const grafana = MCPCF_SERVERS[0]
    const plan = buildSessionToolRuntimePlan({
      tools: [
        { kind: "ai_search", sourceId: "product-docs" },
        { kind: "workflow_builder" },
        { kind: "mcpcf_server", serverId: grafana.id },
      ],
      customMcpServers: {
        time: {
          type: "remote",
          url: "https://a.currenttimeutc.com/mcp",
          enabled: true,
        },
      },
      mcpcfServers: MCPCF_SERVERS,
    })

    const sandboxMcpServers = buildSessionMcpServersFromPlan({
      plan,
      sessionId: "session-plan",
      mcpcfCapability: "plan-capability",
      stage: "dev",
    })
    const isolateRegistrations = buildIsolateMcpServerRegistrationsFromPlan({
      plan,
      sessionId: "session-plan",
      stage: "dev",
      mcpcfCapability: "plan-capability",
    })

    expect(sandboxMcpServers[INTERNAL_AI_SEARCH_MCP_SERVER_NAME]).toMatchObject({
      headers: {
        [AI_SEARCH_SOURCE_HEADER]: "product-docs",
        [AI_SEARCH_SESSION_HEADER]: "session-plan",
      },
    })
    expect(sandboxMcpServers[INTERNAL_WORKFLOW_BUILDER_MCP_SERVER_NAME]).toMatchObject({
      headers: {
        [WORKFLOW_BUILDER_SESSION_HEADER]: "session-plan",
      },
    })
    expect(sandboxMcpServers[getMcpcfMcpServerName(grafana)]).toMatchObject({
      headers: {
        [MCPCF_SERVER_HEADER]: grafana.id,
        Authorization: "Bearer plan-capability",
      },
    })
    expect(sandboxMcpServers.time).toMatchObject({
      type: "remote",
      url: "https://a.currenttimeutc.com/mcp",
    })
    expect(isolateRegistrations.map((registration) => registration.name).sort()).toEqual([
      "mcpcf_grafana",
      "time",
    ])
    expect(isolateRegistrations.find((registration) => registration.name === "time")).toMatchObject(
      {
        id: "custom_time__24b0t",
        optional: true,
        options: {
          url: "https://a.currenttimeutc.com/mcp",
        },
      },
    )
    expect(
      isolateRegistrations.find((registration) => registration.name === "mcpcf_grafana"),
    ).toMatchObject({
      server: {
        headers: {
          [MCPCF_SERVER_HEADER]: grafana.id,
          Authorization: "Bearer plan-capability",
        },
      },
      options: {
        url: getMcpcfIsolateMcpUrl("dev"),
      },
    })
  })
})
