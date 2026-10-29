import type { ReasoningEffort } from "@solzero/shared"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as P from "effect/Predicate"
import {
  LITELLM_AI_SDK_ADAPTERS,
  type LitellmAiSdkAdapter,
  type LitellmModelDefinition,
  type LitellmModelRecord,
  type LitellmModelRegistry,
  type LitellmProviderConfig,
  type LitellmProviderConfigUpdate,
} from "./litellm-types"

// Readers and normalizers for the LiteLLM config, the stored model registry, and the LiteLLM
// /v1/model/info response. These values are untrusted JSON from KV, deployment config, and the proxy.

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

function fail(message: string): never {
  throw new Error(message)
}

// Validation inside Effect.try: a thrown Error becomes the try failure.
function rejectWhen(condition: boolean, message: string): void {
  Match.value(condition).pipe(
    Match.when(true, () => fail(message)),
    Match.orElse(() => undefined),
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return Match.value(value).pipe(
    Match.when(isRecord, (record) => record),
    Match.orElse(() => ({})),
  )
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return asRecord(record[key])
}

function stringField(record: Record<string, unknown>, key: string): Option.Option<string> {
  return Option.liftPredicate(record[key], P.isString).pipe(
    Option.map((value) => value.trim()),
    Option.filter((value) => value.length > 0),
  )
}

function numberField(record: Record<string, unknown>, key: string): Option.Option<number> {
  return Option.liftPredicate(
    record[key],
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  )
}

function booleanField(record: Record<string, unknown>, key: string): Option.Option<boolean> {
  return Option.liftPredicate(record[key], P.isBoolean)
}

function flagSet(records: readonly Record<string, unknown>[], key: string): boolean {
  return records.some((record) => Option.exists(booleanField(record, key), (value) => value))
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  return Match.value(record[key]).pipe(
    Match.when(Array.isArray, (value: unknown[]) => [...new Set(value.filter(P.isString))].sort()),
    Match.orElse((): string[] => []),
  )
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    typeof value === "string" &&
    SUPPORTED_REASONING_EFFORTS.includes(
      /* SAFETY: value has the ReasoningEffort shape established by the check or writer around this read. */ value as ReasoningEffort,
    )
  )
}

export function readReasoningEffort(value: unknown): Option.Option<ReasoningEffort> {
  return Option.liftPredicate(value, isReasoningEffort)
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "")

  return Match.value(trimmed.length === 0).pipe(
    Match.when(true, () => ""),
    Match.orElse(() => new URL(trimmed).toString().replace(/\/+$/, "")),
  )
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

function isAdapter(value: unknown): value is LitellmAiSdkAdapter {
  // SAFETY: LITELLM_AI_SDK_ADAPTERS lists every LitellmAiSdkAdapter, so a member of that list is that union.
  return typeof value === "string" && LITELLM_AI_SDK_ADAPTERS.includes(value as LitellmAiSdkAdapter)
}

function readAdapter(value: unknown): Option.Option<LitellmAiSdkAdapter> {
  return Option.liftPredicate(value, isAdapter)
}

function readAdapterOverrides(value: unknown): Record<string, LitellmAiSdkAdapter> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).flatMap(([modelId, adapter]) =>
      Option.match(readAdapter(adapter), {
        onNone: () => [],
        onSome: (normalized) => [[modelId, normalized] as const],
      }),
    ),
  )
}

export function readConfig(value: Option.Option<unknown>, now = Date.now()): LitellmProviderConfig {
  return Option.getOrElse(
    Option.map(Option.filter(value, isRecord), (record) => ({
      enabled: Option.getOrElse(booleanField(record, "enabled"), () => false),
      baseUrl: Option.getOrElse(stringField(record, "baseUrl"), () => ""),
      defaultModel: Option.getOrNull(stringField(record, "defaultModel")),
      defaultReasoningLevel: Option.getOrNull(readReasoningEffort(record.defaultReasoningLevel)),
      adapterOverrides: readAdapterOverrides(record.adapterOverrides),
      createdAt: Option.getOrElse(numberField(record, "createdAt"), () => now),
      updatedAt: Option.getOrElse(numberField(record, "updatedAt"), () => now),
    })),
    () => defaultConfig(now),
  )
}

