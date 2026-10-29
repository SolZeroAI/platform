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

/** Prebuilt linux/amd64 images. Release CI publishes these digests to GHCR. */
export const AGENT_CONTAINER_IMAGES = {
  opencode:
    "ghcr.io/solzeroai/opencode-agent@sha256:257bd9cd440441d322a33daba38d8b0f9a064da968db48fcc39b4b2cc2e60dc8",
  codex:
    "ghcr.io/solzeroai/codex-agent@sha256:aba9e68a0ad535c054d603673b5d570b1f4f0779fa821fadc435aaaca4355c30",
  "claude-code":
    "ghcr.io/solzeroai/claude-code-agent@sha256:00f0e3ea3340d9760c605f6c5d5c8cd09c70949428cb310f8193a89a600cd8d6",
} as const
