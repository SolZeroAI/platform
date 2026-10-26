import {
  normalizeAiSearchSourceId,
  normalizeMcpcfServerId,
  getInternalMcpOrigin,
  getInfraServerUrl,
  normalizeOpenCodeMcpServers,
  type McpcfServerDefinition,
  type OpenCodeMcpServers,
  type StageMetadataInput,
  type SessionToolRuntimePlan,
} from "@solzero/shared"

export const INTERNAL_AI_SEARCH_MCP_SERVER_NAME = "ai_search"
export const INTERNAL_AI_SEARCH_MCP_ROUTE = "/mcp"
export const INTERNAL_WORKFLOW_BUILDER_MCP_SERVER_NAME = "workflow_builder"
export const INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE = "/mcp/workflows"
export const INTERNAL_MCPCF_MCP_SERVER_NAME = "mcpcf"
export const MCPCF_PROXY_MCP_ROUTE = "/integrations/mcpcf/mcp"
export const AI_SEARCH_SOURCE_HEADER = "x-s0-ai-search-sources"
export const AI_SEARCH_SESSION_HEADER = "x-s0-session-id"
export const WORKFLOW_BUILDER_SESSION_HEADER = AI_SEARCH_SESSION_HEADER
export const MCPCF_SERVER_HEADER = "x-s0-mcpcf-servers"
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
      `Custom MCP server name '${collidingServerName}' is reserved for internal s0 tools`,
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
  const servers: Record<string, OpenCodeMcpServers[string]> = {}
  Object.assign(servers, plan.sandboxMcp.customMcpServers)

  if (selectedAiSearchSourceIds.length > 0) {
    let headers: Record<string, string> = {}
    headers[AI_SEARCH_SOURCE_HEADER] = selectedAiSearchSourceIds.join(",")

    if (input.sessionId) headers[AI_SEARCH_SESSION_HEADER] = input.sessionId
    servers[INTERNAL_AI_SEARCH_MCP_SERVER_NAME] = {
      type: "remote",
      url: getAiSearchMcpUrl(stage),
      enabled: true,
      oauth: false,
      headers,
      timeout: 30_000,
    }
  }

  if (workflowBuilderEnabled) {
    let headers: Record<string, string> = {}

    if (input.sessionId) headers[WORKFLOW_BUILDER_SESSION_HEADER] = input.sessionId
    servers[INTERNAL_WORKFLOW_BUILDER_MCP_SERVER_NAME] = {
      type: "remote",
      url: getWorkflowBuilderMcpUrl(stage),
      enabled: true,
      oauth: false,
      headers,
      timeout: 30_000,
    }
  }

  if (selectedMcpcfServers.length > 0) {
    for (const server of selectedMcpcfServers) {
      let headers: Record<string, string> = {}
      headers[MCPCF_SERVER_HEADER] = server.id

      if (input.mcpcfCapability) headers.Authorization = `Bearer ${input.mcpcfCapability}`
      servers[getMcpcfMcpServerName(server)] = {
        type: "remote",
        url: getMcpcfMcpUrl(stage),
        enabled: true,
        oauth: false,
        headers,
        timeout: MCPCF_MCP_TIMEOUT_MS,
      }
    }
  }

  return normalizeOpenCodeMcpServers(servers)
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