function registryFromRecord(record: Record<string, unknown>): LitellmModelRegistry {
  const models = Object.entries(recordField(record, "models")).flatMap(([modelId, model]) =>
    Match.value(model).pipe(
      Match.when(isRecord, (modelRecord) => [
        [modelId, readModelRecord(modelId, modelRecord)] as const,
      ]),
      Match.orElse(() => []),
    ),
  )

  return {
    providerId: "litellm",
    baseUrl: Option.getOrElse(stringField(record, "baseUrl"), () => ""),
    models: Object.fromEntries(models),
    updatedAt: Option.getOrElse(numberField(record, "updatedAt"), () => 0),
  }
}

export function readRegistry(value: Option.Option<unknown>): Option.Option<LitellmModelRegistry> {
  return Option.map(Option.filter(value, isRecord), registryFromRecord)
}

function readModelRecord(modelId: string, record: Record<string, unknown>): LitellmModelRecord {
  const provider = Option.getOrNull(stringField(record, "provider"))

  const defaultAdapter = Option.getOrElse(readAdapter(record.defaultAdapter), () =>
    inferDefaultAdapter(modelId, provider),
  )

  const adapterOverride = readAdapter(record.adapterOverride)

  const aiSdkAdapter = adapterOverride.pipe(
    Option.orElse(() => readAdapter(record.aiSdkAdapter)),
    Option.getOrElse(() => defaultAdapter),
  )

  const reasoningEfforts = stringArrayField(record, "reasoningEfforts").filter(isReasoningEffort)

  return {
    id: modelId,
    provider,
    upstreamModel: Option.getOrNull(stringField(record, "upstreamModel")),
    supportedOpenAIParams: stringArrayField(record, "supportedOpenAIParams"),
    supportsReasoning: Option.getOrElse(booleanField(record, "supportsReasoning"), () => false),
    supportsReasoningEffort: Option.getOrElse(
      booleanField(record, "supportsReasoningEffort"),
      () => false,
    ),
    supportsThinking: Option.getOrElse(booleanField(record, "supportsThinking"), () => false),
    contextWindow: Option.getOrNull(numberField(record, "contextWindow")),
    maxInputTokens: Option.getOrNull(numberField(record, "maxInputTokens")),
    maxOutputTokens: Option.getOrNull(numberField(record, "maxOutputTokens")),
    defaultAdapter,
    adapterOverride: Option.getOrNull(adapterOverride),
    aiSdkAdapter,
    reasoningEfforts,
    defaultReasoningLevel: Option.getOrNull(readReasoningEffort(record.defaultReasoningLevel)),
    updatedAt: Option.getOrElse(numberField(record, "updatedAt"), () => 0),
  }
}

