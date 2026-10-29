export const AGENT_CONTAINER_EXTERNAL_PACKAGES = [
  "@ai-sdk/harness-opencode",
  "@ai-sdk/harness-codex",
  "@ai-sdk/harness-claude-code",
] as const

export const AGENT_CONTAINER_ENTRYPOINTS = {
  opencode: "opencode.ts",
  codex: "codex.ts",
  "claude-code": "claude-code.ts",
} as const

export const AGENT_CONTAINER_IMAGE_NAMES = {
  opencode: "opencode-agent",
  codex: "codex-agent",
  "claude-code": "claude-code-agent",
} as const
