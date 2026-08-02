import {
  buildSessionToolRuntimePlan,
  normalizeAiSearchSourceId,
  normalizeMcpcfServerId,
  getInternalMcpOrigin,
  getInfraServerUrl,
  normalizeOpenCodeMcpServers,
  type McpcfServerDefinition,
  type OpenCodeMcpServers,
  type StageMetadataInput,
  type SessionToolRuntimePlan,
  type SessionToolSpec,
} from "@c0-agent/shared"

export const INTERNAL_AI_SEARCH_MCP_SERVER_NAME = "ai_search"
export const INTERNAL_AI_SEARCH_MCP_ROUTE = "/mcp"
export const INTERNAL_WORKFLOW_BUILDER_MCP_SERVER_NAME = "workflow_builder"
export const INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE = "/mcp/workflows"
export const INTERNAL_MCPCF_MCP_SERVER_NAME = "mcpcf"
export const MCPCF_PROXY_MCP_ROUTE = "/integrations/mcpcf/mcp"
export const AI_SEARCH_SOURCE_HEADER = "x-c0-ai-search-sources"
export const AI_SEARCH_SESSION_HEADER = "x-c0-session-id"
export const WORKFLOW_BUILDER_SESSION_HEADER = AI_SEARCH_SESSION_HEADER
export const MCPCF_SERVER_HEADER = "x-c0-mcpcf-servers"
export const MCPCF_MCP_TIMEOUT_MS = 120_000

export function getMcpcfMcpServerName(server: Pick<McpcfServerDefinition, "slug">): string {
  return `${INTERNAL_MCPCF_MCP_SERVER_NAME}_${server.slug}`
}

export function getAiSearchMcpUrl(stage: StageMetadataInput): string {
  return `${getInternalMcpOrigin(stage)}${INTERNAL_AI_SEARCH_MCP_ROUTE}`
}

export function getWorkflowBuilderMcpUrl(stage: StageMetadataInput): string {
  return `${getInternalMcpOrigin(stage)}${INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE}`
}

export function getMcpcfMcpUrl(stage: StageMetadataInput): string {
  return `${getInternalMcpOrigin(stage)}${MCPCF_PROXY_MCP_ROUTE}`
}

export function getMcpcfIsolateMcpUrl(stage: StageMetadataInput): string {
  return `${getInfraServerUrl(stage)}${MCPCF_PROXY_MCP_ROUTE}`
}

export function buildSessionMcpServers(input: {
  tools: readonly SessionToolSpec[] | null | undefined
  customMcpServers?: OpenCodeMcpServers | null
  mcpcfServers?: readonly McpcfServerDefinition[] | null
  sessionId?: string | null
  mcpcfCapability?: string | null
  stage?: StageMetadataInput | null
}): OpenCodeMcpServers {
  const plan = buildSessionToolRuntimePlan({
    tools: input.tools,
    customMcpServers: input.customMcpServers,
    mcpcfServers: input.mcpcfServers,
  })

  return buildSessionMcpServersFromPlan({
    plan,
    sessionId: input.sessionId,
    mcpcfCapability: input.mcpcfCapability,
    stage: input.stage,
  })
}

export function buildSessionMcpServersFromPlan(input: {
  plan: SessionToolRuntimePlan
  sessionId?: string | null
  mcpcfCapability?: string | null
  stage?: StageMetadataInput | null
}): OpenCodeMcpServers {
  const { plan } = input
  const reservedInternalServerNames = [
    INTERNAL_AI_SEARCH_MCP_SERVER_NAME,
    INTERNAL_WORKFLOW_BUILDER_MCP_SERVER_NAME,
    INTERNAL_MCPCF_MCP_SERVER_NAME,
    ...plan.sandboxMcp.reservedMcpcfServers.map((server) => getMcpcfMcpServerName(server)),
  ]
  const collidingServerName = reservedInternalServerNames.find(
    (name) => name in plan.sandboxMcp.customMcpServers,
  )
  if (collidingServerName) {
    throw new Error(
      `Custom MCP server name '${collidingServerName}' is reserved for internal c0 tools`,
    )
  }

  const selectedAiSearchSourceIds = plan.sandboxMcp.aiSearchSourceIds
  const selectedMcpcfServers = plan.sandboxMcp.mcpcfServers
  const { workflowBuilderEnabled } = plan.sandboxMcp

  if (
    selectedAiSearchSourceIds.length === 0 &&
    selectedMcpcfServers.length === 0 &&
    !workflowBuilderEnabled
  ) {
    return plan.sandboxMcp.customMcpServers
  }

  const stage = input.stage ?? "dev"

  return normalizeOpenCodeMcpServers({
    ...plan.sandboxMcp.customMcpServers,
    ...(selectedAiSearchSourceIds.length > 0
      ? {
          [INTERNAL_AI_SEARCH_MCP_SERVER_NAME]: {
            type: "remote" as const,
            url: getAiSearchMcpUrl(stage),
            enabled: true,
            oauth: false,
            headers: {
              [AI_SEARCH_SOURCE_HEADER]: selectedAiSearchSourceIds.join(","),
              ...(input.sessionId ? { [AI_SEARCH_SESSION_HEADER]: input.sessionId } : {}),
            },
            timeout: 30_000,
          },
        }
      : {}),
    ...(workflowBuilderEnabled
      ? {
          [INTERNAL_WORKFLOW_BUILDER_MCP_SERVER_NAME]: {
            type: "remote" as const,
            url: getWorkflowBuilderMcpUrl(stage),
            enabled: true,
            oauth: false,
            headers: input.sessionId
              ? {
                  [WORKFLOW_BUILDER_SESSION_HEADER]: input.sessionId,
                }
              : {},
            timeout: 30_000,
          },
        }
      : {}),
    ...(selectedMcpcfServers.length > 0
      ? Object.fromEntries(
          selectedMcpcfServers.map((server) => [
            getMcpcfMcpServerName(server),
            {
              type: "remote" as const,
              url: getMcpcfMcpUrl(stage),
              enabled: true,
              oauth: false,
              headers: {
                [MCPCF_SERVER_HEADER]: server.id,
                ...(input.mcpcfCapability
                  ? { Authorization: `Bearer ${input.mcpcfCapability}` }
                  : {}),
              },
              timeout: MCPCF_MCP_TIMEOUT_MS,
            },
          ]),
        )
      : {}),
  })
}

export function parseAllowedAiSearchSources(request: Request): string[] {
  const rawValue = request.headers.get(AI_SEARCH_SOURCE_HEADER)?.trim()
  if (!rawValue) {
    return []
  }

  const sourceIds = rawValue
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)

  return [...new Set(sourceIds.map(normalizeAiSearchSourceId))].sort((left, right) =>
    left.localeCompare(right),
  )
}

export function parseAllowedMcpcfServers(request: Request): string[] {
  const rawValue = request.headers.get(MCPCF_SERVER_HEADER)?.trim()
  if (!rawValue) {
    return []
  }

  return [
    ...new Set(
      rawValue
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map(normalizeMcpcfServerId),
    ),
  ].sort((left, right) => left.localeCompare(right))
}
