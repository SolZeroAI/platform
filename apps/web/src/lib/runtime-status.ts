const IDLE_RUNTIME_STATUSES = new Set(["ready", "stopped", "stale", "failed"])
const NON_PROCESSING_RUNTIME_STATUSES = new Set(["stopped", "stale", "failed"])

export function isIdleRuntimeStatus(status: string | null | undefined): boolean {
  return status != null && IDLE_RUNTIME_STATUSES.has(status)
}

export function shouldClearProcessingForRuntimeStatus(status: string | null | undefined): boolean {
  return status != null && NON_PROCESSING_RUNTIME_STATUSES.has(status)
}
