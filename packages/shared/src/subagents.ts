import type { SessionKind } from "./agent-runtime"

export const SUBAGENT_MODES = ["enabled", "disabled"] as const

export type SubagentMode = (typeof SUBAGENT_MODES)[number]

export const DEFAULT_SUBAGENT_MODE: SubagentMode = "enabled"

const SUBAGENT_MODE_VALUES: readonly string[] = SUBAGENT_MODES

export function isSubagentMode(value: unknown): value is SubagentMode {
  return typeof value === "string" && SUBAGENT_MODE_VALUES.includes(value)
}

export function normalizeSubagentMode(
  value: unknown,
  fallback: unknown = DEFAULT_SUBAGENT_MODE,
): SubagentMode {
  if (isSubagentMode(value)) {
    return value
  }
  return isSubagentMode(fallback) ? fallback : DEFAULT_SUBAGENT_MODE
}

/**
 * Sub-agent delegation is an isolate-session feature. Every other session
 * kind is pinned to "disabled" regardless of the requested or stored value.
 */
export function resolveSessionSubagentMode(
  sessionKind: SessionKind | string | null | undefined,
  value: unknown,
  fallback: unknown = DEFAULT_SUBAGENT_MODE,
): SubagentMode {
  if (sessionKind !== "isolate") {
    return "disabled"
  }
  return normalizeSubagentMode(value, fallback)
}

/** Serialize a `subagents` field only for the session kinds that support it. */
export function sessionSubagentModeField(
  sessionKind: SessionKind | string | null | undefined,
  value: unknown,
): { subagents?: SubagentMode } {
  if (sessionKind !== "isolate") {
    return {}
  }
  return { subagents: normalizeSubagentMode(value) }
}
