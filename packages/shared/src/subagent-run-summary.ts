import type {
  SandboxEvent,
  SubagentMilestone,
  SubagentProgress,
  SubagentRunSummary,
  SubagentSessionEvent,
} from "./session-events"
import * as Arr from "effect/Array"
import * as Match from "effect/Match"
import * as Order from "effect/Order"
import * as P from "effect/Predicate"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
  sanitizeSubagentCompactError,
  sanitizeSubagentCompactLabel,
  sanitizeSubagentCompactProgress,
  sanitizeSubagentCompactSummary,
  sanitizeSubagentTaskPreview,
} from "./subagent-redaction"

interface RunState extends SubagentRunSummary {
  readonly order: number
  readonly toolCallIds: ReadonlySet<string>
}

type StartedEvent = Extract<SubagentSessionEvent, { kind: "started" }>

type ChunkEvent = Extract<SubagentSessionEvent, { kind: "chunk" }>

export const EMPTY_SUBAGENT_SUMMARY_ERROR = "Sub-agent completed without a text summary."

const TOOL_INPUT_CHUNK_TYPES = new Set([
  "tool-input-start",
  "tool-input-available",
  "tool-input-error",
])

const PROGRESS_CHUNK_TYPES = new Set(["data-agent-progress", "data-agent-milestone"])

const SubagentProgressDataSchema = Schema.Struct({
  fraction: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String),
  phase: Schema.optional(Schema.String),
  milestone: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  sequence: Schema.optional(Schema.Number),
  at: Schema.optional(Schema.Number),
})

const SubagentChunkSchema = Schema.Struct({
  type: Schema.String,
  toolCallId: Schema.optional(Schema.String),
  toolName: Schema.optional(Schema.String),
  data: Schema.optional(SubagentProgressDataSchema),
})

type SubagentChunk = typeof SubagentChunkSchema.Type

type SubagentProgressData = typeof SubagentProgressDataSchema.Type

const parseChunk = Schema.decodeUnknownOption(Schema.fromJsonString(SubagentChunkSchema))

const mapDefined = <A, B>(value: A | undefined, f: (defined: A) => B) =>
  Option.getOrUndefined(Option.map(Option.fromUndefinedOr(value), f))

/** `value` as a one-item list when `include` is true and it is defined, else an empty list. */
const definedWhen = <A>(include: boolean, value: A | undefined): A[] =>
  [value].filter((candidate): candidate is A => include && P.isNotUndefined(candidate))

const bySequence = Order.mapInput(
  Order.Number,
  (item: { readonly sequence: number }) => item.sequence,
)

function progressFromData(data: SubagentProgressData, timestamp: number): SubagentProgress {
  return {
    at: data.at ?? timestamp * 1000,
    fraction: mapDefined(data.fraction, (fraction) => Math.min(1, Math.max(0, fraction))),
    message: mapDefined(data.message, sanitizeSubagentCompactProgress),
    phase: mapDefined(data.phase, sanitizeSubagentCompactLabel),
    milestone: mapDefined(data.milestone, sanitizeSubagentCompactLabel),
  }
}

function milestoneFromData(
  data: SubagentProgressData,
  event: SubagentSessionEvent,
): Option.Option<SubagentMilestone> {
  const name = Option.orElse(Option.fromNullishOr(data.name), () =>
    Option.fromNullishOr(data.milestone),
  )

  return Option.map(name, (value) => ({
    name: sanitizeSubagentCompactLabel(value),
    sequence: data.sequence ?? event.sequence,
    at: data.at ?? event.timestamp * 1000,
  }))
}

/** Adds a milestone unless one with the same sequence exists, and keeps the list in sequence order. */
const addMilestone = (
  milestones: readonly SubagentMilestone[] | undefined,
  milestone: SubagentMilestone,
): SubagentMilestone[] =>
  Arr.sort(
    Arr.dedupeWith(
      [...(milestones ?? []), milestone],
      (left, right) => left.sequence === right.sequence,
    ),
    bySequence,
  )

function applyProgress(run: RunState, data: SubagentProgressData, event: ChunkEvent): RunState {
  const milestones = Option.match(milestoneFromData(data, event), {
    onNone: () => run.milestones,
    onSome: (milestone) => addMilestone(run.milestones, milestone),
  })

  return { ...run, progress: progressFromData(data, event.timestamp), milestones }
}

