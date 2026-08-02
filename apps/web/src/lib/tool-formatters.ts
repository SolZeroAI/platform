import { parseMcpcfProxyToolName, parseCustomMcpToolKey, type SandboxEvent } from "@c0-agent/shared"
export type { SandboxEvent } from "@c0-agent/shared"

function basename(filePath: string | undefined): string {
  if (!filePath) return "unknown"
  const parts = filePath.split("/")
  return parts[parts.length - 1] || filePath
}

function truncate(str: string | undefined, maxLen: number): string {
  if (!str) return ""
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + "..."
}

function countLines(str: string | undefined): number {
  if (!str) return 0
  return str.split("\n").length
}

function formatToolWords(value: string, casing: "title" | "sentence"): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => {
      const upper = word.toUpperCase()
      if (
        upper === "UTC" ||
        upper === "URL" ||
        upper === "MCP" ||
        (casing === "title" && upper === "QA")
      ) {
        return upper
      }
      if (casing === "title") {
        return `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`
      }
      return word.toLowerCase()
    })
    .join(" ")
}

const TOOL_KEY_PREFIX = "tool_"
const MCPCF_SERVER_PREFIX = "mcpcf_"
const MCPCF_PROXY_SEPARATOR = "__"

function stripToolKeyPrefix(toolKey: string): string {
  return toolKey.startsWith(TOOL_KEY_PREFIX) ? toolKey.slice(TOOL_KEY_PREFIX.length) : toolKey
}

function formatMcpServerLabel(serverKey: string): string {
  const normalized = serverKey.replace(/_mcp$/i, "")
  return `${formatToolWords(normalized, "title")} MCP`
}

function tokenizeIdentifier(value: string): string[] {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase())
}

function stripLongestSharedTokenPrefix(serverKey: string, toolTokens: string[]): string[] {
  const serverTokenSets = [serverKey, serverKey.replace(/_mcp$/i, "")]
    .map(tokenizeIdentifier)
    .filter((tokens) => tokens.length > 0)

  let bestSlice = toolTokens
  for (const serverTokens of serverTokenSets) {
    let sharedLength = 0
    while (
      sharedLength < serverTokens.length &&
      sharedLength < toolTokens.length &&
      toolTokens[sharedLength]!.toLowerCase() === serverTokens[sharedLength]
    ) {
      sharedLength += 1
    }

    if (sharedLength > 0 && toolTokens.length > sharedLength) {
      const candidate = toolTokens.slice(sharedLength)
      if (candidate.length < bestSlice.length) {
        bestSlice = candidate
      }
    }
  }

  return bestSlice
}

function stripRepeatedPrimaryVendorToken(serverKey: string, toolTokens: string[]): string[] {
  const primaryToken = tokenizeIdentifier(serverKey)[0]
  if (primaryToken && toolTokens.length > 1 && toolTokens[0]!.toLowerCase() === primaryToken) {
    return toolTokens.slice(1)
  }

  return toolTokens
}

function stripSharedMcpServerPrefix(serverKey: string, upstreamToolName: string): string {
  const toolTokens = upstreamToolName.split(/[-_\s]+/).filter(Boolean)
  if (toolTokens.length === 0) {
    return upstreamToolName
  }

  const trimmedTokens = stripRepeatedPrimaryVendorToken(
    serverKey,
    stripLongestSharedTokenPrefix(serverKey, toolTokens),
  )

  if (trimmedTokens.length === toolTokens.length) {
    return upstreamToolName
  }

  return trimmedTokens.join("_")
}

function formatMcpToolLabel(serverKey: string | null, upstreamToolName: string): string {
  const trimmedToolName = serverKey
    ? stripSharedMcpServerPrefix(serverKey, upstreamToolName)
    : upstreamToolName
  return formatToolWords(trimmedToolName, "sentence")
}

