import { Badge } from "@cloudflare/kumo/components/badge"
import { Bot, ChevronRight, ExternalLink } from "lucide-react"
import { useState } from "react"
import type { WorkflowRunEvent } from "./types"
import { formatDuration, formatTime } from "./run-utils"

export type WorkflowRunEventRow =
  | { type: "event"; event: WorkflowRunEvent }
  | { type: "subagent"; childRunId: string; events: WorkflowRunEvent[] }

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

function childRunId(event: WorkflowRunEvent): string | null {
  return event.eventType.startsWith("subagent_") ? stringValue(event.data.childRunId) : null
}

function latestProgress(events: readonly WorkflowRunEvent[]): Record<string, unknown> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const progress = events[index]?.data.progress
    if (progress && typeof progress === "object") {
      return progress as Record<string, unknown>
    }
  }
  return null
}

/** Preserve ordinary event ordering while folding each child lifecycle into one streamed row. */
export function groupWorkflowSubagentEvents(
  events: readonly WorkflowRunEvent[],
): WorkflowRunEventRow[] {
  const rows: WorkflowRunEventRow[] = []
  const groups = new Map<string, Extract<WorkflowRunEventRow, { type: "subagent" }>>()
  for (const event of events) {
    const runId = childRunId(event)
    if (!runId) {
      rows.push({ type: "event", event })
      continue
    }
    const existing = groups.get(runId)
    if (existing) {
      existing.events.push(event)
      continue
    }
    const group: Extract<WorkflowRunEventRow, { type: "subagent" }> = {
      type: "subagent",
      childRunId: runId,
      events: [event],
    }
    groups.set(runId, group)
    rows.push(group)
  }
  return rows
}

function statusFor(event: WorkflowRunEvent): string {
  return (
    stringValue(event.data.status) ??
    (event.eventType === "subagent_completed"
      ? "completed"
      : event.eventType === "subagent_failed"
        ? "error"
        : event.eventType.replace("subagent_", ""))
  )
}

function statusClassName(status: string): string {
  return status === "completed"
    ? "text-kumo-success"
    : status === "error" || status === "failed"
      ? "text-kumo-danger"
      : status === "aborted" || status === "interrupted"
        ? "text-kumo-warning"
        : "text-kumo-info"
}

export function WorkflowSubagentRunDisclosure({
  childRunId: runId,
  events,
}: {
  childRunId: string
  events: WorkflowRunEvent[]
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence)
  const started = ordered.find((event) => event.eventType === "subagent_started") ?? ordered[0]
  const latest = ordered.at(-1) ?? started
  const status = statusFor(latest)
  const task = stringValue(started.data.task) ?? "Delegated task"
  const model = stringValue(started.data.model)
  const sessionId = stringValue(latest.data.sessionId) ?? stringValue(started.data.sessionId)
  const summary = stringValue(latest.data.summary)
  const error = stringValue(latest.data.error)
  const progress = latestProgress(ordered)
  const progressMessage = progress ? stringValue(progress.message) : null
  const progressFraction = progress ? numberValue(progress.fraction) : null
  const activityToolNames = ordered.flatMap((event) => {
    const singular = stringValue(event.data.toolName)
    return [...(singular ? [singular] : []), ...stringArray(event.data.toolNames)]
  })
  const toolNames = [...new Set(activityToolNames)].sort((left, right) => left.localeCompare(right))
  const observedToolCallIds = new Set(
    ordered.flatMap((event) => {
      const callId = stringValue(event.data.toolCallId)
      return callId ? [callId] : []
    }),
  )
  const reportedToolCount = numberValue(latest.data.toolCallCount)
  const toolCallCount = reportedToolCount ?? observedToolCallIds.size
  const durationMs = numberValue(latest.data.durationMs)
  const duration =
    durationMs === null
      ? formatDuration(started.createdAt, latest.createdAt)
      : formatDuration(0, durationMs)

  return (
    <div className="border-b border-kumo-hairline" data-subagent-run-id={runId}>
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((expanded) => !expanded)}
        className="flex w-full cursor-pointer items-start gap-2 px-4 py-3 text-left outline-none transition hover:bg-kumo-tint focus:bg-kumo-tint"
      >
        <ChevronRight
          className={`mt-0.5 h-4 w-4 shrink-0 text-kumo-subtle transition-transform ${isExpanded ? "rotate-90" : ""}`}
          aria-hidden
        />
        <Bot className={`mt-0.5 h-4 w-4 shrink-0 ${statusClassName(status)}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-sm text-kumo-default">{task}</span>
            <Badge variant="secondary" className="shrink-0 text-[10px] uppercase">
              {status}
            </Badge>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-kumo-subtle">
            <span>{`${toolCallCount} ${toolCallCount === 1 ? "tool call" : "tool calls"}`}</span>
            <span aria-hidden>·</span>
            <span>{duration}</span>
            {progressMessage ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{progressMessage}</span>
              </>
            ) : null}
          </div>
        </div>
      </button>
      {isExpanded ? (
        <div className="px-4 pb-4 pl-14 text-xs">
          <dl className="grid grid-cols-[82px_minmax(0,1fr)] gap-x-3 gap-y-2">
            <dt className="text-kumo-subtle">Model</dt>
            <dd className="break-words font-mono text-kumo-default">{model ?? "default"}</dd>
            <dt className="text-kumo-subtle">Started</dt>
            <dd className="text-kumo-default">{formatTime(started.createdAt)}</dd>
            <dt className="text-kumo-subtle">Progress</dt>
            <dd className="text-kumo-default">
              {progressFraction === null ? "—" : `${Math.round(progressFraction * 100)}%`}
              {progressMessage ? ` — ${progressMessage}` : ""}
            </dd>
            <dt className="text-kumo-subtle">Tools</dt>
            <dd className="break-words text-kumo-default">
              {toolNames.length > 0 ? toolNames.join(", ") : "None reported"}
            </dd>
            {summary ? (
              <>
                <dt className="text-kumo-subtle">Summary</dt>
                <dd className="whitespace-pre-wrap text-kumo-default">{summary}</dd>
              </>
            ) : null}
            {error ? (
              <>
                <dt className="text-kumo-subtle">Error</dt>
                <dd className="whitespace-pre-wrap text-kumo-danger">{error}</dd>
              </>
            ) : null}
          </dl>
          {sessionId ? (
            <a
              href={`/session/${encodeURIComponent(sessionId)}`}
              className="mt-3 inline-flex items-center gap-1 text-kumo-info hover:underline"
            >
              Open full session detail
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
