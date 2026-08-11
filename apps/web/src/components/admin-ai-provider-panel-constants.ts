export const DEFAULT_TOC_SECTION = "#litellm-provider"
export const LITELLM_PROVIDER_ID = "litellm"
export const LITELLM_PROVIDER_NAME = "LiteLLM"
export const LITELLM_ANTHROPIC_PROVIDER_ID = "litellm-anthropic"
export const LITELLM_ANTHROPIC_PROVIDER_NAME = "LiteLLM Anthropic"
export const MODEL_REGISTRY_PAGE_SIZE = 10
export const REASONING_EFFORT_VALUES = new Set<string>([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "minimal",
])
export const TOC_SECTION_VALUES = [
  "#litellm-provider",
  "#litellm-settings",
  "#litellm-model-registry",
  "#cloudflare-ai-gateway-provider",
  "#cloudflare-ai-gateway-settings",
  "#cloudflare-ai-gateway-models",
] as const

export type TocSectionValue = (typeof TOC_SECTION_VALUES)[number]
