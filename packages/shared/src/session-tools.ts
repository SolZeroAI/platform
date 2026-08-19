import { parseJson, stringifyJson } from "./json"
import { normalizeOpenCodeMcpServers, type OpenCodeMcpServers } from "./provider-config"
import type { OpenCodeRemoteMcpServer } from "./provider-config"

export const SESSION_TOOL_QUERY_PARAM = "tool"

export const DEFAULT_SESSION_CUSTOM_MCP_SERVERS = normalizeOpenCodeMcpServers({
  time: {
    type: "remote",
    url: "https://a.currenttimeutc.com/mcp",
    enabled: true,
  },
})

const CUSTOM_MCP_SERVER_ID_PREFIX = "custom_"
const CUSTOM_MCP_SERVER_ID_HASH_SEPARATOR = "__"
const CUSTOM_MCP_TOOL_KEY_PREFIX = "tool_"

export function getDefaultSessionCustomMcpServers(): OpenCodeMcpServers {
  return normalizeOpenCodeMcpServers(DEFAULT_SESSION_CUSTOM_MCP_SERVERS)
}

export function isDefaultSessionCustomMcpServer(
  name: string,
  server: OpenCodeMcpServers[string] | null | undefined,
): boolean {
  const defaultServer = getDefaultSessionCustomMcpServers()[name]
  if (!defaultServer || !server || defaultServer.type !== "remote" || server.type !== "remote") {
    return false
  }

  return (
    server.url === defaultServer.url &&
    server.enabled === defaultServer.enabled &&
    server.headers === undefined &&
    server.oauth === undefined &&
    server.timeout === undefined
  )
}

function hashCustomMcpServerName(name: string): string {
  const hash = Array.from({ length: name.length }, (_, index) => name.charCodeAt(index)).reduce(
    (acc, code) => (acc * 31 + code) >>> 0,
    0,
  )
  return hash.toString(36)
}

function isAsciiLowercaseAlphanumeric(character: string): boolean {
  const code = character.charCodeAt(0)
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122)
}

function slugCustomMcpServerName(name: string): string {
  const characters: string[] = []
  let separatorPending = false

  // oxlint-disable-next-line effect/imperative-loops -- A bounded-output linear scan avoids regex backtracking on untrusted server names.
  for (const character of name.toLowerCase()) {
    if (!isAsciiLowercaseAlphanumeric(character)) {
      separatorPending = characters.length > 0
      continue
    }

    if (separatorPending) {
      characters.push("_")
      separatorPending = false
    }
    if (characters.length < 40) {
      characters.push(character)
    }
    if (characters.length === 40) {
      break
    }
  }

  return characters.join("") || "server"
}

export function getCustomMcpServerId(name: string): string {
  return `${CUSTOM_MCP_SERVER_ID_PREFIX}${slugCustomMcpServerName(name)}${CUSTOM_MCP_SERVER_ID_HASH_SEPARATOR}${hashCustomMcpServerName(name)}`
}

export function isCustomMcpServerId(id: string): boolean {
  return id.startsWith(CUSTOM_MCP_SERVER_ID_PREFIX)
}

export function parseCustomMcpServerId(id: string): {
  serverName: string
  hash: string
} | null {
  if (!isCustomMcpServerId(id)) {
    return null
  }

  const body = id.slice(CUSTOM_MCP_SERVER_ID_PREFIX.length)
  const separatorIndex = body.lastIndexOf(CUSTOM_MCP_SERVER_ID_HASH_SEPARATOR)
  if (separatorIndex <= 0) {
    return null
  }

  const hashStart = separatorIndex + CUSTOM_MCP_SERVER_ID_HASH_SEPARATOR.length
  if (hashStart >= body.length) {
    return null
  }

  return {
    serverName: body.slice(0, separatorIndex),
    hash: body.slice(hashStart),
  }
}

