"use client"

import { Badge } from "@cloudflare/kumo/components/badge"
import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { AlertCircle, Bot, CheckCircle2, ChevronRight, CircleStop, Network } from "lucide-react"
import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { SafeMarkdown } from "@/components/safe-markdown"
import { AnimatedLayerCardPrimary } from "@/components/expandable-layer-card"
import { ToolCallBanner } from "@/components/tool-call-item"
import { formatExecutionDuration } from "@/lib/session-events"
import type { SubagentRunView } from "@/lib/subagent-events"
import { formatFullTimestamp, formatShortTimestamp } from "@/lib/time"

interface SubagentGroupProps {
  runs: readonly SubagentRunView[]
  groupId: string
  isStreamingFocus?: boolean
  isProcessing?: boolean
}

type BadgeVariant = "secondary" | "success" | "error" | "warning" | "neutral"

function getStatusPresentation(status: SubagentRunView["status"]): {
  label: string
  variant: BadgeVariant
  icon: ReactNode
} {
  switch (status) {
    case "running":
      return {
        label: "Running",
        variant: "secondary",
        icon: <span className="h-2 w-2 animate-pulse rounded-full bg-kumo-brand" aria-hidden />,
      }
    case "completed":
      return {
        label: "Completed",
        variant: "success",
        icon: <CheckCircle2 className="h-3 w-3" aria-hidden />,
      }
    case "error":
      return {
        label: "Failed",
        variant: "error",
        icon: <AlertCircle className="h-3 w-3" aria-hidden />,
      }
    case "aborted":
      return {
        label: "Stopped",
        variant: "neutral",
        icon: <CircleStop className="h-3 w-3" aria-hidden />,
      }
    case "interrupted":
      return {
        label: "Interrupted",
        variant: "warning",
        icon: <AlertCircle className="h-3 w-3" aria-hidden />,
      }
  }
}

function getGroupStatus(runs: readonly SubagentRunView[]): string {
  const runningCount = runs.filter((run) => run.status === "running").length
  if (runningCount > 0) {
    return `${runningCount} running`
  }
  const failedCount = runs.filter((run) => run.status !== "completed").length
  if (failedCount > 0) {
    return `${failedCount} need attention`
  }
  return "Complete"
}

function SubagentProgressView({ run }: { run: SubagentRunView }) {
  const progress = run.progress
  if (!progress) {
    return null
  }
  const percent =
    progress.fraction === undefined ? null : Math.round(Math.min(1, progress.fraction) * 100)
  const label = progress.message ?? progress.phase ?? progress.milestone ?? "Working"

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs text-kumo-subtle">
        <span className="truncate">{label}</span>
        {percent === null ? null : <span className="shrink-0 tabular-nums">{percent}%</span>}
      </div>
      {percent === null ? null : (
        <div
          role="progressbar"
          aria-label={`${run.displayName ?? "Sub-agent"} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 overflow-hidden rounded-full bg-kumo-tint"
        >
          <div
            className="h-full rounded-full bg-kumo-brand transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  )
}

function SubagentRun({ run, index }: { run: SubagentRunView; index: number }) {
  const status = getStatusPresentation(run.status)
  const title = run.displayName ?? `Sub-agent ${index + 1}`
  const duration = run.durationMs === undefined ? null : formatExecutionDuration(run.durationMs)

  return (
    <section
      className="space-y-3 rounded-lg border border-kumo-hairline bg-kumo-base/50 p-3"
      aria-label={`${title}: ${status.label}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="h-4 w-4 shrink-0 text-kumo-brand" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-kumo-default">
          {title}
        </span>
        <Badge variant={status.variant} className="shrink-0 gap-1 text-[10px]">
          {status.icon}
          {status.label}
        </Badge>
      </div>

      {run.task ? (
        <p className="whitespace-pre-wrap text-sm text-kumo-default">{run.task}</p>
      ) : null}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-kumo-subtle">
        {run.model ? <span>Model: {run.model}</span> : null}
        {duration ? <span>Duration: {duration}</span> : null}
        {run.toolCallCount > 0 ? (
          <span>
            {run.toolCallCount} {run.toolCallCount === 1 ? "tool call" : "tool calls"}
          </span>
        ) : null}
      </div>

      <SubagentProgressView run={run} />

      {run.milestones?.length ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Milestones">
          {run.milestones.map((milestone) => (
            <span
              key={`${run.runId}:${milestone.sequence}`}
              title={new Date(milestone.at).toLocaleString()}
            >
              <Badge variant="secondary" className="text-[10px]">
                {milestone.name}
              </Badge>
            </span>
          ))}
        </div>
      ) : null}

      {run.reasoning ? (
        <details className="rounded-lg bg-kumo-tint/40 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-kumo-subtle">
            Reasoning
          </summary>
          <SafeMarkdown content={run.reasoning} className="mt-2 text-sm" />
        </details>
      ) : null}

      {run.text ? (
        <div>
          <h4 className="mb-1 text-xs font-medium text-kumo-subtle">Work</h4>
          <SafeMarkdown content={run.text} className="text-sm" />
        </div>
      ) : null}

      {run.toolEvents.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-kumo-subtle">Tools</h4>
          {run.toolEvents.map((event) => (
            <ToolCallBanner key={event.callId ?? `${run.runId}:${event.timestamp}`} event={event} />
          ))}
        </div>
      ) : null}

      {run.summary ? (
        <div className="rounded-lg bg-kumo-success-tint/20 px-3 py-2">
          <h4 className="mb-1 text-xs font-medium text-kumo-success">Summary</h4>
          <SafeMarkdown content={run.summary} className="text-sm" />
        </div>
      ) : null}

      {run.error ? (
        <div className="rounded-lg bg-kumo-danger-tint px-3 py-2 text-sm text-kumo-danger">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden />
            {status.label}
          </div>
          <p className="whitespace-pre-wrap break-words">{run.error}</p>
        </div>
      ) : null}
    </section>
  )
}