function applyParsedChunk(run: RunState, chunk: SubagentChunk, event: ChunkEvent): RunState {
  const toolInput = TOOL_INPUT_CHUNK_TYPES.has(chunk.type)
  const toolCallIds = new Set([...run.toolCallIds, ...definedWhen(toolInput, chunk.toolCallId)])

  const toolNames = [
    ...new Set([...run.toolNames, ...definedWhen(toolInput, chunk.toolName)]),
  ].sort((left, right) => left.localeCompare(right))

  const withTools = { ...run, toolCallIds, toolCallCount: toolCallIds.size, toolNames }

  return Option.match(
    Option.filter(Option.fromUndefinedOr(chunk.data), () => PROGRESS_CHUNK_TYPES.has(chunk.type)),
    {
      onNone: () => withTools,
      onSome: (data) => applyProgress(withTools, data, event),
    },
  )
}

const applyChunk = (run: RunState, event: ChunkEvent): RunState =>
  Option.match(parseChunk(event.body), {
    onNone: () => run,
    onSome: (chunk) => applyParsedChunk(run, chunk, event),
  })

function applyFinished(run: RunState, summary: string, completedAt: number): RunState {
  const outcome = Match.value(summary.length > 0).pipe(
    Match.when(true, () => ({ status: "completed" as const })),
    Match.orElse(() => ({ status: "error" as const, error: EMPTY_SUBAGENT_SUMMARY_ERROR })),
  )

  return { ...run, summary, ...outcome, completedAt }
}

const applyLifecycle = (run: RunState, event: SubagentSessionEvent): RunState =>
  Match.value(event).pipe(
    Match.discriminatorsExhaustive("kind")({
      started: () => run,
      chunk: (chunk) => applyChunk(run, chunk),
      finished: (finished) =>
        applyFinished(run, sanitizeSubagentCompactSummary(finished.summary), finished.timestamp),
      error: (failed): RunState => ({
        ...run,
        status: "error",
        error: sanitizeSubagentCompactError(failed.error),
        completedAt: failed.timestamp,
      }),
      aborted: (aborted): RunState => ({
        ...run,
        status: "aborted",
        error: aborted.reason && sanitizeSubagentCompactError(aborted.reason),
        completedAt: aborted.timestamp,
      }),
      interrupted: (interrupted): RunState => ({
        ...run,
        status: "interrupted",
        error: sanitizeSubagentCompactError(interrupted.error),
        reason: interrupted.reason,
        childStillRunning: interrupted.childStillRunning,
        completedAt: interrupted.timestamp,
      }),
    }),
  )

const startRun = (started: StartedEvent): RunState => ({
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
})

/** Replays one run's events in sequence order. A run with no started event is dropped. */
function reduceRun(runEvents: readonly SubagentSessionEvent[]): Option.Option<RunState> {
  const ordered = Arr.sort(runEvents, bySequence)

  return Option.map(
    Arr.findFirst(ordered, (event): event is StartedEvent => event.kind === "started"),
    (started) => ordered.reduce(applyLifecycle, startRun(started)),
  )
}

function finalizeRun(run: RunState): SubagentRunSummary {
  const { order: _order, toolCallIds: _toolCallIds, ...summary } = run

  return {
    ...summary,
    milestones: Option.getOrUndefined(
      Option.filter(Option.fromUndefinedOr(run.milestones), Arr.isReadonlyArrayNonEmpty),
    ),
    durationMs: mapDefined(run.completedAt, (completedAt) =>
      Math.max(0, Math.round((completedAt - run.startedAt) * 1000)),
    ),
  }
}

const byRunOrder = Order.combine(
  Order.mapInput(Order.Number, (run: RunState) => run.order),
  Order.mapInput(Order.String, (run: RunState) => run.runId),
)

/** Reduce replayed SessionDO child events to the compact, redacted synchronous result contract. */
export function summarizeSubagentRuns(events: readonly SandboxEvent[]): SubagentRunSummary[] {
  const subagentEvents = events.filter(
    (event): event is SubagentSessionEvent => event.type === "subagent_event",
  )

  // Replays can repeat an event. Keep the first copy of each run and sequence.
  const uniqueEvents = new Map<string, SubagentSessionEvent>(
    [...subagentEvents].reverse().map((event) => [`${event.runId}:${event.sequence}`, event]),
  )

  const runs = Arr.getSomes(
    Object.values(Arr.groupBy([...uniqueEvents.values()], (event) => event.runId)).map(reduceRun),
  )

  return Arr.sort(runs, byRunOrder).map(finalizeRun)
}