export function parseCustomMcpToolKey(toolKey: string): {
  serverName: string | null
  mcpToolName: string
} | null {
  const expectedPrefix = `${CUSTOM_MCP_TOOL_KEY_PREFIX}${CUSTOM_MCP_SERVER_ID_PREFIX}`
  if (!toolKey.startsWith(expectedPrefix)) {
    return null
  }

  const body = toolKey.slice(CUSTOM_MCP_TOOL_KEY_PREFIX.length)
  const separatorIndex = body.indexOf(CUSTOM_MCP_SERVER_ID_HASH_SEPARATOR)
  if (separatorIndex > CUSTOM_MCP_SERVER_ID_PREFIX.length) {
    const hashAndTool = body.slice(separatorIndex + CUSTOM_MCP_SERVER_ID_HASH_SEPARATOR.length)
    const toolSeparatorIndex = hashAndTool.indexOf("_")
    if (toolSeparatorIndex > 0 && toolSeparatorIndex < hashAndTool.length - 1) {
      return {
        serverName: body.slice(CUSTOM_MCP_SERVER_ID_PREFIX.length, separatorIndex),
        mcpToolName: hashAndTool.slice(toolSeparatorIndex + 1),
      }
    }
  }

  const legacySegments = body.slice(CUSTOM_MCP_SERVER_ID_PREFIX.length).split("_").filter(Boolean)
  const legacyHashIndex = legacySegments.findIndex((segment, index) => {
    if (index <= 0 || index >= legacySegments.length - 1) {
      return false
    }
    const serverName = legacySegments.slice(0, index).join("_")
    return hashCustomMcpServerName(serverName) === segment
  })
  const fallbackLegacyHashIndex = legacySegments.findIndex(
    (segment, index) =>
      index > 0 &&
      index < legacySegments.length - 1 &&
      segment.length >= 4 &&
      segment.length <= 7 &&
      /[0-9]/.test(segment) &&
      /^[a-z0-9]+$/.test(segment),
  )
  const hashIndex = legacyHashIndex === -1 ? fallbackLegacyHashIndex : legacyHashIndex

  if (hashIndex === -1) {
    return {
      serverName: null,
      mcpToolName: legacySegments.join("_"),
    }
  }

  return {
    serverName: legacySegments.slice(0, hashIndex).join("_"),
    mcpToolName: legacySegments.slice(hashIndex + 1).join("_"),
  }
}

export interface AiSearchSourceDefinition {
  id: string
  label: string
  description: string
}

export interface McpcfServerDefinition {
  id: string
  slug: string
  label: string
  description: string
  toolCount: number
}

export type McpcfServerId = string
export type McpcfServerSlug = string

export const AI_SEARCH_SESSION_TOOL_KIND = "ai_search"
export const MCPCF_SESSION_TOOL_KIND = "mcpcf_server"
export const MCPCF_PROXY_TOOL_PREFIX = "mcpcf_"
export const MCPCF_PROXY_TOOL_SEPARATOR = "__"
const MCPCF_SERVER_SLUG_PATTERN = /^[a-z0-9][a-z0-9_]*$/
const MCPCF_PROXY_SERVER_ALIAS_PATTERN = /^s[a-z0-9]{7}$/
const AI_SEARCH_SOURCE_ID_PATTERN = /^[a-z0-9_]+(?:-[a-z0-9_]+)*$/

export interface GitHubRepoSessionTool {
  kind: "github_repo"
  repoOwner: string
  repoName: string
}

export interface AiSearchSessionTool {
  kind: typeof AI_SEARCH_SESSION_TOOL_KIND
  sourceId: string
}

export interface WorkflowBuilderSessionTool {
  kind: "workflow_builder"
}

export interface McpcfSessionTool {
  kind: typeof MCPCF_SESSION_TOOL_KIND
  serverId: McpcfServerId
}

export type SessionToolSpec =
  | GitHubRepoSessionTool
  | AiSearchSessionTool
  | McpcfSessionTool
  | WorkflowBuilderSessionTool

export type UnavailableSessionToolReason =
  | "unknown_kind"
  | "invalid_config"
  | "invalid_storage"
  | "disabled"
  | "missing_resource"
  | "availability_unknown"

