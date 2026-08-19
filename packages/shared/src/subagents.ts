import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { SessionKind } from "./agent-runtime"

export const SUBAGENT_MODES = ["enabled", "disabled"] as const

export type SubagentMode = (typeof SUBAGENT_MODES)[number]

export const DEFAULT_SUBAGENT_MODE: SubagentMode = "enabled"

export const SubagentModeSchema = Schema.Literals(SUBAGENT_MODES)

export const isSubagentMode = Schema.is(SubagentModeSchema)

export function normalizeSubagentMode(
  value: unknown,
  fallback: unknown = DEFAULT_SUBAGENT_MODE,
): SubagentMode {
  return Option.getOrElse(
    Option.orElse(Option.liftPredicate(value, isSubagentMode), () =>
      Option.liftPredicate(fallback, isSubagentMode),
    ),
    () => DEFAULT_SUBAGENT_MODE,
  )
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
  return Match.value(sessionKind).pipe(
    Match.when("isolate", () => normalizeSubagentMode(value, fallback)),
    Match.orElse(() => "disabled" as const),
  )
}

/** Serialize a `subagents` field only for the session kinds that support it. */
export function sessionSubagentModeField(
  sessionKind: SessionKind | string | null | undefined,
  value: unknown,
): { subagents?: SubagentMode } {
  return Match.value(sessionKind).pipe(
    Match.when("isolate", () => ({ subagents: normalizeSubagentMode(value) })),
    Match.orElse(() => ({})),
  )
}
