/* oxlint-disable s0-lint/avoid-untagged-errors, s0-lint/no-call-tower, s0-lint/no-effect-call-in-effect-arg, s0-lint/no-if-statement, s0-lint/no-match-effect-branch, s0-lint/no-return-in-arrow, s0-lint/no-return-in-callback, s0-lint/no-ternary, s0-lint/prefer-option-over-null -- LiteLLM model-info normalization is a defensive external JSON boundary with compact heuristics; keeping the parser local is clearer than splitting every guard into Effect-style combinators. */
import type { S0LitellmConfig, ReasoningEffort } from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import {
  S0_CONFIG_BINDINGS,
  S0_CONFIG_KEYS,
  S0_CONFIG_LOCATIONS,
  S0ConfigStore,
  getS0DeploymentConfig,
  getS0DeploymentSecret,
} from "../db/s0-config"
import { CronRunsStore, sanitizeCronErrorMessage, type CronRunTrigger } from "../db/cron-runs"
import {
  LITELLM_AI_SDK_ADAPTERS,
  type LitellmAiSdkAdapter,
  type LitellmApiKeyPresence,
  type LitellmCatalogProvider,
  type LitellmModelDefinition,
  type LitellmModelRecord,
  type LitellmModelRegistry,
  type LitellmModelRegistryPresence,
  type LitellmProviderConfig,
  type LitellmProviderConfigPresence,
  type LitellmProviderConfigUpdate,
  type LitellmProviderSnapshot,
  type LitellmSyncResult,
} from "./litellm-types"
import { toError } from "../../lib/effect-errors"
import { parseJson } from "../../lib/json"
import type { Env } from "../types"

export const LITELLM_MODEL_SYNC_JOB_ID = "litellm-model-sync"
export const LITELLM_MODEL_SYNC_STANDARD_CRON = "0 14 * * *"
export const LITELLM_MODEL_SYNC_DST_CRON = "0 13 * * *"
export const LITELLM_MODEL_SYNC_CRONS = [
  LITELLM_MODEL_SYNC_DST_CRON,
  LITELLM_MODEL_SYNC_STANDARD_CRON,
] as const

const MODEL_INFO_PATH = "/v1/model/info"
const SUPPORTED_REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanField(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key]
  return typeof value === "boolean" ? value : null
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string"))].sort()
    : []
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && SUPPORTED_REASONING_EFFORTS.includes(value as ReasoningEffort)
}

function readReasoningEffort(value: unknown): ReasoningEffort | null {
  return isReasoningEffort(value) ? value : null
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "")
  return Match.value(trimmed.length === 0).pipe(
    Match.when(true, () => ""),
    Match.orElse(() => new URL(trimmed).toString().replace(/\/+$/, "")),
  )
}

function getStore(env: Env): S0ConfigStore {
  return new S0ConfigStore(env.S0_CONFIG, env.REPO_SECRETS_ENCRYPTION_KEY)
}

function defaultConfig(now = Date.now()): LitellmProviderConfig {
  return {
    enabled: false,
    baseUrl: "",
    defaultModel: null,
    defaultReasoningLevel: null,
    adapterOverrides: {},
    createdAt: now,
    updatedAt: now,
  }
}

function readAdapter(value: unknown): LitellmAiSdkAdapter | null {
  return typeof value === "string" && LITELLM_AI_SDK_ADAPTERS.includes(value as LitellmAiSdkAdapter)
    ? (value as LitellmAiSdkAdapter)
    : null
}

function readAdapterOverrides(value: unknown): Record<string, LitellmAiSdkAdapter> {
  return isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).flatMap(([modelId, adapter]) => {
          const normalized = readAdapter(adapter)
          return normalized ? [[modelId, normalized] as const] : []
        }),
      )
    : {}
}

