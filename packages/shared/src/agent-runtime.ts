export const AGENT_RUNTIMES = ["isolate", "opencode", "codex", "claude-code"] as const

export type AgentRuntime = (typeof AGENT_RUNTIMES)[number]

export type SessionKind = "isolate" | "sandbox"

const AGENT_RUNTIME_VALUES: readonly string[] = AGENT_RUNTIMES

function isAgentRuntime(value: unknown): value is AgentRuntime {
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

const PROVIDER_COMPATIBILITY: Record<
  AgentRuntime,
  (providerId: string, providerApi: string | undefined) => boolean
> = {
  isolate: () => true,
  opencode: (providerId, providerApi) =>
    providerId === "litellm" ||
    providerId === "litellm-anthropic" ||
    (providerId === "cloudflare-ai-gateway" &&
      (providerApi === "responses" ||
        providerApi === "chat_completions" ||
        providerApi === "messages")),
  codex: (providerId, providerApi) =>
    providerId === "litellm" ||
    (providerId === "cloudflare-ai-gateway" && providerApi === "responses"),
  "claude-code": (providerId, providerApi) =>
    providerId === "litellm-anthropic" ||
    (providerId === "cloudflare-ai-gateway" && providerApi === "messages"),
}

const MODEL_COMPATIBILITY_DESCRIPTIONS: Record<AgentRuntime, string> = {
  isolate: "any configured model",
  opencode: "Cloudflare AI Gateway or LiteLLM models",
  codex: "Cloudflare AI Gateway OpenAI Responses or LiteLLM OpenAI-compatible models",
  "claude-code": "Cloudflare AI Gateway or LiteLLM Anthropic Messages models",
}

const AGENT_RUNTIME_LABELS: Record<AgentRuntime, string> = {
  isolate: "Isolate",
  opencode: "OpenCode",
  codex: "Codex",
  "claude-code": "Claude Code",
}

export function isAgentRuntimeCompatibleWithProvider(
  agentRuntime: AgentRuntime,
  providerId: string,
  providerApi?: string,
): boolean {
  return PROVIDER_COMPATIBILITY[agentRuntime](providerId, providerApi)
}

export function describeAgentRuntimeModelCompatibility(agentRuntime: AgentRuntime): string {
  return MODEL_COMPATIBILITY_DESCRIPTIONS[agentRuntime]
}

export function formatAgentRuntimeLabel(agentRuntime: AgentRuntime): string {
  return AGENT_RUNTIME_LABELS[agentRuntime]
}