export function getToolMcpServerRegistrationNames(tool: string): string[] {
  const names = new Set<string>()
  const body = stripToolKeyPrefix(tool)

  const customMcpTool = parseCustomMcpToolKey(tool)
  if (customMcpTool?.serverName) {
    names.add(customMcpTool.serverName)
  }

  if (!body.startsWith(MCPCF_SERVER_PREFIX)) {
    return [...names]
  }

  const wrappedIndex = body.indexOf("_mcpcf_", MCPCF_SERVER_PREFIX.length)
  if (wrappedIndex > 0) {
    names.add(body.slice(0, wrappedIndex))
  }

  const separatorIndex = body.indexOf(MCPCF_PROXY_SEPARATOR)
  if (separatorIndex > 0) {
    names.add(body.slice(0, separatorIndex))
  }

  const hyphenatedUpstreamIndex = body.search(/_[a-z0-9]+-[a-z0-9]/)
  if (hyphenatedUpstreamIndex > 0) {
    names.add(body.slice(0, hyphenatedUpstreamIndex))
  }

  const simpleMatch = body.match(/^(mcpcf_[^_]+)_/)
  if (simpleMatch?.[1]) {
    names.add(simpleMatch[1])
  }

  return [...names]
}

export function toolMatchesMcpDiscoveryServer(tool: string, serverName: string): boolean {
  const normalizedServer = serverName.trim().toLowerCase()
  if (!normalizedServer) {
    return false
  }

  return getToolMcpServerRegistrationNames(tool).some(
    (name) => name.toLowerCase() === normalizedServer,
  )
}

function parseMcpcfRelaxedProxyToolName(value: string): {
  serverKey: string
  upstreamToolName: string
} | null {
  if (!value.startsWith(MCPCF_SERVER_PREFIX)) {
    return null
  }

  const separatorIndex = value.indexOf(MCPCF_PROXY_SEPARATOR)
  if (separatorIndex <= MCPCF_SERVER_PREFIX.length) {
    return null
  }

  const serverKey = value.slice(MCPCF_SERVER_PREFIX.length, separatorIndex)
  const upstreamToolName = value.slice(separatorIndex + MCPCF_PROXY_SEPARATOR.length)
  if (
    !serverKey ||
    !upstreamToolName ||
    parseMcpcfProxyToolName(value) ||
    serverKey.includes("_mcpcf_")
  ) {
    return null
  }

  return { serverKey, upstreamToolName }
}

function parseMcpcfUnderscoreIsolateToolKey(body: string): {
  serverKey: string
  upstreamToolName: string
} | null {
  if (!body.startsWith(MCPCF_SERVER_PREFIX) || body.includes(MCPCF_PROXY_SEPARATOR)) {
    return null
  }

  const hyphenatedUpstreamIndex = body.search(/_[a-z0-9]+-[a-z0-9]/)
  if (hyphenatedUpstreamIndex > 0) {
    const serverRegistration = body.slice(0, hyphenatedUpstreamIndex)
    const upstreamToolName = body.slice(hyphenatedUpstreamIndex + 1)
    if (
      serverRegistration.startsWith(MCPCF_SERVER_PREFIX) &&
      upstreamToolName &&
      !serverRegistration.includes("_mcpcf_", MCPCF_SERVER_PREFIX.length)
    ) {
      return {
        serverKey: serverRegistration.slice(MCPCF_SERVER_PREFIX.length),
        upstreamToolName,
      }
    }
  }

  const simpleMatch = body.match(/^mcpcf_([^_]+)_(.+)$/)
  if (!simpleMatch) {
    return null
  }

  return {
    serverKey: simpleMatch[1],
    upstreamToolName: simpleMatch[2],
  }
}

