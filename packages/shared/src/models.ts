import * as Match from "effect/Match"
import { buildRuntimeModelOptions, SHARED_PROVIDER_CATALOG } from "./provider-config"

export interface ModelDisplayInfo {
  id: string
  name: string
}

export interface ModelCategory {
  category: string
  models: ModelDisplayInfo[]
}

export const MODEL_OPTIONS: ModelCategory[] = buildRuntimeModelOptions(SHARED_PROVIDER_CATALOG).map(
  (group) => ({
    category: group.category,
    models: group.models.map((model) => ({
      id: model.id,
      name: model.name,
    })),
  }),
)

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
