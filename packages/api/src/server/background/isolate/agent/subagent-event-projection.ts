import type {
  AgentToolEventMessage,
  AgentToolLifecycleResult,
  AgentToolRunInfo,
  AgentToolRunInspection,
} from "agents"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { sanitizeSubagentCompactSummary, type SubagentSessionEvent } from "@c0-agent/shared"

export interface SubagentSessionEventProjectionInput {
  message: AgentToolEventMessage
  messageId: string
  sandboxId: string
  timestamp: number
}

type SubagentSessionEventCommon = Pick<
  SubagentSessionEvent,
  | "type"
  | "eventId"
  | "runId"
  | "sequence"
  | "parentToolCallId"
  | "messageId"
  | "sandboxId"
  | "timestamp"
  | "replay"
>

export function projectSubagentSessionEvent(
  input: SubagentSessionEventProjectionInput,
): SubagentSessionEvent {
  const event = input.message.event
  const common: SubagentSessionEventCommon = {
    type: "subagent_event" as const,
    eventId: `sae_${event.runId}_${input.message.sequence}`,
    runId: event.runId,
    sequence: input.message.sequence,
    parentToolCallId: input.message.parentToolCallId,
    messageId: input.messageId,
    sandboxId: input.sandboxId,
    timestamp: input.timestamp,
    replay: input.message.replay,
  }

  return Match.value(event).pipe(
    Match.when({ kind: "started" }, (started) => projectStartedEvent(common, started)),
    Match.when(
      { kind: "chunk" },
      (chunk): SubagentSessionEvent => ({ ...common, kind: "chunk", body: chunk.body }),
    ),
    Match.when(
      { kind: "finished" },
      (finished): SubagentSessionEvent => ({
        ...common,
        kind: "finished",
        summary: finished.summary,
      }),
    ),
    Match.when(
      { kind: "error" },
      (failed): SubagentSessionEvent => ({ ...common, kind: "error", error: failed.error }),
    ),
    Match.when(
      { kind: "aborted" },
      (aborted): SubagentSessionEvent => ({
        ...common,
        kind: "aborted",
        reason: aborted.reason,
      }),
    ),
    Match.when(
      { kind: "interrupted" },
      (interrupted): SubagentSessionEvent => ({
        ...common,
        kind: "interrupted",
        error: interrupted.error,
        reason: interrupted.reason,
        childStillRunning: interrupted.childStillRunning,
      }),
    ),
    Match.exhaustive,
  )
}

function projectStartedEvent(
  common: SubagentSessionEventCommon,
  started: Extract<AgentToolEventMessage["event"], { kind: "started" }>,
): SubagentSessionEvent {
  const preview = readAgentToolInputPreview(started.inputPreview)
  return {
    ...common,
    kind: "started",
    agentType: started.agentType,
    order: started.order,
    task: preview.task,
    model: preview.model,
    displayName: started.display?.name,
  }
}

export function startedAgentToolEventMessage(run: AgentToolRunInfo): AgentToolEventMessage {
  return {
    type: "agent-tool-event",
    parentToolCallId: run.parentToolCallId,
    sequence: 0,
    event: {
      kind: "started",
      runId: run.runId,
      agentType: run.agentType,
      inputPreview: run.inputPreview,
      order: run.displayOrder,
      display: run.display,
    },
  }
}

/** Resolve once at the lifecycle hook so delayed SessionDO delivery cannot skew duration. */
export function resolveAgentToolCompletedAtMs(
  run: AgentToolRunInfo,
  stableFallbackMs: number,
): number {
  return Option.getOrElse(Option.fromNullishOr(run.completedAt), () => stableFallbackMs)
}

/**
 * A terminal broadcast is persisted only when public registry inspection can
 * supply the SDK completion time. Absence defers persistence to the lifecycle
 * hook so an arrival-time fallback cannot win the idempotent SessionDO insert.
 */
export function inspectedAgentToolCompletedAtMs(
  inspection: Option.Option<Pick<AgentToolRunInspection, "completedAt">>,
): Option.Option<number> {
  return Option.flatMap(inspection, (resolved) => Option.fromNullishOr(resolved.completedAt))
}

export function terminalAgentToolEventMessage(
  run: AgentToolRunInfo,
  result: AgentToolLifecycleResult,
  sequence: number,
): AgentToolEventMessage {
  const common = {
    type: "agent-tool-event" as const,
    parentToolCallId: run.parentToolCallId,
    sequence,
  }
  return Match.value(result).pipe(
    Match.when({ status: "completed" }, (completed) => ({
      ...common,
      event: {
        kind: "finished" as const,
        runId: run.runId,
        summary: sanitizeSubagentCompactSummary(completed.summary ?? ""),
      },
    })),
    Match.when({ status: "aborted" }, (aborted) => ({
      ...common,
      event: { kind: "aborted" as const, runId: run.runId, reason: aborted.error },
    })),
    Match.when({ status: "interrupted" }, (interrupted) => ({
      ...common,
      event: {
        kind: "interrupted" as const,
        runId: run.runId,
        error: interrupted.error ?? "Agent tool run was interrupted",
        reason: interrupted.reason,
        childStillRunning: interrupted.childStillRunning,
      },
    })),
    Match.orElse((failed) => ({
      ...common,
      event: {
        kind: "error" as const,
        runId: run.runId,
        error: failed.error ?? "Agent tool run failed",
      },
    })),
  )
}

export function hydrateCompletedAgentToolEventMessage(
  message: AgentToolEventMessage,
  output: unknown,
): AgentToolEventMessage {
  return Option.match(
    Option.all({
      event: Option.liftPredicate(
        message.event,
        (event): event is Extract<AgentToolEventMessage["event"], { kind: "finished" }> =>
          event.kind === "finished" && event.summary.trim().length === 0,
      ),
      output: Option.liftPredicate(
        output,
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      ),
    }),
    {
      onNone: () => message,
      onSome: ({ event, output: resolvedOutput }) => ({
        ...message,
        event: {
          ...event,
          summary: sanitizeSubagentCompactSummary(resolvedOutput),
        },
      }),
    },
  )
}

/** Extract the sanitized task/model preview attached by the parent when the run started. */
export function readAgentToolInputPreview(inputPreview: unknown): {
  task?: string
  model?: string
} {
  return Option.match(
    Option.liftPredicate(
      inputPreview,
      (value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === "object" && !Array.isArray(value),
    ),
    {
      onNone: () => ({}),
      onSome: (preview) => ({
        ...optionalPreviewField("task", preview.task),
        ...optionalPreviewField("model", preview.model),
      }),
    },
  )
}

function optionalPreviewField<Key extends "task" | "model">(
  key: Key,
  value: unknown,
): Partial<Record<Key, string>> {
  return Option.match(
    Option.liftPredicate(value, (candidate): candidate is string => typeof candidate === "string"),
    {
      onNone: () => ({}),
      onSome: (resolved) => ({ [key]: resolved }) as Record<Key, string>,
    },
  )
}
