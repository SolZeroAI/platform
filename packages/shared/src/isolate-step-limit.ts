export const DEFAULT_ISOLATE_STEP_LIMIT = 50
export const MIN_ISOLATE_STEP_LIMIT = 1
export const MAX_ISOLATE_STEP_LIMIT = 64

export function normalizeIsolateStepLimit(
  value: unknown,
  fallback = DEFAULT_ISOLATE_STEP_LIMIT,
): number {
  const parsed = typeof value === "number" ? value : Number(value)
  const fallbackLimit = clampIsolateStepLimit(fallback)
  if (!Number.isFinite(parsed)) {
    return fallbackLimit
  }
  return clampIsolateStepLimit(parsed)
}

function clampIsolateStepLimit(value: number): number {
  return Math.min(Math.max(Math.trunc(value), MIN_ISOLATE_STEP_LIMIT), MAX_ISOLATE_STEP_LIMIT)
}
