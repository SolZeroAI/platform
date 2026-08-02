import { Badge } from "@cloudflare/kumo/components/badge"
import { ChevronRight } from "lucide-react"
import { useState } from "react"
import { CodeSurface } from "@/components/code"
import { WorkflowRun, WorkflowRunEvent } from "./types"
import { RunEventStatusIcon } from "./session-controls"
import { formatTime, getRunEventSubtitleRows } from "./run-utils"
import { formatJson } from "./header-utils"

export function RunEventDisclosure({
  event,
  run,
  durationLabel,
  approvalSubmitted,
  submittingApproval,
  onSubmitApproval,
}: {
  event: WorkflowRunEvent
  run: WorkflowRun
  durationLabel: string | null
  approvalSubmitted: boolean
  submittingApproval: boolean
  onSubmitApproval: (runId: string, nodeId: string, approved: boolean) => void | Promise<void>
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const canSubmitApproval =
    event.eventType === "approval_requested" &&
    event.nodeId !== null &&
    run.status === "running" &&
    !approvalSubmitted
  const subtitleRows = getRunEventSubtitleRows(event, durationLabel)

  return (
    <div className="border-b border-kumo-hairline">
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((expanded) => !expanded)}
        className="flex w-full cursor-pointer list-none items-start gap-2 px-4 py-3 text-left outline-none transition hover:bg-kumo-tint focus:bg-kumo-tint"
      >
        <ChevronRight
          className={`mt-0.5 h-4 w-4 flex-shrink-0 text-kumo-subtle transition-transform duration-200 ${
            isExpanded ? "rotate-90" : ""
          }`}
          aria-hidden
        />
        <div className="min-w-0 flex-1 basis-0">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0 truncate text-sm text-kumo-default">{event.message}</div>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              <RunEventStatusIcon eventType={event.eventType} level={event.level} />
            </span>
          </div>
          <div
            className={`grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out ${
              isExpanded ? "mt-0 grid-rows-[0fr] opacity-0" : "mt-0.5 grid-rows-[1fr] opacity-100"
            }`}
          >
            <div className="min-w-0 overflow-hidden">
              <div className="flex w-full min-w-0 items-center justify-between gap-3 text-xs text-kumo-subtle">
                <span className="flex min-w-0 items-center gap-2">
                  <Badge variant="secondary" className="font-mono tabular-nums text-[10px]">
                    #{event.sequence}
                  </Badge>
                  <span className="min-w-0 truncate">{formatTime(event.createdAt)}</span>
                </span>
                {durationLabel ? (
                  <span className="shrink-0 text-right">{durationLabel}</span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </button>
      <div
        aria-hidden={!isExpanded}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-3 pl-10 pt-2">
            <dl className="mb-3 grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
              {subtitleRows.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-kumo-subtle">{row.label}</dt>
                  <dd className="min-w-0 break-words font-mono text-kumo-default">{row.value}</dd>
                </div>
              ))}
            </dl>
            <CodeSurface
              title={`${event.eventType} event data`}
              value={formatJson(event.data)}
              language="json"
            />
            {canSubmitApproval ? (
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (event.nodeId) {
                      void onSubmitApproval(run.id, event.nodeId, true)
                    }
                  }}
                  disabled={submittingApproval}
                  className="bg-kumo-success px-2.5 py-1.5 text-xs font-medium text-kumo-inverse transition hover:bg-kumo-success/80 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (event.nodeId) {
                      void onSubmitApproval(run.id, event.nodeId, false)
                    }
                  }}
                  disabled={submittingApproval}
                  className="kumo-btn-destructive-sm disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
