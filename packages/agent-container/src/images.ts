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
    "ghcr.io/solzeroai/opencode-agent@sha256:274c3c937ab591a4a51328e51114813319e64d989219dc3b60fead40f0bb4f5d",
  codex:
    "ghcr.io/solzeroai/codex-agent@sha256:47917ce67e5adb1db8e74bbebb9558fea59a7c84e8e2caf507b793a3373ec223",
  "claude-code":
    "ghcr.io/solzeroai/claude-code-agent@sha256:3b18a6a120e1d0dd6db9145f99ffb627c4260f3dfd58a906ca8ce50f93edbcc0",
} as const