export type SessionToolAvailabilityReason = Extract<
  UnavailableSessionToolReason,
  "disabled" | "missing_resource" | "availability_unknown"
>

export interface UnavailableSessionTool {
  kind: string | null
  toolId?: string
  reason: UnavailableSessionToolReason
}

export interface StoredSessionToolResolution {
  tools: SessionToolSpec[]
  unavailableTools: UnavailableSessionTool[]
}

export interface SessionToolAvailability {
  kind: SessionToolSpec["kind"]
  toolId: string
  reason: SessionToolAvailabilityReason
}

export interface ResolveSessionToolsInput {
  tools?: readonly SessionToolSpec[] | null
  queryTools?: readonly SessionToolSpec[] | null
  repoOwner?: string | null
  repoName?: string | null
}

export interface RemoteCustomMcpServerRuntimePlan {
  id: string
  name: string
  server: OpenCodeRemoteMcpServer
  optional: boolean
}

export interface SessionToolRuntimePlan {
  selectedTools: SessionToolSpec[]
  customMcpServers: OpenCodeMcpServers
  sandboxMcp: {
    aiSearchSourceIds: string[]
    workflowBuilderEnabled: boolean
    mcpcfServers: McpcfServerDefinition[]
    reservedMcpcfServers: McpcfServerDefinition[]
    customMcpServers: OpenCodeMcpServers
  }
  isolateAiSdkTools: {
    repoTool: GitHubRepoSessionTool | null
    aiSearchTools: AiSearchSessionTool[]
    workflowBuilderEnabled: boolean
  }
  isolatePromptFacts: {
    hasRepoWorkspace: boolean
    hasAiSearch: boolean
    hasDocs: boolean
    hasWorkflowBuilder: boolean
    customMcpServerNames: string[]
    mcpcfServers: McpcfServerDefinition[]
  }
  mcpRegistration: {
    remoteCustomMcpServers: RemoteCustomMcpServerRuntimePlan[]
    mcpcfServers: McpcfServerDefinition[]
  }
}

export interface BuildSessionToolRuntimePlanInput {
  tools?: readonly SessionToolSpec[] | null
  customMcpServers?: OpenCodeMcpServers | null
  mcpcfServers?: readonly McpcfServerDefinition[] | null
}

export function normalizeAiSearchSourceId(value: string): string {
  const sourceId = value.trim()
  if (!sourceId) {
    throw new Error("AI Search source id is required")
  }
  if (sourceId.length > 64 || !AI_SEARCH_SOURCE_ID_PATTERN.test(sourceId)) {
    throw new Error(`Invalid AI Search source id '${value}'`)
  }
  return sourceId
}

export function isAiSearchSessionTool(tool: SessionToolSpec): tool is AiSearchSessionTool {
  return tool.kind === AI_SEARCH_SESSION_TOOL_KIND
}

export function getSelectedAiSearchSourceIds(
  tools: readonly SessionToolSpec[] | null | undefined,
): string[] {
  return normalizeSessionTools(tools)
    .filter(isAiSearchSessionTool)
    .map((tool) => tool.sourceId)
}

export function normalizeMcpcfServerId(value: string): McpcfServerId {
  const serverId = value.trim()
  if (!serverId) {
    throw new Error("MCP Context Forge server id is required")
  }
  return serverId
}

export function normalizeMcpcfServerSlug(value: string): McpcfServerSlug {
  const slug = value.trim().toLowerCase()
  if (!MCPCF_SERVER_SLUG_PATTERN.test(slug)) {
    throw new Error(`Invalid MCP Context Forge server slug '${value}'`)
  }
  return slug
}

function hashMcpcfServerId(serverId: McpcfServerId): string {
  const hash = Array.from({ length: serverId.length }, (_, index) =>
    serverId.charCodeAt(index),
  ).reduce((acc, code) => (acc * 31 + code) >>> 0, 0)
  return hash.toString(36).padStart(7, "0")
}

