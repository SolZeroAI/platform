import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

export const DEFAULT_ISOLATE_STEP_LIMIT = 50
export const MIN_ISOLATE_STEP_LIMIT = 1
export const MAX_ISOLATE_STEP_LIMIT = 64

const IsolateStepLimitSchema = Schema.Union([Schema.Number, Schema.NumberFromString])

export function normalizeIsolateStepLimit(
  value: unknown,
  fallback = DEFAULT_ISOLATE_STEP_LIMIT,
): number {
  const fallbackLimit = clampIsolateStepLimit(fallback)
  return Option.match(Schema.decodeUnknownOption(IsolateStepLimitSchema)(value), {
    onNone: () => fallbackLimit,
    onSome: clampIsolateStepLimit,
  })
}

function clampIsolateStepLimit(value: number): number {
  return Math.min(Math.max(Math.trunc(value), MIN_ISOLATE_STEP_LIMIT), MAX_ISOLATE_STEP_LIMIT)
}
