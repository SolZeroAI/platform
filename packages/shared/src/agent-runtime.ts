export const AGENT_RUNTIMES = ["isolate", "opencode", "codex", "claude-code"] as const

export type AgentRuntime = (typeof AGENT_RUNTIMES)[number]

export type SessionKind = "isolate" | "sandbox"

export type HarnessAgentRuntime = Exclude<AgentRuntime, "isolate">

const AGENT_RUNTIME_VALUES: readonly string[] = AGENT_RUNTIMES

const HARNESS_AGENT_RUNTIMES: ReadonlySet<AgentRuntime> = new Set<AgentRuntime>([
  "opencode",
  "codex",
  "claude-code",
])

export function isAgentRuntime(value: unknown): value is AgentRuntime {
  return typeof value === "string" && AGENT_RUNTIME_VALUES.includes(value)
}

export function resolveAgentRuntime(input: {
  agentRuntime?: AgentRuntime | string | null
  sessionKind?: SessionKind | string | null
}): AgentRuntime {
  if (isAgentRuntime(input.agentRuntime)) {
    return input.agentRuntime
  }
  return input.sessionKind === "sandbox" ? "opencode" : "isolate"
}

export function sessionKindForAgentRuntime(agentRuntime: AgentRuntime): SessionKind {
  return agentRuntime === "isolate" ? "isolate" : "sandbox"
}

export function isHarnessAgentRuntime(agentRuntime: AgentRuntime): boolean {
  return agentRuntime !== "isolate"
}

export function isHarnessRuntime(value: AgentRuntime): value is HarnessAgentRuntime {
  return HARNESS_AGENT_RUNTIMES.has(value)
}

export function isAgentRuntimeCompatibleWithProvider(
  agentRuntime: AgentRuntime,
  providerId: string,
  providerApi?: string,
): boolean {
  switch (agentRuntime) {
    case "isolate":
      return true
    case "opencode":
      return (
        providerId === "litellm" ||
        providerId === "litellm-anthropic" ||
        (providerId === "cloudflare-ai-gateway" &&
          (providerApi === "responses" ||
            providerApi === "chat_completions" ||
            providerApi === "messages"))
      )
    case "codex":
      return (
        providerId === "litellm" ||
        (providerId === "cloudflare-ai-gateway" && providerApi === "responses")
      )
    case "claude-code":
      return (
        providerId === "litellm-anthropic" ||
        (providerId === "cloudflare-ai-gateway" && providerApi === "messages")
      )
  }
}

export function describeAgentRuntimeModelCompatibility(agentRuntime: AgentRuntime): string {
  switch (agentRuntime) {
    case "isolate":
      return "any configured model"
    case "opencode":
      return "Cloudflare AI Gateway or LiteLLM models"
    case "codex":
      return "Cloudflare AI Gateway OpenAI Responses or LiteLLM OpenAI-compatible models"
    case "claude-code":
      return "Cloudflare AI Gateway or LiteLLM Anthropic Messages models"
  }
}

export function formatAgentRuntimeLabel(agentRuntime: AgentRuntime): string {
  switch (agentRuntime) {
    case "isolate":
      return "Isolate"
    case "opencode":
      return "OpenCode"
    case "codex":
      return "Codex"
    case "claude-code":
      return "Claude Code"
  }
}