export function getMcpcfProxyServerAlias(serverId: string): string {
  return `s${hashMcpcfServerId(normalizeMcpcfServerId(serverId))}`
}

export function isMcpcfSessionTool(tool: SessionToolSpec): tool is McpcfSessionTool {
  return tool.kind === MCPCF_SESSION_TOOL_KIND
}

export function getSelectedMcpcfServerIds(
  tools: readonly SessionToolSpec[] | null | undefined,
): McpcfServerId[] {
  return normalizeSessionTools(tools)
    .filter(isMcpcfSessionTool)
    .map((tool) => tool.serverId)
}

function getSelectedMcpcfServers(input: {
  tools: readonly SessionToolSpec[]
  mcpcfServers?: readonly McpcfServerDefinition[] | null
}): McpcfServerDefinition[] {
  const selectedServerIds = getSelectedMcpcfServerIds(input.tools)
  if (selectedServerIds.length === 0) {
    return []
  }

  const serversById = new Map((input.mcpcfServers ?? []).map((server) => [server.id, server]))
  return selectedServerIds.map((serverId) => {
    const server = serversById.get(serverId)
    if (!server) {
      throw new Error(`MCP Context Forge server '${serverId}' is not available`)
    }
    return server
  })
}

function getRemoteCustomMcpServerRuntimePlan(
  customMcpServers: OpenCodeMcpServers,
): RemoteCustomMcpServerRuntimePlan[] {
  return Object.entries(customMcpServers)
    .filter((entry): entry is [string, OpenCodeRemoteMcpServer] => {
      const [, server] = entry
      return server.enabled !== false && server.type === "remote"
    })
    .map(([name, server]) => ({
      id: getCustomMcpServerId(name),
      name,
      server,
      optional: isDefaultSessionCustomMcpServer(name, server),
    }))
}

export function buildSessionToolRuntimePlan(
  input: BuildSessionToolRuntimePlanInput,
): SessionToolRuntimePlan {
  const selectedTools = normalizeSessionTools(input.tools)
  const customMcpServers = normalizeOpenCodeMcpServers(input.customMcpServers)
  const repoTool = getGitHubRepoTool(selectedTools)
  const aiSearchTools = selectedTools.filter(isAiSearchSessionTool)
  const workflowBuilderEnabled = selectedTools.some((tool) => tool.kind === "workflow_builder")
  const mcpcfServers = getSelectedMcpcfServers({
    tools: selectedTools,
    mcpcfServers: input.mcpcfServers,
  })
  const reservedMcpcfServers = [...(input.mcpcfServers ?? [])]
  const remoteCustomMcpServers = getRemoteCustomMcpServerRuntimePlan(customMcpServers)
  const customMcpServerNames = remoteCustomMcpServers
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

  return {
    selectedTools,
    customMcpServers,
    sandboxMcp: {
      aiSearchSourceIds: aiSearchTools.map((tool) => tool.sourceId),
      workflowBuilderEnabled,
      mcpcfServers,
      reservedMcpcfServers,
      customMcpServers,
    },
    isolateAiSdkTools: {
      repoTool,
      aiSearchTools,
      workflowBuilderEnabled,
    },
    isolatePromptFacts: {
      hasRepoWorkspace: Boolean(repoTool),
      hasAiSearch: aiSearchTools.length > 0,
      hasDocs: aiSearchTools.length > 0,
      hasWorkflowBuilder: workflowBuilderEnabled,
      customMcpServerNames,
      mcpcfServers,
    },
    mcpRegistration: {
      remoteCustomMcpServers,
      mcpcfServers,
    },
  }
}

export function getMcpcfProxyToolName(serverId: string, upstreamToolName: string): string {
  return `${MCPCF_PROXY_TOOL_PREFIX}${getMcpcfProxyServerAlias(serverId)}${MCPCF_PROXY_TOOL_SEPARATOR}${upstreamToolName}`
}

