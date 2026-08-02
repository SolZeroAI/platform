import { Button } from "@cloudflare/kumo/components/button"
import { Label } from "@cloudflare/kumo/components/label"
import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { MultiFileDiff } from "@pierre/diffs/react"
import { C0LogoSvg } from "@/components/c0-logo-svg"
import {
  AlertTriangle,
  ArrowRightToLine,
  ChevronRight,
  Copy,
  Diff,
  Maximize2,
  Save,
  Undo2,
} from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { C0Loader } from "@/components/c0-loader"
import { AnimatedLayerCardPrimary } from "@/components/expandable-layer-card"
import { CODE_THEME } from "@/components/code/highlighter"
import { copyToClipboard } from "@/lib/format"
import {
  groupWorkflowNodeConfigErrors,
  WorkflowNodeConfigErrorDetails,
  WorkflowRuntimeVersionChange,
  WorkflowSaveChangeDetailDiff,
  WorkflowSaveChangeDetailSummary,
  WorkflowSaveChangeSummary,
  WorkflowSaveDialogState,
  WorkflowSaveDialogSummary,
  WorkflowSaveRevertAction,
} from "./types"
import { WorkflowDialogFrame } from "./detail-chrome"
import { NodeCategoryIcon } from "./session-controls"
import {
  formatWorkflowRuntimeVersionChange,
  pluralizeCount,
  WORKFLOW_RUNTIME_VERSION_DESCRIPTION,
} from "./save-utils"

export function WorkflowSaveDialog({
  state,
  onCancel,
  onConfirm,
  onRevertChange,
}: {
  state: WorkflowSaveDialogState
  onCancel: () => void
  onConfirm: () => void
  onRevertChange: (action: WorkflowSaveRevertAction) => void
}) {
  const saving = state.phase === "saving"
  const failure = state.phase === "failure"
  const title = failure ? "Save failed" : "Save workflow changes?"

  return (
    <WorkflowDialogFrame
      open
      onClose={onCancel}
      size="lg"
      className="flex max-h-[85vh] w-full max-w-xl flex-col p-0"
      title={title}
      description={
        failure
          ? "The workflow was not saved. Copy the error if you need to debug it."
          : "Review the changes before writing a new workflow version."
      }
      closeLabel="Close save dialog"
      closeDisabled={saving}
      dismissible={!saving}
      showCloseButton={false}
      headerLeading={<WorkflowSaveDialogIcon phase={state.phase} />}
      bodyClassName="min-h-0 overflow-y-auto px-5 py-4"
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <Button type="button" onClick={onCancel} disabled={saving} variant="ghost">
            Cancel
          </Button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-kumo-brand px-3 py-2 text-sm font-medium text-white transition-[transform,opacity] hover:opacity-90 active:scale-[0.96] disabled:opacity-60"
          >
            {saving ? <C0Loader size={16} /> : <Save className="h-4 w-4" aria-hidden />}
            {saving ? "Saving" : failure ? "Try again" : "Save"}
          </button>
        </div>
      }
    >
      <WorkflowSaveDialogSummaryView
        summary={state.summary}
        onRevertChange={
          state.phase === "confirm" || state.phase === "failure" ? onRevertChange : undefined
        }
      />
      {failure ? (
        <div className="mt-4 rounded-lg bg-kumo-danger-tint/10 p-3 ring-1 ring-kumo-danger/30">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-kumo-danger">API error</div>
            <button
              type="button"
              onClick={() => void copyToClipboard(state.error)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-kumo-danger ring-1 ring-kumo-danger/40 transition hover:bg-kumo-danger-tint/10 text-kumo-danger"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              Copy error
            </button>
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-kumo-base p-2 font-mono text-xs text-kumo-danger ring-1 ring-kumo-danger/20">
            {state.error}
          </pre>
        </div>
      ) : null}
    </WorkflowDialogFrame>
  )
}