function readConfig(value: Option.Option<unknown>, now = Date.now()): LitellmProviderConfig {
  return Option.getOrElse(
    Option.map(Option.filter(value, isRecord), (record) => ({
      enabled: booleanField(record, "enabled") ?? false,
      baseUrl: stringField(record, "baseUrl") ?? "",
      defaultModel: stringField(record, "defaultModel"),
      defaultReasoningLevel: readReasoningEffort(record.defaultReasoningLevel),
      adapterOverrides: readAdapterOverrides(record.adapterOverrides),
      createdAt: numberField(record, "createdAt") ?? now,
      updatedAt: numberField(record, "updatedAt") ?? now,
    })),
    () => defaultConfig(now),
  )
}

function readRegistry(value: Option.Option<unknown>): LitellmModelRegistry | null {
  return Option.getOrNull(
    Option.map(Option.filter(value, isRecord), (record) => {
      const models = isRecord(record.models) ? record.models : {}
      return {
        providerId: "litellm" as const,
        baseUrl: stringField(record, "baseUrl") ?? "",
        models: Object.fromEntries(
          Object.entries(models).flatMap(([modelId, model]) =>
            isRecord(model) ? [[modelId, readModelRecord(modelId, model)] as const] : [],
          ),
        ),
        updatedAt: numberField(record, "updatedAt") ?? 0,
      }
    }),
  )
}

function readModelRecord(modelId: string, record: Record<string, unknown>): LitellmModelRecord {
  const defaultAdapter =
    readAdapter(record.defaultAdapter) ??
    inferDefaultAdapter(modelId, stringField(record, "provider"))
  const adapterOverride = readAdapter(record.adapterOverride)
  const reasoningEfforts = stringArrayField(record, "reasoningEfforts").filter(isReasoningEffort)
  return {
    id: modelId,
    provider: stringField(record, "provider"),
    upstreamModel: stringField(record, "upstreamModel"),
    supportedOpenAIParams: stringArrayField(record, "supportedOpenAIParams"),
    supportsReasoning: booleanField(record, "supportsReasoning") ?? false,
    supportsReasoningEffort: booleanField(record, "supportsReasoningEffort") ?? false,
    supportsThinking: booleanField(record, "supportsThinking") ?? false,
    contextWindow: numberField(record, "contextWindow"),
    maxInputTokens: numberField(record, "maxInputTokens"),
    maxOutputTokens: numberField(record, "maxOutputTokens"),
    defaultAdapter,
    adapterOverride,
    aiSdkAdapter: adapterOverride ?? readAdapter(record.aiSdkAdapter) ?? defaultAdapter,
    reasoningEfforts,
    defaultReasoningLevel: readReasoningEffort(record.defaultReasoningLevel),
    updatedAt: numberField(record, "updatedAt") ?? 0,
  }
}

function providerFromModel(input: {
  modelId: string
  upstreamModel: string | null
  modelInfo: Record<string, unknown>
  litellmParams: Record<string, unknown>
  raw: Record<string, unknown>
}): string | null {
  const providers = stringArrayField(input.raw, "providers")
  const provider =
    providers[0] ??
    stringField(input.raw, "provider") ??
    stringField(input.modelInfo, "provider") ??
    stringField(input.litellmParams, "custom_llm_provider")
  return provider ?? input.upstreamModel?.split("/")[0] ?? null
}

function isOpenAIReasoningModel(modelId: string, provider: string | null): boolean {
  const normalized = `${provider ?? ""}/${modelId}`.toLowerCase()
  return /\b(gpt-[5-9]|o[1-9]|o\d|gpt-.*reasoning)/.test(normalized)
}

function isAnthropicModel(modelId: string, provider: string | null): boolean {
  const normalized = `${provider ?? ""}/${modelId}`.toLowerCase()
  return normalized.includes("anthropic") || normalized.includes("claude")
}

function isGeminiModel(modelId: string, provider: string | null): boolean {
  const normalized = `${provider ?? ""}/${modelId}`.toLowerCase()
  return (
    normalized.includes("gemini") ||
    normalized.includes("vertex_ai") ||
    normalized.includes("google")
  )
}

function inferDefaultAdapter(modelId: string, provider: string | null): LitellmAiSdkAdapter {
  return Match.value(true).pipe(
    Match.when(
      () => isAnthropicModel(modelId, provider),
      () => "@ai-sdk/anthropic" as const,
    ),
    Match.when(
      () => isOpenAIReasoningModel(modelId, provider),
      () => "@ai-sdk/openai" as const,
    ),
    Match.orElse(() => "@ai-sdk/openai-compatible" as const),
  )
}

