import {
  type ProviderModelDefinition,
  type ReasoningEffort,
  type SharedProviderDefinition,
} from "@c0-agent/shared"
import * as Option from "effect/Option"
import type { CronJobStatus, CronRunRecord } from "../db/cron-runs"

export const LITELLM_AI_SDK_ADAPTERS = [
  "@ai-sdk/openai",
  "@ai-sdk/anthropic",
  "@ai-sdk/openai-compatible",
] as const

export type LitellmAiSdkAdapter = (typeof LITELLM_AI_SDK_ADAPTERS)[number]

export interface LitellmProviderConfig {
  enabled: boolean
  baseUrl: string
  defaultModel: string | null
  defaultReasoningLevel: ReasoningEffort | null
  adapterOverrides: Record<string, LitellmAiSdkAdapter>
  createdAt: number
  updatedAt: number
}

export interface LitellmProviderConfigUpdate {
  enabled: boolean
  baseUrl: string
  defaultModel?: string | null
  defaultReasoningLevel?: ReasoningEffort | string | null
  adapterOverrides?: Record<string, string> | null
  apiKey?: string | null
}

export interface LitellmModelRecord {
  id: string
  provider: string | null
  upstreamModel: string | null
  supportedOpenAIParams: string[]
  supportsReasoning: boolean
  supportsReasoningEffort: boolean
  supportsThinking: boolean
  contextWindow: number | null
  maxInputTokens: number | null
  maxOutputTokens: number | null
  defaultAdapter: LitellmAiSdkAdapter
  adapterOverride: LitellmAiSdkAdapter | null
  aiSdkAdapter: LitellmAiSdkAdapter
  reasoningEfforts: ReasoningEffort[]
  defaultReasoningLevel: ReasoningEffort | null
  updatedAt: number
}

export interface LitellmModelRegistry {
  providerId: "litellm"
  baseUrl: string
  models: Record<string, LitellmModelRecord>
  updatedAt: number
}

export type LitellmConfigSource = "default" | "deployment" | "kv"
export type LitellmSecretSource = "deployment" | "kv" | "none"
export type LitellmRegistrySource = "kv" | "none"

export interface LitellmProviderConfigPresence {
  configured: boolean
  source: LitellmConfigSource
  locked: boolean
  envVarName: string | null
  config: LitellmProviderConfig
}

export interface LitellmApiKeyPresence {
  configured: boolean
  source: LitellmSecretSource
  locked: boolean
  envVarName: string | null
  apiKey: Option.Option<string>
}

export interface LitellmModelRegistryPresence {
  registry: LitellmModelRegistry | null
  source: LitellmRegistrySource
  locked: boolean
  envVarName: string | null
}

export interface LitellmProviderSnapshot {
  configured: boolean
  apiKeyConfigured: boolean
  configSource: LitellmConfigSource
  configLocked: boolean
  configEnvVarName: string | null
  apiKeySource: LitellmSecretSource
  apiKeyLocked: boolean
  apiKeyEnvVarName: string | null
  registrySource: LitellmRegistrySource
  registryLocked: boolean
  registryEnvVarName: string | null
  config: LitellmProviderConfig
  registry: LitellmModelRegistry | null
  cronStatus: CronJobStatus
}

export interface LitellmSyncResult {
  status: "success" | "failure" | "skipped"
  models: number
  registryUpdatedAt: number | null
  reason?: string
  run: CronRunRecord
}

export interface LitellmProviderConfigExport {
  dotenv: string
  variableCount: number
  includesSecret: boolean
  includesRegistry: boolean
}

export interface LitellmCatalogProvider {
  provider: SharedProviderDefinition
  apiKey: string | null
}

export type LitellmModelDefinition = ProviderModelDefinition