function providerFromModel(input: {
  upstreamModel: Option.Option<string>
  modelInfo: Record<string, unknown>
  litellmParams: Record<string, unknown>
  raw: Record<string, unknown>
}): Option.Option<string> {
  return Option.fromNullishOr(stringArrayField(input.raw, "providers")[0]).pipe(
    Option.orElse(() => stringField(input.raw, "provider")),
    Option.orElse(() => stringField(input.modelInfo, "provider")),
    Option.orElse(() => stringField(input.litellmParams, "custom_llm_provider")),
    Option.orElse(() =>
      Option.flatMap(input.upstreamModel, (model) => Option.fromNullishOr(model.split("/")[0])),
    ),
  )
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

function preferredEffort(
  modelId: string,
  efforts: readonly ReasoningEffort[],
  marker: string,
  effort: ReasoningEffort,
): Option.Option<ReasoningEffort> {
  return Option.liftPredicate(
    effort,
    (candidate) => modelId.includes(marker) && efforts.includes(candidate),
  )
}

function defaultReasoningLevel(
  modelId: string,
  efforts: readonly ReasoningEffort[],
): Option.Option<ReasoningEffort> {
  const normalized = modelId.toLowerCase()

  return preferredEffort(normalized, efforts, "nano", "none").pipe(
    Option.orElse(() => preferredEffort(normalized, efforts, "lite", "minimal")),
    Option.orElse(() => preferredEffort(normalized, efforts, "mini", "medium")),
    Option.orElse(() => preferredEffort(normalized, efforts, "", "high")),
    Option.orElse(() => Option.fromNullishOr(efforts[0])),
  )
}

function buildModelInfoRecord(input: {
  modelId: string
  record: Record<string, unknown>
  modelInfo: Record<string, unknown>
  litellmParams: Record<string, unknown>
  upstreamModel: Option.Option<string>
  adapterOverrides: Record<string, LitellmAiSdkAdapter>
  now: number
}): LitellmModelRecord {
  const { modelId, record, modelInfo } = input
  const sources = [modelInfo, record]

  const supportedOpenAIParams = [
    ...stringArrayField(record, "supported_openai_params"),
    ...stringArrayField(modelInfo, "supported_openai_params"),
  ].sort()

  const provider = Option.getOrNull(
    providerFromModel({
      upstreamModel: input.upstreamModel,
      modelInfo,
      litellmParams: input.litellmParams,
      raw: record,
    }),
  )

  const supportsReasoningEffort =
    supportedOpenAIParams.includes("reasoning_effort") ||
    flagSet(sources, "supports_reasoning_effort")

  const supportsThinking =
    supportedOpenAIParams.includes("thinking") || flagSet(sources, "supports_thinking")

  const supportsReasoning =
    supportsReasoningEffort ||
    supportsThinking ||
    flagSet(sources, "supports_reasoning") ||
    isOpenAIReasoningModel(modelId, provider)

  const reasoningEfforts = inferReasoningEfforts({
    modelId,
    provider,
    supportsReasoning,
    supportsReasoningEffort,
    supportsThinking,
  })

  const defaultAdapter = inferDefaultAdapter(modelId, provider)
  const adapterOverride = Option.fromNullishOr(input.adapterOverrides[modelId])

  const contextWindow = numberField(modelInfo, "context_window").pipe(
    Option.orElse(() => numberField(modelInfo, "max_tokens")),
    Option.orElse(() => numberField(record, "context_window")),
  )

  const maxInputTokens = numberField(modelInfo, "max_input_tokens").pipe(
    Option.orElse(() => numberField(record, "max_input_tokens")),
  )

  const maxOutputTokens = numberField(modelInfo, "max_output_tokens").pipe(
    Option.orElse(() => numberField(record, "max_output_tokens")),
  )

  return {
    id: modelId,
    provider,
    upstreamModel: Option.getOrNull(input.upstreamModel),
    supportedOpenAIParams,
    supportsReasoning,
    supportsReasoningEffort,
    supportsThinking,
    contextWindow: Option.getOrNull(contextWindow),
    maxInputTokens: Option.getOrNull(maxInputTokens),
    maxOutputTokens: Option.getOrNull(maxOutputTokens),
    defaultAdapter,
    adapterOverride: Option.getOrNull(adapterOverride),
    aiSdkAdapter: Option.getOrElse(adapterOverride, () => defaultAdapter),
    reasoningEfforts,
    defaultReasoningLevel: Option.getOrNull(defaultReasoningLevel(modelId, reasoningEfforts)),
    updatedAt: input.now,
  }
}

function modelInfoRecord(
  record: Record<string, unknown>,
  adapterOverrides: Record<string, LitellmAiSdkAdapter>,
  now: number,
): Option.Option<LitellmModelRecord> {
  const litellmParams = recordField(record, "litellm_params")
  const modelInfo = recordField(record, "model_info")

  const upstreamModel = stringField(litellmParams, "model").pipe(
    Option.orElse(() => stringField(modelInfo, "key")),
    Option.orElse(() => stringField(modelInfo, "model")),
  )

  const modelId = stringField(record, "model_name").pipe(
    Option.orElse(() => stringField(record, "model_group")),
    Option.orElse(() => stringField(modelInfo, "id")),
    Option.orElse(() => upstreamModel),
  )

  return Option.map(modelId, (id) =>
    buildModelInfoRecord({
      modelId: id,
      record,
      modelInfo,
      litellmParams,
      upstreamModel,
      adapterOverrides,
      now,
    }),
  )
}

function normalizeModelInfoEntry(
  entry: unknown,
  adapterOverrides: Record<string, LitellmAiSdkAdapter>,
  now: number,
): Option.Option<LitellmModelRecord> {
  return Option.liftPredicate(entry, isRecord).pipe(
    Option.flatMap((record) => modelInfoRecord(record, adapterOverrides, now)),
  )
}

export function normalizeModelInfoResponse(
  body: unknown,
  config: LitellmProviderConfig,
  now: number,
): LitellmModelRegistry {
  const data = Option.liftPredicate(body, isRecord).pipe(
    Option.map((record) => record.data),
    Option.filter(Array.isArray),
    Option.getOrElse((): unknown[] => []),
  )

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

function normalizeLitellmModelId(value: string | null | undefined): Option.Option<string> {
  return Option.fromNullishOr(value).pipe(
    Option.map((modelId) => modelId.trim()),
    Option.filter((modelId) => modelId.length > 0),
    Option.map((modelId) => modelId.replace(/^litellm(?:-anthropic)?\//, "")),
  )
}

function validateConfigSelection(
  update: LitellmProviderConfigUpdate,
  registry: LitellmModelRegistry | null,
): void {
  const defaultModel = normalizeLitellmModelId(update.defaultModel).pipe(
    Option.filter((modelId) => modelId.length > 0),
  )

  const reasoningLevel = readReasoningEffort(update.defaultReasoningLevel)

  Option.map(defaultModel, (modelId) =>
    rejectWhen(
      registry !== null && !registryHasModel(registry, modelId),
      `LiteLLM model '${modelId}' is not available`,
    ),
  )
  rejectWhen(
    Boolean(update.defaultReasoningLevel) && Option.isNone(reasoningLevel),
    `Unsupported reasoning level '${String(update.defaultReasoningLevel)}'`,
  )
  Option.all([reasoningLevel, defaultModel, Option.fromNullishOr(registry)]).pipe(
    Option.map(([level, modelId, models]) =>
      rejectWhen(
        !(models.models[modelId]?.reasoningEfforts.includes(level) ?? false),
        `Reasoning level '${level}' is not available for '${modelId}'`,
      ),
    ),
  )
}

function normalizeAdapterOverride(
  modelId: string,
  adapter: string,
  registry: LitellmModelRegistry | null,
): readonly [string, LitellmAiSdkAdapter] {
  rejectWhen(
    registry !== null && !registry.models[modelId],
    `LiteLLM model '${modelId}' is not available`,
  )

  return [
    modelId,
    Option.getOrElse(readAdapter(adapter), () => fail(`Unsupported AI SDK adapter '${adapter}'`)),
  ] as const
}

function normalizeAdapterOverrides(
  overrides: Record<string, string> | null | undefined,
  registry: LitellmModelRegistry | null,
): Record<string, LitellmAiSdkAdapter> {
  return Object.fromEntries(
    Object.entries(overrides ?? {}).map(([modelId, adapter]) =>
      normalizeAdapterOverride(modelId, adapter, registry),
    ),
  )
}

function modelLimit(model: LitellmModelRecord) {
  return Match.value(Boolean(model.contextWindow || model.maxOutputTokens)).pipe(
    Match.when(true, () => ({
      limit: {
        context: model.contextWindow ?? model.maxInputTokens ?? 0,
        output: model.maxOutputTokens ?? 0,
      },
    })),
    Match.orElse(() => ({})),
  )
}

function modelReasoning(model: LitellmModelRecord) {
  const defaultLevel = Option.match(Option.fromNullishOr(model.defaultReasoningLevel), {
    onNone: () => ({}),
    onSome: (level) => ({ default: level }),
  })

  return Match.value(model.reasoningEfforts.length > 0).pipe(
    Match.when(true, () => ({ reasoning: { efforts: model.reasoningEfforts, ...defaultLevel } })),
    Match.orElse(() => ({})),
  )
}

function modelProvider(model: LitellmModelRecord) {
  return Match.value(model.aiSdkAdapter).pipe(
    Match.when("@ai-sdk/openai", () => ({ provider: { npm: "@ai-sdk/openai" as const } })),
    Match.orElse(() => ({})),
  )
}

function modelOptions(model: LitellmModelRecord) {
  return Match.value(model.aiSdkAdapter === "@ai-sdk/anthropic" && model.supportsThinking).pipe(
    Match.when(true, () => ({
      options: {
        thinking: {
          type: "enabled",
          budgetTokens: 16000,
        },
      },
    })),
    Match.orElse(() => ({})),
  )
}

export function buildModelDefinition(model: LitellmModelRecord): LitellmModelDefinition {
  return {
    name: model.id,
    ...modelOptions(model),
    ...modelLimit(model),
    ...modelReasoning(model),
    ...modelProvider(model),
  }
}

export function buildProviderConfig(
  update: LitellmProviderConfigUpdate,
  registry: LitellmModelRegistry | null,
  createdAt: number,
  now: number,
): LitellmProviderConfig {
  const defaultModel = Option.getOrNull(normalizeLitellmModelId(update.defaultModel))
  validateConfigSelection({ ...update, defaultModel }, registry)

  return {
    enabled: update.enabled,
    baseUrl: normalizeBaseUrl(update.baseUrl),
    defaultModel,
    defaultReasoningLevel: Option.getOrNull(readReasoningEffort(update.defaultReasoningLevel)),
    adapterOverrides: normalizeAdapterOverrides(update.adapterOverrides, registry),
    createdAt,
    updatedAt: now,
  }
}