function inferReasoningEfforts(input: {
  modelId: string
  provider: string | null
  supportsReasoning: boolean
  supportsReasoningEffort: boolean
  supportsThinking: boolean
}): ReasoningEffort[] {
  return Match.value(true).pipe(
    Match.when(
      () => isAnthropicModel(input.modelId, input.provider) && input.supportsThinking,
      () => ["high", "max"] satisfies ReasoningEffort[],
    ),
    Match.when(
      () => isGeminiModel(input.modelId, input.provider) && input.supportsReasoning,
      () => ["minimal", "low", "medium", "high"] satisfies ReasoningEffort[],
    ),
    Match.when(
      () => isOpenAIReasoningModel(input.modelId, input.provider),
      () => ["none", "low", "medium", "high", "xhigh"] satisfies ReasoningEffort[],
    ),
    Match.when(
      () => input.supportsReasoningEffort || input.supportsThinking,
      () => ["low", "medium", "high"] satisfies ReasoningEffort[],
    ),
    Match.orElse(() => [] satisfies ReasoningEffort[]),
  )
}

function defaultReasoningLevel(
  modelId: string,
  efforts: readonly ReasoningEffort[],
): ReasoningEffort | null {
  if (efforts.length === 0) return null
  if (modelId.toLowerCase().includes("nano") && efforts.includes("none")) return "none"
  if (modelId.toLowerCase().includes("lite") && efforts.includes("minimal")) return "minimal"
  if (modelId.toLowerCase().includes("mini") && efforts.includes("medium")) return "medium"
  if (efforts.includes("high")) return "high"
  return efforts[0] ?? null
}

function normalizeModelInfoEntry(
  entry: unknown,
  adapterOverrides: Record<string, LitellmAiSdkAdapter>,
  now: number,
): Option.Option<LitellmModelRecord> {
  return Option.flatMap(Option.fromNullishOr(entry), (raw) =>
    Option.map(Option.filter(Option.some(raw), isRecord), (record) => {
      const litellmParams = isRecord(record.litellm_params) ? record.litellm_params : {}
      const modelInfo = isRecord(record.model_info) ? record.model_info : {}
      const upstreamModel =
        stringField(litellmParams, "model") ??
        stringField(modelInfo, "key") ??
        stringField(modelInfo, "model")
      const modelId =
        stringField(record, "model_name") ??
        stringField(record, "model_group") ??
        stringField(modelInfo, "id") ??
        upstreamModel
      const supportedOpenAIParams = [
        ...stringArrayField(record, "supported_openai_params"),
        ...stringArrayField(modelInfo, "supported_openai_params"),
      ].sort()
      const provider = modelId
        ? providerFromModel({
            modelId,
            upstreamModel,
            modelInfo,
            litellmParams,
            raw: record,
          })
        : null
      const supportsReasoningEffort =
        supportedOpenAIParams.includes("reasoning_effort") ||
        booleanField(modelInfo, "supports_reasoning_effort") === true ||
        booleanField(record, "supports_reasoning_effort") === true
      const supportsThinking =
        supportedOpenAIParams.includes("thinking") ||
        booleanField(modelInfo, "supports_thinking") === true ||
        booleanField(record, "supports_thinking") === true
      const supportsReasoning =
        supportsReasoningEffort ||
        supportsThinking ||
        booleanField(modelInfo, "supports_reasoning") === true ||
        booleanField(record, "supports_reasoning") === true ||
        (modelId ? isOpenAIReasoningModel(modelId, provider) : false)
      const reasoningEfforts = modelId
        ? inferReasoningEfforts({
            modelId,
            provider,
            supportsReasoning,
            supportsReasoningEffort,
            supportsThinking,
          })
        : []
      const defaultAdapter = modelId
        ? inferDefaultAdapter(modelId, provider)
        : "@ai-sdk/openai-compatible"
      const adapterOverride = modelId ? (adapterOverrides[modelId] ?? null) : null

      return modelId
        ? ({
            id: modelId,
            provider,
            upstreamModel,
            supportedOpenAIParams,
            supportsReasoning,
            supportsReasoningEffort,
            supportsThinking,
            contextWindow:
              numberField(modelInfo, "context_window") ??
              numberField(modelInfo, "max_tokens") ??
              numberField(record, "context_window"),
            maxInputTokens:
              numberField(modelInfo, "max_input_tokens") ?? numberField(record, "max_input_tokens"),
            maxOutputTokens:
              numberField(modelInfo, "max_output_tokens") ??
              numberField(record, "max_output_tokens"),
            defaultAdapter,
            adapterOverride,
            aiSdkAdapter: adapterOverride ?? defaultAdapter,
            reasoningEfforts,
            defaultReasoningLevel: defaultReasoningLevel(modelId, reasoningEfforts),
            updatedAt: now,
          } satisfies LitellmModelRecord)
        : null
    }),
  ).pipe(Option.filter((record): record is LitellmModelRecord => record !== null))
}

