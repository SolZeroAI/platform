import {
  buildSessionToolRuntimePlan,
  type OpenCodeMcpServers,
  type SessionToolSpec,
} from "@solzero/shared"
import PROMPT_ANTHROPIC from "./prompt/anthropic"
import PROMPT_DEFAULT from "./prompt/default"
import PROMPT_BEAST from "./prompt/beast"
import PROMPT_GEMINI from "./prompt/gemini"
import PROMPT_GPT from "./prompt/gpt"
import PROMPT_CODEX from "./prompt/codex"

const REPO_ROOT = "/repo"
const MCPCF_PROMPT_TOOL_NAME_LIMIT = 24

function selectProviderPrompt(modelId: string): string {
  const normalized = modelId.toLowerCase()

  if (normalized.includes("gpt-4") || normalized.includes("o1") || normalized.includes("o3")) {
    return PROMPT_BEAST
  }

  if (normalized.includes("gpt")) {
    if (normalized.includes("codex")) {
      return PROMPT_CODEX
    }
    return PROMPT_GPT
  }

  if (normalized.includes("gemini")) {
    return PROMPT_GEMINI
  }

  if (normalized.includes("claude")) {
    return PROMPT_ANTHROPIC
  }

  return PROMPT_DEFAULT
}

function buildEnvironmentPrompt(input: {
  runtimeModelId: string
  providerId: string
  modelId: string
  hasRepoWorkspace?: boolean
  hasDocs?: boolean
  hasWorkflowBuilder?: boolean
  customMcpServerNames?: readonly string[]
  mcpcfMcpServers?: readonly IsolateMcpcfMcpPromptServer[]
}): string {
  const hasRepoWorkspace = input.hasRepoWorkspace ?? true
  const hasDocs = input.hasDocs ?? true
  const hasWorkflowBuilder = input.hasWorkflowBuilder ?? false
  const customMcpServerNames = [...(input.customMcpServerNames ?? [])].sort((left, right) =>
    left.localeCompare(right),
  )
  const mcpcfMcpServers = input.mcpcfMcpServers ?? []
  const hasRemoteMcpTools = customMcpServerNames.length > 0 || mcpcfMcpServers.length > 0
  const repoLines = hasRepoWorkspace
    ? [
        `  Repository workspace root: ${REPO_ROOT}`,
        "  Structured repository tools: read_file, write_file, glob_files, search_files",
        "  Structured git tools: git_status, git_diff, git_log, git_create_pull_request",
        "  Pull requests: use git_create_pull_request after making repository changes; it commits, pushes the s0-managed branch, and opens a PR against the default branch.",
      ]
    : [
        "  Repository workspace: not attached",
        "  Structured repository tools: unavailable because no repository is attached",
        "  Structured git tools: unavailable because no repository is attached",
        "  Do not attempt repository paths such as /repo unless a repository is attached.",
      ]
  const docsLine = hasDocs
    ? "  Internal knowledge tool: docs_search available for configured knowledge sources"
    : "  Internal knowledge tool: unavailable because no knowledge sources are configured"
  const workflowBuilderLines = hasWorkflowBuilder
    ? [
        "  Workflow builder tools: get_workflow_node_catalog, validate_workflow_manifest, submit_workflow_draft",
        "  Workflow builder skill: activate s0.workflow-builder before building or editing workflow manifests",
      ]
    : ["  Workflow builder tools: unavailable"]
  const customMcpLines = customMcpServerNames.length
    ? [
        `  Remote MCP tools: available from configured MCP servers: ${customMcpServerNames.join(", ")}`,
        "  When a user asks for a configured MCP by name, use the matching exposed MCP tool instead of saying the MCP is unavailable.",
      ]
    : mcpcfMcpServers.length
      ? ["  Remote MCP tools: available through the MCP Context Forge servers listed below"]
      : ["  Remote MCP tools: unavailable because no remote MCP servers are configured"]
  const mcpcfLines = buildMcpcfMcpLines(mcpcfMcpServers)
  const networkLine = hasRemoteMcpTools
    ? "  External network access: unavailable except through configured tools and remote MCP servers"
    : "  External network access: unavailable except for configured internal docs search"

  return [
    "You are a helpful s0 assistant for software engineering tasks.",
    `You are powered by the model named ${input.modelId}. The exact model ID is ${input.runtimeModelId}.`,
    "If the user asks what model you are, answer with the exact model ID above.",
    "Here is useful information about the environment you are running in:",
    "<env>",
    "  Runtime: Cloudflare Workers isolate",
    "  Filesystem: durable virtual workspace via @cloudflare/shell",
    ...repoLines,
    docsLine,
    ...workflowBuilderLines,
    ...customMcpLines,
    ...mcpcfLines,
    "  Shell access: unavailable",
    networkLine,
    `  Provider ID: ${input.providerId}`,
    `  Today's date: ${new Date().toDateString()}`,
    "</env>",
  ].join("\n")
}

export interface IsolateMcpcfMcpPromptServer {
  label: string
  serverName: string
  description: string
  toolNames: readonly string[]
}

export function buildIsolateSystemPromptFacts(input: {
  tools?: readonly SessionToolSpec[] | null
  customMcpServers?: OpenCodeMcpServers | null
}) {
  const promptFactTools = (input.tools ?? []).filter((tool) => tool.kind !== "mcpcf_server")
  return buildSessionToolRuntimePlan({
    tools: promptFactTools,
    customMcpServers: input.customMcpServers,
  }).isolatePromptFacts
}

function buildMcpcfMcpLines(servers: readonly IsolateMcpcfMcpPromptServer[]): string[] {
  if (servers.length === 0) {
    return []
  }

  const header = [
    "  MCP Context Forge servers:",
    "  Treat MCP Context Forge session metadata as selection metadata only; use the exposed MCP tool names below for calls.",
  ]

  const serverLines = [...servers]
    .sort((left, right) => left.label.localeCompare(right.label))
    .flatMap((server) => {
      const summary = `    - ${server.label} (${server.serverName}): ${server.description}`
      if (server.toolNames.length === 0) {
        return [summary]
      }
      const displayedToolNames = server.toolNames.slice(0, MCPCF_PROMPT_TOOL_NAME_LIMIT)
      const overflow = server.toolNames.length - displayedToolNames.length
      return [
        summary,
        `      Exposed tool names: ${displayedToolNames.join(", ")}${overflow > 0 ? `, and ${overflow} more` : ""}`,
      ]
    })

  return [...header, ...serverLines]
}

// Adapted from https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/system.ts.
// Future updates should compare this file against the upstream source before changing prompt selection or environment assembly.
export function buildIsolateSystemPrompt(input: {
  runtimeModelId: string
  providerId: string
  modelId: string
  hasRepoWorkspace?: boolean
  hasDocs?: boolean
  hasWorkflowBuilder?: boolean
  customMcpServerNames?: readonly string[]
  mcpcfMcpServers?: readonly IsolateMcpcfMcpPromptServer[]
}): string {
  return [selectProviderPrompt(input.modelId), buildEnvironmentPrompt(input)].join("\n\n")
}