export function parseMcpcfProxyToolName(value: string): {
  serverAlias: string
  upstreamToolName: string
} | null {
  if (!value.startsWith(MCPCF_PROXY_TOOL_PREFIX)) {
    return null
  }

  const separatorIndex = value.indexOf(MCPCF_PROXY_TOOL_SEPARATOR)
  if (separatorIndex <= MCPCF_PROXY_TOOL_PREFIX.length) {
    return null
  }

  const serverAlias = value.slice(MCPCF_PROXY_TOOL_PREFIX.length, separatorIndex)
  const upstreamToolName = value.slice(separatorIndex + MCPCF_PROXY_TOOL_SEPARATOR.length)
  if (!upstreamToolName || !MCPCF_PROXY_SERVER_ALIAS_PATTERN.test(serverAlias)) {
    return null
  }

  return {
    serverAlias,
    upstreamToolName,
  }
}

export function formatGitHubRepoTool(tool: GitHubRepoSessionTool): string {
  return `${tool.repoOwner}/${tool.repoName}`
}

export function getGitHubRepoTool(
  tools: readonly SessionToolSpec[] | null | undefined,
): GitHubRepoSessionTool | null {
  return tools?.find((tool) => tool.kind === "github_repo") ?? null
}

type SessionToolRecord = Record<string, unknown>
interface SessionToolDefinition {
  normalize: (rawTool: SessionToolRecord) => SessionToolSpec
  getToolId: (tool: SessionToolSpec) => string
}

function requireSessionToolString(
  rawTool: SessionToolRecord,
  field: string,
  toolKind: string,
): string {
  const value = rawTool[field]
  if (typeof value !== "string") {
    throw new Error(`${toolKind} tools require a string ${field}`)
  }
  return value
}

const SESSION_TOOL_REGISTRY = {
  github_repo: {
    normalize: (rawTool: SessionToolRecord): GitHubRepoSessionTool => {
      const repoOwner = requireSessionToolString(rawTool, "repoOwner", "GitHub repo")
        .trim()
        .toLowerCase()
      const repoName = requireSessionToolString(rawTool, "repoName", "GitHub repo")
        .trim()
        .toLowerCase()

      if (!repoOwner || !repoName) {
        throw new Error("GitHub repo tools require both repoOwner and repoName")
      }

      return {
        kind: "github_repo",
        repoOwner,
        repoName,
      }
    },
    getToolId: (tool: SessionToolSpec) => {
      if (tool.kind !== "github_repo") {
        throw new Error("Expected a GitHub repo session tool")
      }
      return `${tool.repoOwner}/${tool.repoName}`
    },
  },
  [AI_SEARCH_SESSION_TOOL_KIND]: {
    normalize: (rawTool: SessionToolRecord): AiSearchSessionTool => ({
      kind: AI_SEARCH_SESSION_TOOL_KIND,
      sourceId: normalizeAiSearchSourceId(
        requireSessionToolString(rawTool, "sourceId", "AI search"),
      ),
    }),
    getToolId: (tool: SessionToolSpec) => {
      if (tool.kind !== AI_SEARCH_SESSION_TOOL_KIND) {
        throw new Error("Expected an AI Search session tool")
      }
      return tool.sourceId
    },
  },
  [MCPCF_SESSION_TOOL_KIND]: {
    normalize: (rawTool: SessionToolRecord): McpcfSessionTool => ({
      kind: MCPCF_SESSION_TOOL_KIND,
      serverId: normalizeMcpcfServerId(
        requireSessionToolString(rawTool, "serverId", "MCP Context Forge"),
      ),
    }),
    getToolId: (tool: SessionToolSpec) => {
      if (tool.kind !== MCPCF_SESSION_TOOL_KIND) {
        throw new Error("Expected an MCP Context Forge session tool")
      }
      return tool.serverId
    },
  },
  workflow_builder: {
    normalize: (): WorkflowBuilderSessionTool => ({ kind: "workflow_builder" }),
    getToolId: (tool: SessionToolSpec) => {
      if (tool.kind !== "workflow_builder") {
        throw new Error("Expected a workflow builder session tool")
      }
      return tool.kind
    },
  },
}

