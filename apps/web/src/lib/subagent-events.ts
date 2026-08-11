import type {
  SandboxEvent,
  SubagentMilestone,
  SubagentProgress,
  SubagentRunStatus,
  SubagentRunSummary,
  SubagentSessionEvent,
} from "@solzero/shared"

export interface SubagentRunView extends SubagentRunSummary {
  order: number
  displayName?: string
  text: string
  reasoning: string
  toolEvents: SandboxEvent[]
}

export interface SubagentEventState {
  runs: SubagentRunView[]
  runsById: Map<string, SubagentRunView>
  runsByParentToolCallId: Map<string, SubagentRunView[]>
}

interface MutableSubagentRun {
  runId: string
  parentToolCallId?: string
  agentType: string
  task?: string
  model?: string
  displayName?: string
  order: number
  status: SubagentRunStatus
  startedAt: number
  completedAt?: number
  summary?: string
  error?: string
  progress?: SubagentProgress
  milestones: SubagentMilestone[]
  reason?: SubagentRunSummary["reason"]
  childStillRunning?: boolean
  text: string
  reasoning: string
  toolEvents: SandboxEvent[]
}

type JsonRecord = Record<string, unknown>

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseSubagentChunk(body: string): JsonRecord | null {
  try {
    const value: unknown = JSON.parse(body)
    return isJsonRecord(value) && typeof value.type === "string" ? value : null
  } catch {
    return null
  }
}

