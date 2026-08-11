import type { ModelMessage } from "ai"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { normalizeIsolateStepLimit } from "@solzero/shared"

export const ISOLATE_SUBAGENT_STEP_LIMIT = 8
export const ISOLATE_SUBAGENT_MAX_STEPS = ISOLATE_SUBAGENT_STEP_LIMIT + 1

const MAX_OPSGENIE_LIST_ALERTS = 25
const OPSGENIE_LIST_ALERTS_TOOL_SUFFIX = "opsgenie-broker-mcp-list-alerts"
const SUBAGENT_FINALIZATION_PROMPT = [
  "The delegated tool-call budget is exhausted.",
  "Do not call more tools.",
  "Return the final evidence-backed findings now using the tool results already in this conversation.",
  "Distinguish successful results, empty results, tool errors, and missing authorization.",
].join(" ")

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function resolveIsolateSubagentToolStepLimit(
  value: unknown,
  fallback = ISOLATE_SUBAGENT_STEP_LIMIT,
): number {
  return Math.min(normalizeIsolateStepLimit(value, fallback), ISOLATE_SUBAGENT_STEP_LIMIT)
}

export function resolveIsolateSubagentTurnStepLimit(value: unknown): number {
  return resolveIsolateSubagentToolStepLimit(value) + 1
}

export function isIsolateSubagentFinalizationStep(
  stepNumber: number,
  toolStepLimit: unknown,
): boolean {
  return stepNumber >= resolveIsolateSubagentToolStepLimit(toolStepLimit)
}

export function withIsolateSubagentFinalizationPrompt(
  messages: readonly ModelMessage[],
): ModelMessage[] {
  return [...messages, { role: "user", content: SUBAGENT_FINALIZATION_PROMPT }]
}

export function boundIsolateSubagentToolInput(
  toolName: string,
  input: unknown,
): Option.Option<Record<string, unknown>> {
  return Option.flatMap(Option.liftPredicate(input, isRecord), (record) =>
    Match.value(
      toolName.endsWith(OPSGENIE_LIST_ALERTS_TOOL_SUFFIX) &&
        (typeof record.limit !== "number" || record.limit > MAX_OPSGENIE_LIST_ALERTS),
    ).pipe(
      Match.when(true, () => Option.some({ ...record, limit: MAX_OPSGENIE_LIST_ALERTS })),
      Match.orElse(() => Option.none()),
    ),
  )
}