export function WorkflowSaveDialogIcon({ phase }: { phase: WorkflowSaveDialogState["phase"] }) {
  if (phase === "saving") {
    return (
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-kumo-tint ring-1 ring-kumo-brand/30">
        <C0Loader size={16} />
      </span>
    )
  }
  if (phase === "failure") {
    return (
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-kumo-danger-tint/10 text-kumo-danger ring-1 ring-kumo-danger/30">
        <AlertTriangle className="h-4 w-4" aria-hidden />
      </span>
    )
  }
  return (
    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-kumo-tint text-kumo-subtle ring-1 ring-kumo-hairline">
      <Save className="h-4 w-4" aria-hidden />
    </span>
  )
}

export function WorkflowSaveDialogSummaryView({
  summary,
  onRevertChange,
}: {
  summary: WorkflowSaveDialogSummary
  onRevertChange?: (action: WorkflowSaveRevertAction) => void
}) {
  return (
    <div className="space-y-4">
      <section>
        <div className="flex items-center justify-between gap-3">
          <Label>Changes</Label>
          <span className="inline-flex shrink-0 items-center rounded-full border border-kumo-line bg-kumo-tint px-1.5 py-0.5 font-mono text-[11px] text-kumo-subtle">
            {summary.workflowVersion}
          </span>
        </div>
        {summary.changes.length > 0 || summary.runtimeVersionChange ? (
          <ul className="mt-2 space-y-2">
            {summary.changes.map((change, index) => (
              <WorkflowSaveChangeCard
                key={`${change.title}-${index}`}
                change={change}
                onRevertChange={onRevertChange}
              />
            ))}
            {summary.runtimeVersionChange ? (
              <WorkflowSystemUpgradeCard
                runtimeVersionChange={summary.runtimeVersionChange}
                systemChanges={summary.systemChanges}
              />
            ) : null}
          </ul>
        ) : null}
      </section>
    </div>
  )
}