function parseMcpcfToolKey(toolName: string): {
  serverKey: string
  upstreamToolName: string
  serverLabel: string
} | null {
  const candidates = new Set<string>([toolName, stripToolKeyPrefix(toolName)])
  for (
    let index = toolName.indexOf("mcpcf_");
    index >= 0;
    index = toolName.indexOf("mcpcf_", index + 1)
  ) {
    candidates.add(toolName.slice(index))
  }

  const wrappedIndex = stripToolKeyPrefix(toolName).indexOf("_mcpcf_", MCPCF_SERVER_PREFIX.length)
  const wrappedCandidate =
    wrappedIndex > 0 ? stripToolKeyPrefix(toolName).slice(wrappedIndex + 1) : null
  if (wrappedCandidate) {
    candidates.add(wrappedCandidate)
  }

  const orderedCandidates = wrappedCandidate
    ? [wrappedCandidate, ...[...candidates].filter((candidate) => candidate !== wrappedCandidate)]
    : [...candidates]

  for (const candidate of orderedCandidates) {
    const parsed = parseMcpcfProxyToolName(candidate)
    if (parsed) {
      return {
        serverKey: parsed.serverAlias,
        upstreamToolName: parsed.upstreamToolName,
        serverLabel: formatToolWords(parsed.serverAlias, "title"),
      }
    }

    const relaxed = parseMcpcfRelaxedProxyToolName(candidate)
    if (relaxed) {
      return {
        ...relaxed,
        serverLabel: formatMcpServerLabel(relaxed.serverKey),
      }
    }
  }

  const underscoreParsed = parseMcpcfUnderscoreIsolateToolKey(stripToolKeyPrefix(toolName))
  if (underscoreParsed) {
    return {
      ...underscoreParsed,
      serverLabel: formatMcpServerLabel(underscoreParsed.serverKey),
    }
  }

  return null
}

export interface FormattedToolCall {
  toolName: string
  summary: string
  icon: string | null
  mcpLabels?: {
    server: string
    tool: string
  }
  getDetails: () => {
    args?: Record<string, unknown>
    output?: string
    metadata?: Array<{ label: string; value: string }>
  }
}

export function formatToolCall(event: SandboxEvent): FormattedToolCall {
  const { tool, args } = event
  const output = event.output ?? event.result
  const toolName = tool || "Unknown"
  const mcpcfTool = parseMcpcfToolKey(toolName)
  const customMcpTool = parseCustomMcpToolKey(toolName)

  if (mcpcfTool) {
    const toolDisplayName = formatMcpToolLabel(mcpcfTool.serverKey, mcpcfTool.upstreamToolName)
    return {
      toolName: mcpcfTool.serverLabel,
      summary: toolDisplayName,
      icon: "plug",
      mcpLabels: {
        server: mcpcfTool.serverLabel,
        tool: toolDisplayName,
      },
      getDetails: () => ({
        metadata: [
          { label: "MCP Context Forge server", value: mcpcfTool.serverLabel },
          { label: "MCP tool", value: mcpcfTool.upstreamToolName },
          { label: "Tool id", value: toolName },
        ],
        args,
        output,
      }),
    }
  }

  if (customMcpTool) {
    const serverDisplayName = customMcpTool.serverName
      ? `${formatToolWords(customMcpTool.serverName, "title")} MCP`
      : "Custom MCP"
    const toolDisplayName = formatMcpToolLabel(customMcpTool.serverName, customMcpTool.mcpToolName)

    return {
      toolName: serverDisplayName,
      summary: toolDisplayName,
      icon: "plug",
      mcpLabels: {
        server: serverDisplayName,
        tool: toolDisplayName,
      },
      getDetails: () => ({
        metadata: [
          ...(customMcpTool.serverName
            ? [{ label: "MCP server", value: customMcpTool.serverName }]
            : []),
          { label: "MCP tool", value: customMcpTool.mcpToolName },
          { label: "Tool id", value: toolName },
        ],
        args,
        output,
      }),
    }
  }

  switch (toolName) {
    case "Read": {
      const filePath = (args?.filePath ?? args?.file_path) as string | undefined
      const lineCount = countLines(output)
      return {
        toolName: "Read",
        summary: filePath
          ? `${basename(filePath)}${lineCount > 0 ? ` (${lineCount} lines)` : ""}`
          : "file",
        icon: "file",
        getDetails: () => ({ args, output }),
      }
    }

    case "Edit": {
      const filePath = (args?.filePath ?? args?.file_path) as string | undefined
      return {
        toolName: "Edit",
        summary: filePath ? basename(filePath) : "file",
        icon: "pencil",
        getDetails: () => ({ args, output }),
      }
    }

    case "Write": {
      const filePath = (args?.filePath ?? args?.file_path) as string | undefined
      return {
        toolName: "Write",
        summary: filePath ? basename(filePath) : "file",
        icon: "plus",
        getDetails: () => ({ args, output }),
      }
    }

    case "Bash": {
      const command = args?.command as string | undefined
      return {
        toolName: "Bash",
        summary: truncate(command, 50),
        icon: "terminal",
        getDetails: () => ({ args, output }),
      }
    }

    case "Grep": {
      const pattern = args?.pattern as string | undefined
      const matchCount = output ? countLines(output) : 0
      return {
        toolName: "Grep",
        summary: pattern
          ? `"${truncate(pattern, 30)}"${matchCount > 0 ? ` (${matchCount} matches)` : ""}`
          : "search",
        icon: "search",
        getDetails: () => ({ args, output }),
      }
    }

    case "Glob": {
      const pattern = args?.pattern as string | undefined
      const fileCount = output ? countLines(output) : 0
      return {
        toolName: "Glob",
        summary: pattern
          ? `${truncate(pattern, 30)}${fileCount > 0 ? ` (${fileCount} files)` : ""}`
          : "search",
        icon: "folder",
        getDetails: () => ({ args, output }),
      }
    }

    case "Task": {
      const description = args?.description as string | undefined
      const prompt = args?.prompt as string | undefined
      return {
        toolName: "Task",
        summary: description ? truncate(description, 40) : prompt ? truncate(prompt, 40) : "task",
        icon: "box",
        getDetails: () => ({ args, output }),
      }
    }

    case "WebFetch": {
      const url = args?.url as string | undefined
      return {
        toolName: "WebFetch",
        summary: url ? truncate(url, 40) : "url",
        icon: "globe",
        getDetails: () => ({ args, output }),
      }
    }

    case "WebSearch": {
      const query = args?.query as string | undefined
      return {
        toolName: "WebSearch",
        summary: query ? `"${truncate(query, 40)}"` : "search",
        icon: "search",
        getDetails: () => ({ args, output }),
      }
    }

    case "TodoWrite": {
      const todos = args?.todos as unknown[] | undefined
      return {
        toolName: "TodoWrite",
        summary: todos ? `${todos.length} item${todos.length === 1 ? "" : "s"}` : "todos",
        icon: "file",
        getDetails: () => ({ args, output }),
      }
    }

    default:
      return {
        toolName,
        summary: args && Object.keys(args).length > 0 ? truncate(JSON.stringify(args), 50) : "",
        icon: "tool",
        getDetails: () => ({ args, output }),
      }
  }
}