function normalizeModelInfoResponse(
  body: unknown,
  config: LitellmProviderConfig,
  now: number,
): LitellmModelRegistry {
  const data = isRecord(body) && Array.isArray(body.data) ? body.data : []
  const models = Object.fromEntries(
    data.flatMap((entry) =>
      Option.match(normalizeModelInfoEntry(entry, config.adapterOverrides, now), {
        onNone: () => [],
        onSome: (model) => [[model.id, model] as const],
      }),
    ),
  )
  return {
    providerId: "litellm",
    baseUrl: config.baseUrl,
    models,
    updatedAt: now,
  }
}

function registryHasModel(
  registry: LitellmModelRegistry | null,
  modelId: string | null | undefined,
): boolean {
  return Boolean(modelId && registry?.models[modelId])
}

function normalizeLitellmModelId(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.replace(/^litellm(?:-anthropic)?\//, "")
}

function validateConfigSelection(
  update: LitellmProviderConfigUpdate,
  registry: LitellmModelRegistry | null,
) {
  const defaultModel = normalizeLitellmModelId(update.defaultModel)
  if (defaultModel && registry && !registryHasModel(registry, defaultModel)) {
    throw new Error(`LiteLLM model '${defaultModel}' is not available`)
  }
  if (update.defaultReasoningLevel && !readReasoningEffort(update.defaultReasoningLevel)) {
    throw new Error(`Unsupported reasoning level '${update.defaultReasoningLevel}'`)
  }
  const reasoningLevel = readReasoningEffort(update.defaultReasoningLevel)
  if (reasoningLevel && defaultModel && registry) {
    const model = registry.models[defaultModel]
    if (!model?.reasoningEfforts.includes(reasoningLevel)) {
      throw new Error(`Reasoning level '${reasoningLevel}' is not available for '${defaultModel}'`)
    }
  }
}

function normalizeAdapterOverrides(
  overrides: Record<string, string> | null | undefined,
  registry: LitellmModelRegistry | null,
): Record<string, LitellmAiSdkAdapter> {
  return Object.fromEntries(
    Object.entries(overrides ?? {}).flatMap(([modelId, adapter]) => {
      if (registry && !registry.models[modelId]) {
        throw new Error(`LiteLLM model '${modelId}' is not available`)
      }
      const normalized = readAdapter(adapter)
      if (!normalized) {
        throw new Error(`Unsupported AI SDK adapter '${adapter}'`)
      }
      return [[modelId, normalized] as const]
    }),
  )
}

function buildModelDefinition(model: LitellmModelRecord): LitellmModelDefinition {
  const limit =
    model.contextWindow || model.maxOutputTokens
      ? {
          context: model.contextWindow ?? model.maxInputTokens ?? 0,
          output: model.maxOutputTokens ?? 0,
        }
      : undefined
  const reasoning =
    model.reasoningEfforts.length > 0
      ? {
          efforts: model.reasoningEfforts,
          ...(model.defaultReasoningLevel && { default: model.defaultReasoningLevel }),
        }
      : undefined
  const provider =
    model.aiSdkAdapter === "@ai-sdk/openai" ? { npm: "@ai-sdk/openai" as const } : undefined
  const options =
    model.aiSdkAdapter === "@ai-sdk/anthropic" && model.supportsThinking
      ? {
          thinking: {
            type: "enabled",
            budgetTokens: 16000,
          },
        }
      : undefined
  return {
    name: model.id,
    ...(options && { options }),
    ...(limit && { limit }),
    ...(reasoning && { reasoning }),
    ...(provider && { provider }),
  }
}

export const getLitellmConfigWithPresence = Effect.fn("aiProviders.litellm.getConfig")(function* (
  env: Env,
) {
  const deploymentValue = getS0DeploymentConfig<S0LitellmConfig>(env, S0_CONFIG_BINDINGS.litellm)
  if (Option.isSome(deploymentValue)) {
    return {
      configured: true,
      source: "deployment" as const,
      locked: true,
      envVarName: S0_CONFIG_LOCATIONS.litellm,
      config: readConfig(deploymentValue),
    } satisfies LitellmProviderConfigPresence
  }

  const store = getStore(env)
  const value = yield* store.getJson(S0_CONFIG_KEYS.aiProviders.litellmConfig)
  return {
    configured: Option.isSome(value),
    source: Option.isSome(value) ? ("kv" as const) : ("default" as const),
    locked: false,
    envVarName: null,
    config: readConfig(value),
  } satisfies LitellmProviderConfigPresence
})

export const getLitellmModelRegistryWithPresence = Effect.fn(
  "aiProviders.litellm.getModelRegistryWithPresence",
)(function* (env: Env) {
  const value = yield* getStore(env).getJson(S0_CONFIG_KEYS.aiProviders.litellmModels)
  return {
    registry: readRegistry(value),
    source: Option.isSome(value) ? ("kv" as const) : ("none" as const),
    locked: false,
    envVarName: null,
  } satisfies LitellmModelRegistryPresence
})

export const getLitellmModelRegistry = Effect.fn("aiProviders.litellm.getModelRegistry")(function* (
  env: Env,
) {
  const { registry } = yield* getLitellmModelRegistryWithPresence(env)
  return registry
})

export const getLitellmApiKeyStatus = Effect.fn("aiProviders.litellm.getApiKeyStatus")(function* (
  env: Env,
) {
  const deploymentConfig = getS0DeploymentConfig<S0LitellmConfig>(env, S0_CONFIG_BINDINGS.litellm)
  const deploymentApiKeyReference = Option.flatMap(deploymentConfig, (config) =>
    Option.fromNullishOr(config.apiKey),
  )
  if (Option.isSome(deploymentApiKeyReference)) {
    const deploymentApiKey = getS0DeploymentSecret(env, deploymentApiKeyReference.value)
    if (Option.isNone(deploymentApiKey)) {
      return yield* Effect.die(
        new Error(
          `${deploymentApiKeyReference.value.env} is required by ${S0_CONFIG_LOCATIONS.litellm}`,
        ),
      )
    }
    return {
      configured: true,
      source: "deployment" as const,
      locked: true,
      envVarName: `${S0_CONFIG_LOCATIONS.litellm}.apiKey`,
      apiKey: Option.none<string>(),
    } satisfies LitellmApiKeyPresence
  }

  const store = getStore(env)
  const configured = yield* store.encryptedSecretConfigured(
    S0_CONFIG_KEYS.aiProviders.litellmApiKey,
  )
  return {
    configured,
    source: configured ? ("kv" as const) : ("none" as const),
    locked: false,
    envVarName: null,
    apiKey: Option.none<string>(),
  } satisfies LitellmApiKeyPresence
})

export const getLitellmApiKeyWithPresence = Effect.fn("aiProviders.litellm.getApiKeyWithPresence")(
  function* (env: Env) {
    const deploymentConfig = getS0DeploymentConfig<S0LitellmConfig>(env, S0_CONFIG_BINDINGS.litellm)
    const deploymentApiKeyReference = Option.flatMap(deploymentConfig, (config) =>
      Option.fromNullishOr(config.apiKey),
    )
    if (Option.isSome(deploymentApiKeyReference)) {
      const deploymentApiKey = getS0DeploymentSecret(env, deploymentApiKeyReference.value)
      if (Option.isNone(deploymentApiKey)) {
        return yield* Effect.die(
          new Error(
            `${deploymentApiKeyReference.value.env} is required by ${S0_CONFIG_LOCATIONS.litellm}`,
          ),
        )
      }
      return {
        configured: true,
        source: "deployment" as const,
        locked: true,
        envVarName: `${S0_CONFIG_LOCATIONS.litellm}.apiKey`,
        apiKey: deploymentApiKey,
      } satisfies LitellmApiKeyPresence
    }

    const store = getStore(env)
    const configured = yield* store.encryptedSecretConfigured(
      S0_CONFIG_KEYS.aiProviders.litellmApiKey,
    )
    if (!configured) {
      return {
        configured: false,
        source: "none" as const,
        locked: false,
        envVarName: null,
        apiKey: Option.none<string>(),
      } satisfies LitellmApiKeyPresence
    }

    const apiKey = yield* store.getEncryptedSecret(S0_CONFIG_KEYS.aiProviders.litellmApiKey)
    return {
      configured: Option.isSome(apiKey),
      source: "kv" as const,
      locked: false,
      envVarName: null,
      apiKey,
    } satisfies LitellmApiKeyPresence
  },
)

export const getLitellmApiKey = Effect.fn("aiProviders.litellm.getApiKey")(function* (env: Env) {
  const presence = yield* getLitellmApiKeyWithPresence(env)
  return presence.apiKey
})

export const updateLitellmProviderConfig = Effect.fn("aiProviders.litellm.updateProviderConfig")(
  function* (env: Env, update: LitellmProviderConfigUpdate) {
    const store = getStore(env)
    const existing = yield* getLitellmConfigWithPresence(env)
    if (existing.locked) {
      return yield* Effect.fail(
        new Error(
          `LiteLLM config is managed by ${existing.envVarName ?? "deployment configuration"}; remove it from the active stage config to edit it in Admin`,
        ),
      )
    }

    const apiKeyStatus = yield* getLitellmApiKeyStatus(env)
    const apiKey = update.apiKey?.trim()
    if (apiKey && apiKeyStatus.locked) {
      return yield* Effect.fail(
        new Error(
          `LiteLLM API key is managed by ${apiKeyStatus.envVarName ?? "deployment configuration"}; remove the apiKey reference from the active stage config to edit it in Admin`,
        ),
      )
    }

    const registry = yield* getLitellmModelRegistry(env)
    const now = Date.now()
    const config = yield* Effect.try({
      try: () => {
        const defaultModel = normalizeLitellmModelId(update.defaultModel)
        validateConfigSelection({ ...update, defaultModel }, registry)
        return {
          enabled: update.enabled,
          baseUrl: normalizeBaseUrl(update.baseUrl),
          defaultModel,
          defaultReasoningLevel: readReasoningEffort(update.defaultReasoningLevel),
          adapterOverrides: normalizeAdapterOverrides(update.adapterOverrides, registry),
          createdAt: existing.config.createdAt,
          updatedAt: now,
        } satisfies LitellmProviderConfig
      },
      catch: toError,
    })
    yield* store.putJson(S0_CONFIG_KEYS.aiProviders.litellmConfig, config)
    yield* Effect.when(
      store.setEncryptedSecret(S0_CONFIG_KEYS.aiProviders.litellmApiKey, apiKey ?? ""),
      Effect.succeed(Boolean(apiKey)),
    )
    return config
  },
)

const fetchLitellmModelInfo = Effect.fn("aiProviders.litellm.fetchModelInfo")(function* (
  config: LitellmProviderConfig,
  apiKey: string,
) {
  const url = new URL(MODEL_INFO_PATH, `${config.baseUrl}/`)
  const response = yield* Effect.tryPromise({
    try: () =>
      // oxlint-disable-next-line effect/avoid-native-fetch -- External LiteLLM proxy boundary from a Worker cron/admin action; HttpClient is not wired into this background module.
      fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      }),
    catch: toError,
  })
  const text = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: toError,
  })
  if (!response.ok) {
    return yield* Effect.fail(
      new Error(`LiteLLM model info request failed (${response.status}): ${text.slice(0, 500)}`),
    )
  }
  return yield* Effect.try({
    try: () => parseJson(text),
    catch: toError,
  })
})