export function WorkflowSystemUpgradeCard({
  runtimeVersionChange,
  systemChanges,
}: {
  runtimeVersionChange: WorkflowRuntimeVersionChange
  systemChanges: WorkflowSaveChangeSummary[]
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const detailsId = useId()

  return (
    <li className="rounded-lg bg-kumo-tint text-sm ring-1 ring-kumo-brand/25">
      <button
        type="button"
        onClick={() => setIsExpanded((expanded) => !expanded)}
        aria-expanded={isExpanded}
        aria-controls={detailsId}
        aria-label={
          isExpanded ? "Collapse workflow runtime changes" : "Expand workflow runtime changes"
        }
        className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm leading-5 text-kumo-default outline-none transition-[background-color] hover:bg-kumo-tint focus:bg-kumo-tint"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-kumo-brand transition-transform duration-200 ${
            isExpanded ? "rotate-90" : ""
          }`}
          aria-hidden
        />
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-kumo-tint ring-1 ring-kumo-brand">
          <C0LogoSvg className="h-4 w-4 opacity-90" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">Workflow Runtime</span>
        <span className="ml-auto inline-flex shrink-0 items-center rounded-full bg-kumo-tint px-1.5 py-0.5 font-mono text-[11px] leading-none text-kumo-brand ring-1 ring-kumo-brand tabular-nums">
          {formatWorkflowRuntimeVersionChange(runtimeVersionChange)}
        </span>
      </button>
      <div
        id={detailsId}
        className={`grid border-t border-kumo-brand/20 transition-[grid-template-rows,opacity] duration-200 ease-out ${
          isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-w-0 overflow-hidden bg-kumo-base">
          <div className="border-b border-kumo-hairline px-3 py-2 text-xs leading-5 text-kumo-subtle">
            {WORKFLOW_RUNTIME_VERSION_DESCRIPTION}
          </div>
          {systemChanges.length > 0 ? (
            <ul className="divide-y divide-kumo-hairline">
              {systemChanges.map((change, index) => (
                <WorkflowSystemUpgradeChangeRow key={`${change.title}-${index}`} change={change} />
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
  )
}

export function WorkflowSystemUpgradeChangeRow({ change }: { change: WorkflowSaveChangeSummary }) {
  const nodeSubject = change.subject?.kind === "node" ? change.subject : null
  const title = nodeSubject ? nodeSubject.label : change.title

  return (
    <li className="px-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        {nodeSubject ? (
          <NodeCategoryIcon
            type={nodeSubject.type}
            category={nodeSubject.category}
            className="h-5 w-5 shrink-0"
            iconClassName="h-3 w-3"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-kumo-default">{title}</div>
          {change.details.length > 0 ? (
            <ul className="mt-1 space-y-1 text-xs leading-5 text-kumo-subtle">
              {change.details.map((detail, index) => (
                <li key={`${detail.label}-${index}`} className="truncate" title={detail.label}>
                  {detail.label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
  )
}

export function WorkflowSaveChangeCard({
  change,
  onRevertChange,
}: {
  change: WorkflowSaveChangeSummary
  onRevertChange?: (action: WorkflowSaveRevertAction) => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const detailsId = useId()
  const hasDetails = change.details.length > 0
  const changeCount = Math.max(change.details.length, 1)
  const changeCountLabel = pluralizeCount(changeCount, "change")
  const nodeSubject = change.subject?.kind === "node" ? change.subject : null
  const title = nodeSubject ? nodeSubject.label : change.title
  const deleted = change.badge === "deleted"

  return (
    <li>
      <LayerCard className="overflow-hidden rounded-xl">
        <LayerCard.Secondary className="my-0 p-0">
          <button
            type="button"
            onClick={() => {
              if (hasDetails) {
                setIsExpanded((expanded) => !expanded)
              }
            }}
            aria-expanded={hasDetails ? isExpanded : undefined}
            aria-controls={hasDetails ? detailsId : undefined}
            aria-label={`${change.title}, ${deleted ? "Deleted" : changeCountLabel}`}
            className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm leading-5 text-kumo-subtle outline-none transition-colors hover:text-kumo-default focus-visible:text-kumo-default"
          >
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-current transition-transform duration-200 ${
                isExpanded ? "rotate-90" : ""
              } ${hasDetails ? "" : "opacity-0"}`}
              aria-hidden
            />
            {nodeSubject ? (
              <NodeCategoryIcon
                type={nodeSubject.type}
                category={nodeSubject.category}
                className="h-5 w-5"
                iconClassName="h-3 w-3"
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate">{title}</span>
            {deleted ? (
              <span className="ml-auto inline-flex shrink-0 items-center rounded-full bg-kumo-danger-tint/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-kumo-danger ring-1 ring-kumo-danger/25">
                Deleted
              </span>
            ) : (
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-kumo-tint px-1.5 py-0.5 font-mono text-[11px] leading-none text-kumo-subtle ring-1 ring-kumo-hairline">
                {changeCount}
                <span className="sr-only"> {changeCount === 1 ? "change" : "changes"}</span>
                <Diff className="h-3 w-3" aria-hidden />
              </span>
            )}
          </button>
        </LayerCard.Secondary>
        {hasDetails ? (
          <AnimatedLayerCardPrimary
            open={isExpanded}
            id={detailsId}
            className="gap-0 rounded-lg px-3 py-2 pl-9 pr-1.5"
          >
            <ul className="space-y-1 text-xs leading-5 text-kumo-subtle">
              {change.details.map((detail, detailIndex) => (
                <WorkflowSaveChangeDetailRow
                  key={`${detail.label}-${detailIndex}`}
                  detail={detail}
                  onRevertChange={onRevertChange}
                />
              ))}
            </ul>
          </AnimatedLayerCardPrimary>
        ) : null}
      </LayerCard>
    </li>
  )
}

export function WorkflowSaveChangeDetailRow({
  detail,
  onRevertChange,
}: {
  detail: WorkflowSaveChangeDetailSummary
  onRevertChange?: (action: WorkflowSaveRevertAction) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [confirmationExpanded, setConfirmationExpanded] = useState(false)
  const [diffOpen, setDiffOpen] = useState(false)
  const confirmationCloseTimerRef = useRef<number | null>(null)
  const revertAction = detail.revertAction
  const canRevert = Boolean(revertAction && onRevertChange)
  const canViewDiff = Boolean(detail.diff)

  useEffect(() => {
    return () => {
      if (confirmationCloseTimerRef.current !== null) {
        window.clearTimeout(confirmationCloseTimerRef.current)
      }
    }
  }, [])

  const openRevertConfirmation = () => {
    if (!canRevert) {
      return
    }

    if (confirmationCloseTimerRef.current !== null) {
      window.clearTimeout(confirmationCloseTimerRef.current)
      confirmationCloseTimerRef.current = null
    }

    setConfirming(true)
    setConfirmationExpanded(true)
  }

  const closeRevertConfirmation = () => {
    setConfirmationExpanded(false)
    confirmationCloseTimerRef.current = window.setTimeout(() => {
      setConfirming(false)
      confirmationCloseTimerRef.current = null
    }, 200)
  }

  const confirmRevert = () => {
    if (!revertAction || !onRevertChange) {
      return
    }

    setConfirmationExpanded(false)
    setConfirming(false)
    onRevertChange(revertAction)
  }

  const confirmationVisible = confirming && canRevert
  const confirmationOpen = confirmationVisible && confirmationExpanded

  return (
    <li className="w-full">
      <div className="grid h-10 w-full overflow-hidden">
        <div
          aria-hidden={confirmationVisible}
          className={`col-start-1 row-start-1 flex h-10 w-full items-center overflow-hidden transition-[opacity,filter] duration-150 ease-out motion-reduce:transition-none ${
            confirmationVisible ? "opacity-0 blur-[1px]" : "opacity-100 blur-0"
          }`}
        >
          <div className="min-w-0 flex-1 overflow-hidden">
            <span className="block min-w-0 truncate pr-2" title={detail.label}>
              {detail.label}
            </span>
          </div>
          <div className="ml-2 flex shrink-0 items-center gap-0.5">
            {canViewDiff ? (
              <button
                type="button"
                onClick={() => setDiffOpen(true)}
                className="group flex h-10 w-10 shrink-0 items-center justify-center outline-none transition-[transform,opacity] active:scale-[0.96]"
                aria-label={`View diff for ${detail.label}`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-kumo-line bg-kumo-tint text-kumo-subtle transition-[background-color,border-color,color] group-hover:border-kumo-focus/40 group-hover:bg-kumo-base group-hover:text-kumo-default">
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                </span>
              </button>
            ) : null}
            {canRevert ? (
              <button
                type="button"
                onClick={openRevertConfirmation}
                className="group flex h-10 w-10 shrink-0 items-center justify-center outline-none transition-[transform,opacity] active:scale-[0.96]"
                aria-label={`Revert ${detail.label}`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-kumo-danger/20 bg-kumo-danger-tint/5 text-kumo-danger transition-[background-color,border-color,color] group-hover:border-kumo-danger group-hover:bg-kumo-danger-tint group-hover:text-kumo-danger">
                  <Undo2 className="h-3.5 w-3.5" aria-hidden />
                </span>
              </button>
            ) : null}
          </div>
        </div>
        {canRevert ? (
          <div
            aria-hidden={!confirmationVisible}
            data-state={confirmationOpen ? "open" : confirmationVisible ? "closing" : "idle"}
            className={`workflow-revert-confirm-panel col-start-1 row-start-1 flex h-7 w-[calc(100%-0.375rem)] origin-right items-center self-center overflow-hidden border px-2 transition-[opacity,background-color,border-color,color] duration-200 ease-out motion-reduce:transition-none ${
              confirmationVisible
                ? "pointer-events-auto border-kumo-line bg-kumo-tint text-kumo-default opacity-100"
                : "pointer-events-none border-transparent bg-kumo-tint text-kumo-default opacity-0"
            }`}
          >
            <div className="workflow-revert-confirm-content flex min-w-0 flex-1 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                Revert this change?
              </span>
              <button
                type="button"
                onClick={closeRevertConfirmation}
                className="h-6 shrink-0 px-2 text-[11px] font-medium text-kumo-subtle outline-none transition-[transform,background-color,color] hover:bg-kumo-base/40 hover:text-kumo-default focus:ring-2 focus:ring-kumo-focus active:scale-[0.96]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRevert}
                className="kumo-btn-destructive-sm h-6 px-2 text-[11px] outline-none focus:ring-2 focus:ring-kumo-focus active:scale-[0.96]"
              >
                Revert
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {detail.diff && diffOpen ? (
        <WorkflowSaveChangeDiffDialog diff={detail.diff} onClose={() => setDiffOpen(false)} />
      ) : null}
    </li>
  )
}

export function WorkflowSaveChangeDiffDialog({
  diff,
  onClose,
}: {
  diff: WorkflowSaveChangeDetailDiff
  onClose: () => void
}) {
  return (
    <WorkflowDialogFrame
      open
      onClose={onClose}
      size="near-full"
      title={diff.title}
      description="Diff"
      closeLabel="Close diff dialog"
      bodyClassName="min-h-0 flex-1 overflow-auto bg-kumo-recessed p-0 text-[12px]"
    >
      <MultiFileDiff
        oldFile={diff.oldFile}
        newFile={diff.newFile}
        options={{
          theme: CODE_THEME,
          diffStyle: "split",
          disableFileHeader: false,
          disableLineNumbers: false,
          overflow: "scroll",
          tokenizeMaxLineLength: 1000,
        }}
        className="h-full"
      />
    </WorkflowDialogFrame>
  )
}

export function WorkflowValidationErrorsDialog({
  errors,
  onClose,
  onOpenError,
}: {
  errors: WorkflowNodeConfigErrorDetails[]
  onClose: () => void
  onOpenError: (error: WorkflowNodeConfigErrorDetails) => void
}) {
  const groups = useMemo(() => groupWorkflowNodeConfigErrors(errors), [errors])

  return (
    <WorkflowDialogFrame
      open
      onClose={onClose}
      size="lg"
      title="Fix node configuration errors"
      description="These nodes have configuration errors that prevent the workflow from being saved."
      closeLabel="Close validation errors dialog"
      showCloseButton={false}
      bodyClassName="max-h-[55vh] overflow-y-auto px-5 py-4"
      footer={
        <div className="flex justify-end px-5 py-4">
          <Button type="button" onClick={onClose} variant="ghost">
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {groups.map((group) => (
          <section key={group.nodeId} className="rounded-lg bg-kumo-tint ring-1 ring-kumo-line">
            <div className="border-b border-kumo-hairline px-3 py-2">
              <div className="truncate text-sm font-medium text-kumo-default">
                {group.nodeLabel}
              </div>
              <div className="truncate font-mono text-[11px] text-kumo-subtle">{group.nodeId}</div>
            </div>
            <div className="divide-y divide-kumo-hairline">
              {group.errors.map((configError, index) => (
                <div
                  key={`${configError.configLabel}-${configError.message}-${index}`}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-medium uppercase text-kumo-subtle">
                      {configError.configLabel}
                    </span>
                    <span className="mt-0.5 block text-sm leading-5 text-kumo-danger">
                      {configError.message}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenError(configError)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-kumo-brand ring-1 ring-kumo-hairline transition hover:bg-kumo-tint hover:text-kumo-default focus:ring-2 focus:ring-kumo-focus"
                    title={`Open ${configError.configLabel}`}
                    aria-label={`Open ${configError.configLabel} configuration error`}
                  >
                    <ArrowRightToLine className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </WorkflowDialogFrame>
  )
}
