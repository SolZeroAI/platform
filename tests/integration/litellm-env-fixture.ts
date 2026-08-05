import type {
  LitellmModelRegistry,
  LitellmProviderConfig,
} from "../../packages/api/src/server/background/ai-providers/litellm-types"
import {
  S0_CONFIG_BINDINGS,
  S0_CONFIG_KEYS,
} from "../../packages/api/src/server/background/db/s0-config"

const FIXTURE_NOW = 123
const DEFAULT_BASE_URL = "https://litellm.example.com"
const DEFAULT_API_KEY = "real-shared-litellm-key"

class MemoryLitellmKVNamespace {
  readonly values = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async put(key: string, value: string) {
    this.values.set(key, value)
  }

  async delete(key: string) {
    this.values.delete(key)
  }
}

export function createLitellmDeploymentEnv(
  options: {
    apiKey?: string
    baseUrl?: string
    defaultModel?: string | null
  } = {},
): Record<string, unknown> {
  const apiKey = options.apiKey ?? DEFAULT_API_KEY
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
  const defaultModel = options.defaultModel === undefined ? "gpt-5.4-mini" : options.defaultModel
  const apiKeyEnv = "TEST_LITELLM_API_KEY"
  const s0Config = new MemoryLitellmKVNamespace()
  s0Config.values.set(
    S0_CONFIG_KEYS.aiProviders.litellmModels,
    JSON.stringify(createLitellmModelRegistry({ baseUrl })),
  )

  return {
    S0_CONFIG: s0Config,
    [S0_CONFIG_BINDINGS.litellm]: {
      ...createLitellmProviderConfig({ baseUrl, defaultModel }),
      apiKey: { env: apiKeyEnv },
    },
    [apiKeyEnv]: apiKey,
  }
}

export function createLitellmProviderConfig(input: {
  baseUrl: string
  defaultModel: string | null
}): LitellmProviderConfig {
  return {
    enabled: true,
    baseUrl: input.baseUrl,
    defaultModel: input.defaultModel,
    defaultReasoningLevel: "medium",
    adapterOverrides: {},
    createdAt: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW,
  }
}

export function createLitellmModelRegistry(input: { baseUrl: string }): LitellmModelRegistry {
  return {
    providerId: "litellm",
    baseUrl: input.baseUrl,
    models: {
      "gpt-5.4-mini": {
        id: "gpt-5.4-mini",
        provider: "openai",
        upstreamModel: "openai/gpt-5.4-mini",
        supportedOpenAIParams: ["reasoning_effort"],
        supportsReasoning: true,
        supportsReasoningEffort: true,
        supportsThinking: false,
        contextWindow: 128000,
        maxInputTokens: 128000,
        maxOutputTokens: 8192,
        defaultAdapter: "@ai-sdk/openai",
        adapterOverride: null,
        aiSdkAdapter: "@ai-sdk/openai",
        reasoningEfforts: ["none", "low", "medium", "high", "xhigh"],
        defaultReasoningLevel: "medium",
        updatedAt: FIXTURE_NOW,
      },
      "gemini-3.1-pro-preview": {
        id: "gemini-3.1-pro-preview",
        provider: "gemini",
        upstreamModel: "gemini/gemini-3.1-pro-preview",
        supportedOpenAIParams: ["thinking"],
        supportsReasoning: true,
        supportsReasoningEffort: false,
        supportsThinking: true,
        contextWindow: 1048576,
        maxInputTokens: 1048576,
        maxOutputTokens: 65536,
        defaultAdapter: "@ai-sdk/openai-compatible",
        adapterOverride: null,
        aiSdkAdapter: "@ai-sdk/openai-compatible",
        reasoningEfforts: ["low", "medium", "high"],
        defaultReasoningLevel: "high",
        updatedAt: FIXTURE_NOW,
      },
    },
    updatedAt: FIXTURE_NOW,
  }
}