const insertSyncRun = Effect.fn("aiProviders.litellm.insertSyncRun")(function* (
  env: Env,
  input: {
    cron?: string | null
    trigger: CronRunTrigger
    startedAt: number
    status: "success" | "failure" | "skipped"
    result?: Record<string, unknown>
    error?: unknown
    actorUserId?: string | null
    actorEmail?: string | null
  },
) {
  const finishedAt = Date.now()
  return yield* new CronRunsStore(env.DB).insertRun({
    jobId: LITELLM_MODEL_SYNC_JOB_ID,
    cron: input.cron ?? null,
    trigger: input.trigger,
    status: input.status,
    startedAt: input.startedAt,
    finishedAt,
    result: input.result ?? {},
    errorMessage: input.error ? sanitizeCronErrorMessage(input.error) : null,
    actorUserId: input.actorUserId ?? null,
    actorEmail: input.actorEmail ?? null,
  })
})

export const syncLitellmModels = Effect.fn("aiProviders.litellm.syncModels")(function* (
  env: Env,
  input: {
    trigger: CronRunTrigger
    cron?: string | null
    actorUserId?: string | null
    actorEmail?: string | null
  },
) {
  const startedAt = Date.now()
  const { config } = yield* getLitellmConfigWithPresence(env)

  if (!config.enabled) {
    const run = yield* insertSyncRun(env, {
      ...input,
      startedAt,
      status: "skipped",
      result: { reason: "disabled" },
    })
    return {
      status: "skipped" as const,
      models: 0,
      registryUpdatedAt: null,
      reason: "disabled",
      run,
    } satisfies LitellmSyncResult
  }

  return yield* Effect.gen(function* () {
    if (!config.baseUrl) {
      return yield* Effect.fail(new Error("LiteLLM base URL is required"))
    }
    const apiKey = yield* getLitellmApiKey(env)
    const resolvedApiKey = yield* Option.match(apiKey, {
      onNone: () => Effect.fail(new Error("LiteLLM API key is not configured")),
      onSome: Effect.succeed,
    })
    const body = yield* fetchLitellmModelInfo(config, resolvedApiKey)
    const now = Date.now()
    const registry = normalizeModelInfoResponse(body, config, now)
    yield* getStore(env).putJson(S0_CONFIG_KEYS.aiProviders.litellmModels, registry)
    const run = yield* insertSyncRun(env, {
      ...input,
      startedAt,
      status: "success",
      result: {
        models: Object.keys(registry.models).length,
        registryUpdatedAt: registry.updatedAt,
      },
    })
    return {
      status: "success" as const,
      models: Object.keys(registry.models).length,
      registryUpdatedAt: registry.updatedAt,
      run,
    } satisfies LitellmSyncResult
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        const run = yield* insertSyncRun(env, {
          ...input,
          startedAt,
          status: "failure",
          result: {},
          error,
        })
        return {
          status: "failure" as const,
          models: 0,
          registryUpdatedAt: null,
          reason: sanitizeCronErrorMessage(error),
          run,
        } satisfies LitellmSyncResult
      }),
    ),
  )
})