function toDisplayText(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function toToolArgs(value: unknown): Record<string, unknown> {
  return isJsonRecord(value) ? value : value === undefined ? {} : { input: value }
}

function findToolEventIndex(run: MutableSubagentRun, callId: string): number {
  return run.toolEvents.findIndex((event) => event.type === "tool_call" && event.callId === callId)
}

function upsertSubagentToolCall(
  run: MutableSubagentRun,
  event: SubagentSessionEvent,
  chunk: JsonRecord,
): void {
  const toolCallId = typeof chunk.toolCallId === "string" ? chunk.toolCallId : null
  const toolName = typeof chunk.toolName === "string" ? chunk.toolName : null
  if (!toolCallId || !toolName) {
    return
  }

  const callId = `${run.runId}:${toolCallId}`
  const existingIndex = findToolEventIndex(run, callId)
  const existing = existingIndex >= 0 ? run.toolEvents[existingIndex] : undefined
  const next: SandboxEvent = {
    ...(existing?.type === "tool_call" ? existing : {}),
    type: "tool_call",
    tool: toolName,
    args: toToolArgs(chunk.input),
    callId,
    messageId: event.messageId,
    sandboxId: event.sandboxId,
    timestamp: event.timestamp,
  }

  if (chunk.type === "tool-input-error" && typeof chunk.errorText === "string") {
    next.error = chunk.errorText
    next.success = false
  }

  if (existingIndex >= 0) {
    run.toolEvents[existingIndex] = next
  } else {
    run.toolEvents.push(next)
  }
}

function applySubagentToolOutput(
  run: MutableSubagentRun,
  chunk: JsonRecord,
  isError: boolean,
): void {
  const toolCallId = typeof chunk.toolCallId === "string" ? chunk.toolCallId : null
  if (!toolCallId) {
    return
  }

  const callId = `${run.runId}:${toolCallId}`
  const existingIndex = findToolEventIndex(run, callId)
  const existing = existingIndex >= 0 ? run.toolEvents[existingIndex] : undefined
  if (existing?.type !== "tool_call") {
    return
  }

  const output = isError ? chunk.errorText : chunk.output
  const displayOutput = toDisplayText(output)
  run.toolEvents[existingIndex] = {
    ...existing,
    ...(isError
      ? { error: displayOutput, success: false }
      : { output: displayOutput, result: displayOutput, success: true }),
  }
}

function applySubagentProgress(
  run: MutableSubagentRun,
  chunk: JsonRecord,
  timestamp: number,
): void {
  const data = isJsonRecord(chunk.data) ? chunk.data : {}
  const fraction =
    typeof data.fraction === "number" ? Math.min(1, Math.max(0, data.fraction)) : null
  run.progress = {
    ...(fraction === null ? {} : { fraction }),
    ...(typeof data.message === "string" ? { message: data.message } : {}),
    ...(typeof data.phase === "string" ? { phase: data.phase } : {}),
    at: timestamp * 1000,
  }
}

function applySubagentMilestone(
  run: MutableSubagentRun,
  chunk: JsonRecord,
  timestamp: number,
): void {
  const data = isJsonRecord(chunk.data) ? chunk.data : {}
  if (typeof data.name !== "string") {
    return
  }

  const sequence = typeof data.sequence === "number" ? data.sequence : 0
  const at = typeof data.at === "number" ? data.at : timestamp * 1000
  if (!run.milestones.some((milestone) => milestone.sequence === sequence)) {
    run.milestones.push({ name: data.name, sequence, at })
    run.milestones.sort((left, right) => left.sequence - right.sequence)
  }

  const fraction =
    typeof data.fraction === "number" ? Math.min(1, Math.max(0, data.fraction)) : null
  run.progress = {
    ...(fraction === null ? {} : { fraction }),
    ...(typeof data.message === "string" ? { message: data.message } : {}),
    ...(typeof data.phase === "string" ? { phase: data.phase } : {}),
    milestone: data.name,
    at,
  }
}

function applySubagentChunk(run: MutableSubagentRun, event: SubagentSessionEvent): void {
  if (event.kind !== "chunk") {
    return
  }
  const chunk = parseSubagentChunk(event.body)
  if (!chunk) {
    return
  }

  switch (chunk.type) {
    case "text-delta":
      if (typeof chunk.delta === "string") {
        run.text += chunk.delta
      }
      return
    case "reasoning-delta":
      if (typeof chunk.delta === "string") {
        run.reasoning += chunk.delta
      }
      return
    case "tool-input-available":
    case "tool-input-error":
      upsertSubagentToolCall(run, event, chunk)
      return
    case "tool-output-available":
      applySubagentToolOutput(run, chunk, false)
      return
    case "tool-output-error":
      applySubagentToolOutput(run, chunk, true)
      return
    case "data-agent-progress":
      applySubagentProgress(run, chunk, event.timestamp)
      return
    case "data-agent-milestone":
      applySubagentMilestone(run, chunk, event.timestamp)
      return
    default:
      // The AI SDK adds chunk variants over time. Unknown chunks are retained in
      // durable history but intentionally do not break reconstruction.
      return
  }
}

function isTerminalSubagentStatus(status: SubagentRunStatus): boolean {
  return status !== "running"
}

function applySubagentLifecycle(run: MutableSubagentRun, event: SubagentSessionEvent): void {
  switch (event.kind) {
    case "started":
      if (!isTerminalSubagentStatus(run.status)) {
        run.agentType = event.agentType
        run.parentToolCallId = event.parentToolCallId
        run.task = event.task
        run.model = event.model
        run.displayName = event.displayName
        run.order = event.order
      }
      return
    case "chunk":
      applySubagentChunk(run, event)
      return
    case "finished":
      run.status = "completed"
      run.summary = event.summary
      run.error = undefined
      run.completedAt = event.timestamp
      return
    case "error":
      run.status = "error"
      run.error = event.error
      run.completedAt = event.timestamp
      return
    case "aborted":
      run.status = "aborted"
      run.error = event.reason
      run.completedAt = event.timestamp
      return
    case "interrupted":
      run.status = "interrupted"
      run.error = event.error
      run.reason = event.reason
      run.childStillRunning = event.childStillRunning
      run.completedAt = event.timestamp
      return
  }
}

function toSubagentRunView(run: MutableSubagentRun): SubagentRunView {
  const toolNames = [
    ...new Set(
      run.toolEvents.flatMap((event) =>
        event.type === "tool_call" && event.tool ? [event.tool] : [],
      ),
    ),
  ]
  return {
    runId: run.runId,
    parentToolCallId: run.parentToolCallId,
    agentType: run.agentType,
    task: run.task,
    model: run.model,
    displayName: run.displayName,
    order: run.order,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs:
      run.completedAt === undefined
        ? undefined
        : Math.max(0, Math.round((run.completedAt - run.startedAt) * 1000)),
    toolCallCount: run.toolEvents.length,
    toolNames,
    summary: run.summary,
    error: run.error,
    progress: run.progress,
    milestones: run.milestones.length > 0 ? run.milestones : undefined,
    reason: run.reason,
    childStillRunning: run.childStillRunning,
    text: run.text,
    reasoning: run.reasoning,
    toolEvents: run.toolEvents,
  }
}

export function reduceSubagentEvents(events: readonly SandboxEvent[]): SubagentEventState {
  const eventsByRunId = new Map<string, SubagentSessionEvent[]>()
  const seen = new Set<string>()

  for (const event of events) {
    if (event.type !== "subagent_event") {
      continue
    }
    const dedupeKey = `${event.runId}:${event.sequence}`
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    const runEvents = eventsByRunId.get(event.runId) ?? []
    runEvents.push(event)
    eventsByRunId.set(event.runId, runEvents)
  }

  const runs: SubagentRunView[] = []
  let fallbackOrder = 0
  for (const runEvents of eventsByRunId.values()) {
    runEvents.sort((left, right) => left.sequence - right.sequence)
    const started = runEvents.find(
      (event): event is Extract<SubagentSessionEvent, { kind: "started" }> =>
        event.kind === "started",
    )
    const firstEvent = runEvents[0]
    if (!firstEvent) continue

    const run: MutableSubagentRun = {
      runId: firstEvent.runId,
      parentToolCallId: started?.parentToolCallId ?? firstEvent.parentToolCallId,
      agentType: started?.agentType ?? "IsolateSubAgent",
      task: started?.task,
      model: started?.model,
      displayName: started?.displayName,
      order: started?.order ?? fallbackOrder,
      status: "running",
      // A reconnect only replays the newest 500 events. If a long-running child
      // started before that window, retain its visible tail using the earliest
      // event still available rather than dropping the run entirely.
      startedAt: started?.timestamp ?? firstEvent.timestamp,
      milestones: [],
      text: "",
      reasoning: "",
      toolEvents: [],
    }
    fallbackOrder += 1
    for (const event of runEvents) {
      applySubagentLifecycle(run, event)
    }
    runs.push(toSubagentRunView(run))
  }

  runs.sort((left, right) => left.order - right.order || left.runId.localeCompare(right.runId))
  const runsById = new Map(runs.map((run) => [run.runId, run]))
  const runsByParentToolCallId = new Map<string, SubagentRunView[]>()
  for (const run of runs) {
    if (!run.parentToolCallId) {
      continue
    }
    const parentRuns = runsByParentToolCallId.get(run.parentToolCallId) ?? []
    parentRuns.push(run)
    runsByParentToolCallId.set(run.parentToolCallId, parentRuns)
  }

  return { runs, runsById, runsByParentToolCallId }
}