function getStoredSessionToolKind(rawTool: unknown): string | null {
  if (typeof rawTool !== "object" || rawTool === null || Array.isArray(rawTool)) {
    return null
  }

  const kind = (rawTool as SessionToolRecord).kind
  return typeof kind === "string" ? kind : null
}

function getSessionToolDefinition(kind: string): SessionToolDefinition | undefined {
  switch (kind) {
    case "github_repo":
      return SESSION_TOOL_REGISTRY.github_repo
    case AI_SEARCH_SESSION_TOOL_KIND:
      return SESSION_TOOL_REGISTRY[AI_SEARCH_SESSION_TOOL_KIND]
    case MCPCF_SESSION_TOOL_KIND:
      return SESSION_TOOL_REGISTRY[MCPCF_SESSION_TOOL_KIND]
    case "workflow_builder":
      return SESSION_TOOL_REGISTRY.workflow_builder
    default:
      return undefined
  }
}

function normalizeSessionTool(rawTool: unknown): SessionToolSpec {
  if (typeof rawTool !== "object" || rawTool === null || Array.isArray(rawTool)) {
    throw new Error("Session tools must be objects")
  }

  const toolRecord = rawTool as SessionToolRecord
  if (typeof toolRecord.kind !== "string" || !toolRecord.kind) {
    throw new Error("Session tools require a string kind")
  }

  const definition = getSessionToolDefinition(toolRecord.kind)
  if (!definition) {
    throw new Error(`Unknown session tool kind '${toolRecord.kind}'`)
  }

  return definition.normalize(toolRecord)
}

export function getSessionToolId(tool: SessionToolSpec): string {
  const normalizedTool = normalizeSessionTool(tool)
  const definition = getSessionToolDefinition(normalizedTool.kind)
  if (!definition) {
    throw new Error(`Unknown session tool kind '${normalizedTool.kind}'`)
  }
  return definition.getToolId(normalizedTool)
}

