/**
 * Centralized model definitions and reasoning configuration.
 */

import * as Match from "effect/Match"
import * as Option from "effect/Option"
import {
  buildModelId,
  buildRuntimeModelOptions,
  findModelDisplayName,
  getModelReasoningConfig as getCatalogReasoningConfig,
  SHARED_PROVIDER_CATALOG,
  type ModelReasoningConfig,
  type ReasoningEffort,
} from "./provider-config"

/**
 * Valid model names supported by the system.
 * All models use "provider/model" format.
 */
export const VALID_MODELS = SHARED_PROVIDER_CATALOG.flatMap((provider) =>
  Object.keys(provider.models).map((modelId) => buildModelId(provider.providerId, modelId)),
)

/**
 * Per-model reasoning configuration.
 */
export const MODEL_REASONING_CONFIG: Partial<Record<string, ModelReasoningConfig>> =
  Object.fromEntries(
    SHARED_PROVIDER_CATALOG.flatMap((provider) =>
      Object.entries(provider.models)
        .filter(([, model]) => model.reasoning)
        .map(([modelId, model]) => [buildModelId(provider.providerId, modelId), model.reasoning]),
    ),
  )

export interface ModelDisplayInfo {
  id: string
  name: string
  description: string
}

export interface ModelCategory {
  category: string
  models: ModelDisplayInfo[]
}

/**
 * Model options grouped by provider, for use in UI dropdowns.
 */
export const MODEL_OPTIONS: ModelCategory[] = buildRuntimeModelOptions(SHARED_PROVIDER_CATALOG).map(
  (group) => ({
    category: group.category,
    models: group.models.map((model) => ({
      id: model.id,
      name: model.name,
      description: model.description,
    })),
  }),
)

/**
 * Normalize a model ID to canonical "provider/model" format.
 */
export function normalizeModelId(modelId: string): string {
  return Match.value(modelId).pipe(
    Match.when(
      (id) => id.includes("/"),
      (id) => id,
    ),
    Match.when(
      (id) => id.startsWith("claude-"),
      (id) => `anthropic/${id}`,
    ),
    Match.orElse((id) => id),
  )
}

/**
 * Check if a model name is valid.
 */
export function isValidModel(model: string): boolean {
  return VALID_MODELS.includes(normalizeModelId(model))
}

/**
 * Check if a model supports reasoning controls.
 */
export function supportsReasoning(model: string): boolean {
  return Option.isSome(getReasoningConfig(model))
}

/**
 * Get reasoning configuration for a model, `None` if not supported.
 */
export function getReasoningConfig(model: string): Option.Option<ModelReasoningConfig> {
  const normalized = normalizeModelId(model)
  return getCatalogReasoningConfig(SHARED_PROVIDER_CATALOG, normalized)
}

/**
 * Get the default reasoning effort for a model, `None` if not supported.
 */
export function getDefaultReasoningEffort(model: string): Option.Option<ReasoningEffort> {
  return Option.flatMap(getReasoningConfig(model), (config) => Option.fromNullishOr(config.default))
}

/**
 * Check if a reasoning effort is valid for a given model.
 */
export function isValidReasoningEffort(model: string, effort: string): boolean {
  return Option.match(getReasoningConfig(model), {
    onNone: () => false,
    onSome: (config) => config.efforts.includes(effort as ReasoningEffort),
  })
}

/**
 * Extract provider and model from a model ID.
 */
export function extractProviderAndModel(modelId: string): {
  provider: string
  model: string
} {
  const normalized = normalizeModelId(modelId)
  const [provider, ...modelParts] = normalized.split("/")
  return Match.value(modelParts.length > 0).pipe(
    Match.when(true, () => ({ provider, model: modelParts.join("/") })),
    Match.orElse(() => ({ provider: "anthropic", model: normalized })),
  )
}

export function getModelDisplayName(modelId: string): string {
  return Option.getOrElse(
    findModelDisplayName(SHARED_PROVIDER_CATALOG, normalizeModelId(modelId)),
    () => modelId,
  )
}
