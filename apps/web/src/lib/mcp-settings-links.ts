export interface McpSettingsSearch {
  category: "agents"
  tab: "mcps"
  mcpQuery: string
  mcpServerLabel: string
}

export interface ContextForgeTokenSettingsSearch {
  category: "api-access"
}

export type McpTokenSettingsTarget =
  | { type: "server"; serverLabel: string }
  | { type: "contextforge" }

const MCP_UPSTREAM_TOKEN_SETTINGS_ERROR_PATTERN =
  /^Configure your token for (.+?) in MCP settings\.$/
const CONTEXTFORGE_TOKEN_SETTINGS_ERROR_PATTERN =
  /^Configure your ContextForge API token in Accounts\.$/

export function getMcpTokenSettingsTarget(error: string): McpTokenSettingsTarget | null {
  const normalizedError = error.trim()
  const upstreamMatch = MCP_UPSTREAM_TOKEN_SETTINGS_ERROR_PATTERN.exec(normalizedError)
  const serverLabel = upstreamMatch?.[1]?.trim()
  if (serverLabel) {
    return { type: "server", serverLabel }
  }

  if (CONTEXTFORGE_TOKEN_SETTINGS_ERROR_PATTERN.test(normalizedError)) {
    return { type: "contextforge" }
  }

  return null
}

export function getMcpTokenSettingsServerLabel(error: string): string | null {
  const target = getMcpTokenSettingsTarget(error)
  return target?.type === "server" ? target.serverLabel : null
}

export function buildMcpSettingsSearchForServer(serverLabel: string): McpSettingsSearch {
  const normalizedServerLabel = serverLabel.trim()
  return {
    category: "agents",
    tab: "mcps",
    mcpQuery: normalizedServerLabel,
    mcpServerLabel: normalizedServerLabel,
  }
}

export function buildContextForgeTokenSettingsSearch(): ContextForgeTokenSettingsSearch {
  return { category: "api-access" }
}