export function normalizeSessionTools(
  tools: readonly SessionToolSpec[] | null | undefined,
): SessionToolSpec[] {
  let githubRepo: GitHubRepoSessionTool | null = null
  const aiSearchSources = new Map<string, AiSearchSessionTool>()
  const mcpcfServers = new Map<McpcfServerId, McpcfSessionTool>()
  let workflowBuilder: WorkflowBuilderSessionTool | null = null

  ;(tools ?? []).forEach((rawTool) => {
    const normalizedTool = normalizeSessionTool(rawTool)

    if (normalizedTool.kind === "github_repo") {
      const nextTool = normalizedTool

      if (
        githubRepo &&
        (githubRepo.repoOwner !== nextTool.repoOwner || githubRepo.repoName !== nextTool.repoName)
      ) {
        throw new Error("Only one GitHub repo can be attached to an agent")
      }

      githubRepo = nextTool
      return
    }

    if (normalizedTool.kind === AI_SEARCH_SESSION_TOOL_KIND) {
      aiSearchSources.set(normalizedTool.sourceId, normalizedTool)
      return
    }

    if (normalizedTool.kind === "workflow_builder") {
      workflowBuilder = normalizedTool
      return
    }

    if (normalizedTool.kind === MCPCF_SESSION_TOOL_KIND) {
      mcpcfServers.set(normalizedTool.serverId, normalizedTool)
      return
    }
  })

  return [
    ...(githubRepo ? [githubRepo] : []),
    ...[...aiSearchSources.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    ...[...mcpcfServers.values()].sort((a, b) => a.serverId.localeCompare(b.serverId)),
    ...(workflowBuilder ? [workflowBuilder] : []),
  ]
}

export function resolveSessionTools(input: ResolveSessionToolsInput): SessionToolSpec[] {
  const repoOwner = input.repoOwner?.trim().toLowerCase() ?? ""
  const repoName = input.repoName?.trim().toLowerCase() ?? ""

  if (Boolean(repoOwner) !== Boolean(repoName)) {
    throw new Error("repoOwner and repoName must both be provided when attaching a repo")
  }

  const combined: SessionToolSpec[] = [...(input.tools ?? []), ...(input.queryTools ?? [])]

  if (repoOwner && repoName) {
    combined.push({
      kind: "github_repo",
      repoOwner,
      repoName,
    })
  }

  return normalizeSessionTools(combined)
}

export function encodeSessionToolQueryValue(tool: SessionToolSpec): string {
  if (tool.kind === "github_repo") {
    return `${tool.kind}:${formatGitHubRepoTool(tool)}`
  }

  if (tool.kind === "workflow_builder") {
    return tool.kind
  }

  if (tool.kind === MCPCF_SESSION_TOOL_KIND) {
    return `${tool.kind}:${tool.serverId}`
  }

  return `${tool.kind}:${tool.sourceId}`
}

export function decodeSessionToolQueryValue(value: string): SessionToolSpec {
  if (value === "workflow_builder") {
    return { kind: "workflow_builder" }
  }

  const separatorIndex = value.indexOf(":")
  if (separatorIndex === -1) {
    throw new Error(`Invalid session tool query value '${value}'`)
  }

  const kind = value.slice(0, separatorIndex)
  const payload = value.slice(separatorIndex + 1)

  if (kind === "github_repo") {
    const [repoOwner, repoName, ...rest] = payload.split("/")
    if (!repoOwner || !repoName || rest.length > 0) {
      throw new Error(`Invalid GitHub repo tool '${value}'`)
    }
    return {
      kind,
      repoOwner,
      repoName,
    }
  }

  if (kind === AI_SEARCH_SESSION_TOOL_KIND) {
    return {
      kind: AI_SEARCH_SESSION_TOOL_KIND,
      sourceId: normalizeAiSearchSourceId(payload),
    }
  }

  if (kind === MCPCF_SESSION_TOOL_KIND) {
    return {
      kind,
      serverId: normalizeMcpcfServerId(payload),
    }
  }

  throw new Error(`Unknown session tool kind '${kind}'`)
}

export function parseSessionToolsFromSearchParams(
  searchParams: URLSearchParams,
  paramName = SESSION_TOOL_QUERY_PARAM,
): SessionToolSpec[] {
  return normalizeSessionTools(searchParams.getAll(paramName).map(decodeSessionToolQueryValue))
}

export function appendSessionToolsToSearchParams(
  searchParams: URLSearchParams,
  tools: readonly SessionToolSpec[] | null | undefined,
  paramName = SESSION_TOOL_QUERY_PARAM,
): URLSearchParams {
  normalizeSessionTools(tools).forEach((tool) => {
    searchParams.append(paramName, encodeSessionToolQueryValue(tool))
  })
  return searchParams
}

export function createSessionToolsSearchParams(
  tools: readonly SessionToolSpec[] | null | undefined,
  paramName = SESSION_TOOL_QUERY_PARAM,
): URLSearchParams {
  return appendSessionToolsToSearchParams(new URLSearchParams(), tools, paramName)
}

export function stringifySessionTools(
  tools: readonly SessionToolSpec[] | null | undefined,
): string {
  return stringifyJson(normalizeSessionTools(tools))
}

export function parseStoredSessionTools(value: string | null | undefined): SessionToolSpec[] {
  return resolveStoredSessionTools(value).tools
}

export function resolveStoredSessionTools(
  value: string | null | undefined,
): StoredSessionToolResolution {
  if (!value) {
    return {
      tools: [],
      unavailableTools: [],
    }
  }

  let parsed: unknown
  // oxlint-disable-next-line effect/avoid-try-catch -- Stored JSON decoding is a pure compatibility boundary that returns degradation metadata instead of an Effect error channel.
  try {
    parsed = parseJson(value)
  } catch {
    return {
      tools: [],
      unavailableTools: [{ kind: null, reason: "invalid_storage" }],
    }
  }

  if (!Array.isArray(parsed)) {
    return {
      tools: [],
      unavailableTools: [{ kind: null, reason: "invalid_storage" }],
    }
  }

  return parsed.reduce<StoredSessionToolResolution>(
    (resolution, rawTool) => {
      const kind = getStoredSessionToolKind(rawTool)

      // oxlint-disable-next-line effect/avoid-try-catch -- Each untrusted stored entry is isolated so one retired or malformed tool cannot invalidate the session.
      try {
        resolution.tools = normalizeSessionTools([
          ...resolution.tools,
          normalizeSessionTool(rawTool),
        ])
      } catch {
        resolution.unavailableTools.push({
          kind,
          reason: kind && !getSessionToolDefinition(kind) ? "unknown_kind" : "invalid_config",
        })
      }

      return resolution
    },
    {
      tools: [],
      unavailableTools: [],
    },
  )
}

function sessionToolAvailabilityKey(kind: string, toolId: string): string {
  return `${kind}\u0000${toolId}`
}

export function applyStoredSessionToolAvailability(
  resolution: StoredSessionToolResolution,
  availability: readonly SessionToolAvailability[],
): StoredSessionToolResolution {
  const unavailableByTool = new Map(
    availability.map((entry) => [sessionToolAvailabilityKey(entry.kind, entry.toolId), entry]),
  )

  return resolution.tools.reduce<StoredSessionToolResolution>(
    (next, tool) => {
      const toolId = getSessionToolId(tool)
      const unavailable = unavailableByTool.get(sessionToolAvailabilityKey(tool.kind, toolId))
      if (!unavailable) {
        next.tools.push(tool)
        return next
      }

      next.unavailableTools.push({
        kind: tool.kind,
        toolId,
        reason: unavailable.reason,
      })
      return next
    },
    {
      tools: [],
      unavailableTools: [...resolution.unavailableTools],
    },
  )
}

export function summarizeSessionTools(
  tools: readonly SessionToolSpec[] | null | undefined,
  options?: {
    emptyLabel?: string
    customMcpServers?: OpenCodeMcpServers | null
    aiSearchSourceLabels?: Record<string, string> | null
    mcpcfServerLabels?: Record<string, string> | null
  },
): string {
  const normalizedTools = normalizeSessionTools(tools)
  const repo = getGitHubRepoTool(normalizedTools)
  const knowledgeSources = normalizedTools.filter(isAiSearchSessionTool)
  const mcpcfServers = normalizedTools.filter(isMcpcfSessionTool)
  const workflowBuilder = normalizedTools.some((tool) => tool.kind === "workflow_builder")
  const customMcpServers = normalizeOpenCodeMcpServers(options?.customMcpServers)
  const customMcpCount = Object.keys(customMcpServers).length

  const parts: string[] = []

  if (repo) {
    parts.push(formatGitHubRepoTool(repo))
  }

  if (knowledgeSources.length > 0) {
    if (
      !repo &&
      knowledgeSources.length === 1 &&
      mcpcfServers.length === 0 &&
      customMcpCount === 0
    ) {
      parts.push(options?.aiSearchSourceLabels?.[knowledgeSources[0].sourceId] ?? "AI Search")
    } else {
      parts.push(
        `${knowledgeSources.length} knowledge source${knowledgeSources.length === 1 ? "" : "s"}`,
      )
    }
  }

  if (mcpcfServers.length > 0) {
    if (
      !repo &&
      knowledgeSources.length === 0 &&
      mcpcfServers.length === 1 &&
      customMcpCount === 0
    ) {
      parts.push(options?.mcpcfServerLabels?.[mcpcfServers[0].serverId] ?? "MCP Context Forge")
    } else {
      parts.push(
        `${mcpcfServers.length} MCP Context Forge server${mcpcfServers.length === 1 ? "" : "s"}`,
      )
    }
  }

  if (customMcpCount > 0) {
    parts.push(`${customMcpCount} MCP${customMcpCount === 1 ? "" : "s"}`)
  }

  if (workflowBuilder) {
    parts.push("Workflow builder")
  }

  return parts.join(" + ") || options?.emptyLabel || "No tools"
}
