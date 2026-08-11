/* oxlint-disable s0-lint/no-if-statement, s0-lint/no-switch-statement, s0-lint/no-ternary, effect/avoid-direct-json -- Compact replay reduction is an SDK wire-format boundary; direct guards deliberately discard raw child content while retaining safe lifecycle facts. */
import type {
  SandboxEvent,
  SubagentMilestone,
  SubagentProgress,
  SubagentRunSummary,
  SubagentSessionEvent,
} from "./session-events"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import {
  sanitizeSubagentCompactError,
  sanitizeSubagentCompactLabel,
  sanitizeSubagentCompactProgress,
  sanitizeSubagentCompactSummary,
  sanitizeSubagentTaskPreview,
} from "./subagent-redaction"

interface MutableRun extends SubagentRunSummary {
  order: number
  toolCallIds: Set<string>
}

export const EMPTY_SUBAGENT_SUMMARY_ERROR = "Sub-agent completed without a text summary."

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function parseChunk(body: string): Option.Option<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(body)
    return Option.liftPredicate(
      value,
      (candidate): candidate is Record<string, unknown> =>
        isRecord(candidate) && typeof candidate.type === "string",
    )
  } catch {
    return Option.none()
  }
}

function progressFromData(data: Record<string, unknown>, timestamp: number): SubagentProgress {
  const fraction =
    typeof data.fraction === "number" ? Math.min(1, Math.max(0, data.fraction)) : undefined
  return {
    ...(fraction === undefined ? {} : { fraction }),
    ...(typeof data.message === "string"
      ? { message: sanitizeSubagentCompactProgress(data.message) }
      : {}),
    ...(typeof data.phase === "string" ? { phase: sanitizeSubagentCompactLabel(data.phase) } : {}),
    ...(typeof data.milestone === "string"
      ? { milestone: sanitizeSubagentCompactLabel(data.milestone) }
      : {}),
    at: typeof data.at === "number" ? data.at : timestamp * 1000,
  }
}

function milestoneFromData(
  data: Record<string, unknown>,
  event: SubagentSessionEvent,
): Option.Option<SubagentMilestone> {
  const name = Option.orElse(
    Option.liftPredicate(data.name, (value): value is string => typeof value === "string"),
    () =>
      Option.liftPredicate(data.milestone, (value): value is string => typeof value === "string"),
  )
  return Option.map(name, (value) => ({
    name: sanitizeSubagentCompactLabel(value),
    sequence: typeof data.sequence === "number" ? data.sequence : event.sequence,
    at: typeof data.at === "number" ? data.at : event.timestamp * 1000,
  }))
}

function applyChunk(
  run: MutableRun,
  event: Extract<SubagentSessionEvent, { kind: "chunk" }>,
): void {
  return Option.match(parseChunk(event.body), {
    onNone: () => undefined,
    onSome: (chunk) => {
      const toolInput =
        chunk.type === "tool-input-start" ||
        chunk.type === "tool-input-available" ||
        chunk.type === "tool-input-error"
      if (toolInput && typeof chunk.toolCallId === "string") {
        run.toolCallIds.add(chunk.toolCallId)
      }
      if (
        toolInput &&
        typeof chunk.toolName === "string" &&
        !run.toolNames.includes(chunk.toolName)
      ) {
        run.toolNames.push(chunk.toolName)
        run.toolNames.sort((left, right) => left.localeCompare(right))
      }
      if (
        (chunk.type === "data-agent-progress" || chunk.type === "data-agent-milestone") &&
        isRecord(chunk.data)
      ) {
        run.progress = progressFromData(chunk.data, event.timestamp)
        Option.match(milestoneFromData(chunk.data, event), {
          onNone: () => undefined,
          onSome: (milestone) => {
            if (!run.milestones?.some((existing) => existing.sequence === milestone.sequence)) {
              run.milestones = [...(run.milestones ?? []), milestone].sort(
                (left, right) => left.sequence - right.sequence,
              )
            }
          },
        })
      }
      run.toolCallCount = run.toolCallIds.size
    },
  })
}

function applyLifecycle(run: MutableRun, event: SubagentSessionEvent): void {
  switch (event.kind) {
    case "started":
      return
    case "chunk":
      applyChunk(run, event)
      return
    case "finished":
      run.summary = sanitizeSubagentCompactSummary(event.summary)
      Match.value(run.summary.length > 0).pipe(
        Match.when(true, () => {
          run.status = "completed"
        }),
        Match.orElse(() => {
          run.status = "error"
          run.error = EMPTY_SUBAGENT_SUMMARY_ERROR
        }),
      )
      run.completedAt = event.timestamp
      return
    case "error":
      run.status = "error"
      run.error = sanitizeSubagentCompactError(event.error)
      run.completedAt = event.timestamp
      return
    case "aborted":
      run.status = "aborted"
      run.error = event.reason && sanitizeSubagentCompactError(event.reason)
      run.completedAt = event.timestamp
      return
    case "interrupted":
      run.status = "interrupted"
      run.error = sanitizeSubagentCompactError(event.error)
      run.reason = event.reason
      run.childStillRunning = event.childStillRunning
      run.completedAt = event.timestamp
  }
}

function finalizeRun(run: MutableRun): SubagentRunSummary {
  const { order: _order, toolCallIds: _toolCallIds, ...summary } = run
  return {
    ...summary,
    ...(run.completedAt === undefined
      ? {}
      : { durationMs: Math.max(0, Math.round((run.completedAt - run.startedAt) * 1000)) }),
    ...(run.milestones?.length ? { milestones: run.milestones } : { milestones: undefined }),
  }
}

/** Reduce replayed SessionDO child events to the compact, redacted synchronous result contract. */
export function summarizeSubagentRuns(events: readonly SandboxEvent[]): SubagentRunSummary[] {
  const seen = new Set<string>()
  const grouped = new Map<string, SubagentSessionEvent[]>()
  for (const event of events) {
    if (event.type !== "subagent_event") {
      continue
    }
    const identity = `${event.runId}:${event.sequence}`
    if (seen.has(identity)) {
      continue
    }
    seen.add(identity)
    const runEvents = grouped.get(event.runId) ?? []
    runEvents.push(event)
    grouped.set(event.runId, runEvents)
  }

  const runs: MutableRun[] = []
  for (const runEvents of grouped.values()) {
    runEvents.sort((left, right) => left.sequence - right.sequence)
    const started = runEvents.find(
      (event): event is Extract<SubagentSessionEvent, { kind: "started" }> =>
        event.kind === "started",
    )
    if (!started) {
      continue
    }
    const run: MutableRun = {
      runId: started.runId,
      parentToolCallId: started.parentToolCallId,
      agentType: started.agentType,
      task: started.task && sanitizeSubagentTaskPreview(started.task),
      model: started.model,
      status: "running",
      startedAt: started.timestamp,
      toolCallCount: 0,
      toolNames: [],
      order: started.order,
      toolCallIds: new Set<string>(),
    }
    for (const event of runEvents) {
      applyLifecycle(run, event)
    }
    runs.push(run)
  }

  return runs
    .sort((left, right) => left.order - right.order || left.runId.localeCompare(right.runId))
    .map(finalizeRun)
}