export function SubagentGroup({
  runs,
  groupId,
  isStreamingFocus = false,
  isProcessing = false,
}: SubagentGroupProps) {
  const contentId = useId()
  const [isExpanded, setIsExpanded] = useState(false)
  const userToggledRef = useRef(false)
  const hasRunningRun = runs.some((run) => run.status === "running")
  const firstStartedAt = runs.reduce(
    (earliest, run) => Math.min(earliest, run.startedAt),
    Number.POSITIVE_INFINITY,
  )
  const time = Number.isFinite(firstStartedAt) ? formatShortTimestamp(firstStartedAt) : ""
  const fullTimestamp = Number.isFinite(firstStartedAt) ? formatFullTimestamp(firstStartedAt) : ""

  useEffect(() => {
    if (!isProcessing) {
      userToggledRef.current = false
    }
  }, [isProcessing])

  useEffect(() => {
    if (!userToggledRef.current) {
      setIsExpanded(isStreamingFocus || hasRunningRun)
    }
  }, [hasRunningRun, isStreamingFocus])

  if (runs.length === 0) {
    return null
  }

  return (
    <div className="py-1" data-subagent-group={groupId}>
      <LayerCard className="overflow-hidden rounded-xl">
        <LayerCard.Secondary className="my-0 p-0">
          <button
            type="button"
            onClick={() => {
              userToggledRef.current = true
              setIsExpanded((expanded) => !expanded)
            }}
            aria-expanded={isExpanded}
            aria-controls={contentId}
            className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none transition-colors hover:text-kumo-default focus-visible:text-kumo-default"
          >
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-kumo-brand transition-transform duration-200 ${
                isExpanded ? "rotate-90" : ""
              }`}
              aria-hidden
            />
            <Network className="h-4 w-4 shrink-0 text-kumo-brand" aria-hidden />
            <span className="font-medium text-kumo-default">Sub-agents</span>
            <Badge variant="secondary" className="shrink-0 font-mono tabular-nums">
              {runs.length}
              <span className="sr-only"> {runs.length === 1 ? "sub-agent" : "sub-agents"}</span>
            </Badge>
            <span className="truncate text-kumo-subtle">{getGroupStatus(runs)}</span>
            {time ? (
              <span className="ml-auto shrink-0 text-xs text-kumo-subtle" title={fullTimestamp}>
                {time}
              </span>
            ) : null}
          </button>
        </LayerCard.Secondary>
        <AnimatedLayerCardPrimary
          open={isExpanded}
          id={contentId}
          className="gap-0 rounded-lg px-3 py-3"
        >
          <div className="space-y-3">
            {runs.map((run, index) => (
              <SubagentRun key={run.runId} run={run} index={index} />
            ))}
          </div>
        </AnimatedLayerCardPrimary>
      </LayerCard>
    </div>
  )
}
