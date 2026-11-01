import * as Match from "effect/Match"

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