function allEventsShareTool(events: SandboxEvent[]): boolean {
  if (events.length <= 1) {
    return true
  }
  const firstTool = events[0].tool
  return events.every((event) => event.tool === firstTool)
}

export function formatToolGroup(events: SandboxEvent[]): {
  toolName: string
  count: number
  summary: string
  icon: string | null
} {
  if (events.length === 0) {
    return { toolName: "Unknown", count: 0, summary: "", icon: "tool" }
  }

  const count = events.length
  const firstCall = formatToolCall(events[0])

  if (count === 1) {
    return {
      toolName: firstCall.toolName,
      count,
      summary: firstCall.summary,
      icon: firstCall.icon,
    }
  }

  if (!allEventsShareTool(events)) {
    return {
      toolName: "Tool calls",
      count,
      summary: `${count} calls`,
      icon: "tool",
    }
  }

  const toolName = events[0].tool || "Unknown"

  switch (toolName) {
    case "Read":
      return {
        toolName: "Read",
        count,
        summary: `${count} file${count === 1 ? "" : "s"}`,
        icon: "file",
      }

    case "Edit":
      return {
        toolName: "Edit",
        count,
        summary: `${count} file${count === 1 ? "" : "s"}`,
        icon: "pencil",
      }

    case "Bash":
      return {
        toolName: "Bash",
        count,
        summary: `${count} command${count === 1 ? "" : "s"}`,
        icon: "terminal",
      }

    default:
      return {
        toolName: firstCall.toolName,
        count,
        summary: `${count} call${count === 1 ? "" : "s"}`,
        icon: firstCall.icon,
      }
  }
}