export const getLitellmProviderSnapshot = Effect.fn("aiProviders.litellm.getProviderSnapshot")(
  function* (env: Env) {
    const [configPresence, registryPresence, apiKeyStatus, cronStatus] = yield* Effect.all(
      [
        getLitellmConfigWithPresence(env),
        getLitellmModelRegistryWithPresence(env),
        getLitellmApiKeyStatus(env),
        new CronRunsStore(env.DB).getJobStatus(LITELLM_MODEL_SYNC_JOB_ID),
      ],
      { concurrency: "unbounded" },
    )
    return {
      configured: configPresence.configured,
      apiKeyConfigured: apiKeyStatus.configured,
      configSource: configPresence.source,
      configLocked: configPresence.locked,
      configEnvVarName: configPresence.envVarName,
      apiKeySource: apiKeyStatus.source,
      apiKeyLocked: apiKeyStatus.locked,
      apiKeyEnvVarName: apiKeyStatus.envVarName,
      registrySource: registryPresence.source,
      registryLocked: registryPresence.locked,
      registryEnvVarName: registryPresence.envVarName,
      config: configPresence.config,
      registry: registryPresence.registry,
      cronStatus,
    } satisfies LitellmProviderSnapshot
  },
)

export const buildLitellmCatalogProviders = Effect.fn("aiProviders.litellm.buildCatalogProviders")(
  function* (env: Env) {
    const [{ configured, config }, registry, apiKey] = yield* Effect.all(
      [getLitellmConfigWithPresence(env), getLitellmModelRegistry(env), getLitellmApiKey(env)],
      { concurrency: "unbounded" },
    )
    if (!configured || !config.enabled || !registry || Object.keys(registry.models).length === 0) {
      return Option.none<{
        defaultModel: string | null
        providers: LitellmCatalogProvider[]
      }>()
    }
    const resolvedApiKey = Option.getOrNull(apiKey)
    const litellmModels = Object.fromEntries(
      Object.entries(registry.models).flatMap(([modelId, model]) =>
        model.aiSdkAdapter === "@ai-sdk/anthropic"
          ? []
          : [[modelId, buildModelDefinition(model)] as const],
      ),
    )
    const anthropicModels = Object.fromEntries(
      Object.entries(registry.models).flatMap(([modelId, model]) =>
        model.aiSdkAdapter === "@ai-sdk/anthropic"
          ? [[modelId, buildModelDefinition(model)] as const]
          : [],
      ),
    )
    const providers: LitellmCatalogProvider[] = [
      {
        provider: {
          providerId: "litellm",
          name: "LiteLLM",
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: config.baseUrl,
            timeout: 600000,
            includeUsage: true,
          },
          models: litellmModels,
        },
        apiKey: resolvedApiKey,
      },
      {
        provider: {
          providerId: "litellm-anthropic",
          name: "LiteLLM Anthropic",
          npm: "@ai-sdk/anthropic",
          options: {
            baseURL: `${config.baseUrl}/anthropic/v1`,
          },
          models: anthropicModels,
        },
        apiKey: resolvedApiKey,
      },
    ].filter((entry) => Object.keys(entry.provider.models).length > 0)
    const defaultProvider = providers.find(
      (entry) => config.defaultModel && entry.provider.models[config.defaultModel],
    )

    return Option.some({
      defaultModel:
        config.defaultModel && defaultProvider
          ? `${defaultProvider.provider.providerId}/${config.defaultModel}`
          : null,
      providers,
    })
  },
)

export function isNineAmAmericaNewYork(date: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const hour = parts.find((part) => part.type === "hour")?.value
  const minute = parts.find((part) => part.type === "minute")?.value
  return hour === "09" && minute === "00"
}

export const runScheduledLitellmSync = Effect.fn("aiProviders.litellm.runScheduledSync")(function* (
  env: Env,
  input: { cron: string; scheduledTime: number },
) {
  if (!isNineAmAmericaNewYork(new Date(input.scheduledTime))) {
    const startedAt = Date.now()
    const run = yield* insertSyncRun(env, {
      trigger: "scheduled",
      cron: input.cron,
      startedAt,
      status: "skipped",
      result: { reason: "not_9am_america_new_york", scheduledTime: input.scheduledTime },
    })
    return {
      status: "skipped" as const,
      models: 0,
      registryUpdatedAt: null,
      reason: "not_9am_america_new_york",
      run,
    } satisfies LitellmSyncResult
  }
  return yield* syncLitellmModels(env, { trigger: "scheduled", cron: input.cron })
})
