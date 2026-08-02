import { Button } from "@cloudflare/kumo/components/button"
import { Tabs } from "@cloudflare/kumo/components/tabs"
import { BorderBeam } from "border-beam"
import {
  AlertTriangle,
  Ban,
  Download,
  MoreVertical,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { type WorkflowManifestNode } from "@c0-agent/shared"
import { C0Loader } from "@/components/c0-loader"
import { Dialog, NEAR_FULL_DIALOG_CLASS_NAME } from "@/components/ui/dialog"
import { useSidebarContext } from "@/components/sidebar-layout"
import { WorkflowSummary, WorkflowViewTab } from "./types"
import { formatTime } from "./run-utils"
import { SlackMarkIcon } from "./slack-mark-icon"

export function WorkflowBuilderSidebarCloser({
  activeTab,
  showWorkflowIndexView,
}: {
  activeTab: WorkflowViewTab
  showWorkflowIndexView: boolean
}) {
  const { close } = useSidebarContext()

  useEffect(() => {
    if (!showWorkflowIndexView && activeTab === "builder") {
      close()
    }
  }, [activeTab, close, showWorkflowIndexView])

  return null
}

export function WorkflowViewTabs({
  activeTab,
  onChange,
}: {
  activeTab: WorkflowViewTab
  onChange: (tab: WorkflowViewTab) => void
}) {
  const { close } = useSidebarContext()

  return (
    <Tabs
      variant="segmented"
      value={activeTab}
      onValueChange={(value) => {
        if (value !== "overview" && value !== "builder") {
          return
        }
        onChange(value)
        if (value === "builder") {
          close()
        }
      }}
      tabs={[
        { value: "overview", label: "Overview" },
        { value: "builder", label: "Builder" },
      ]}
    />
  )
}

export function WorkflowDetailLoadingState() {
  return (
    <main
      className="flex min-h-0 flex-1 items-center justify-center bg-kumo-canvas"
      aria-busy="true"
      aria-label="Loading workflow"
    >
      <C0Loader size={48} />
    </main>
  )
}

export function WorkflowDetailLoadErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-kumo-canvas p-8">
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-kumo-warning-tint/15 text-kumo-warning">
          <AlertTriangle className="h-5 w-5" aria-hidden />
        </div>
        <h2 className="mt-3 text-sm font-medium text-kumo-default">Workflow could not load</h2>
        <p className="mt-1 text-sm text-kumo-subtle">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg bg-kumo-base px-3 py-2 text-sm font-medium text-kumo-default ring-1 ring-kumo-line transition hover:bg-kumo-tint active:scale-[0.96]"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Retry
        </button>
      </div>
    </main>
  )
}

export function WorkflowVersionToolbar({
  workflow,
  onExport,
  onRequestDeleteWorkflow,
  onSetWorkflowEnabled,
  updatingWorkflowStatus,
  slackAppSetupAvailable,
  slackAppSetupDisabled,
  slackAppSetupDisabledReason,
  onOpenSlackAppSetup,
  triggerNode,
  triggerRunDisabled,
  triggerRunning,
  onRunTrigger,
  editWithAiDisabled,
  onEditWithAi,
}: {
  workflow: WorkflowSummary | null
  onExport: () => void
  onRequestDeleteWorkflow: (workflow: WorkflowSummary) => void
  onSetWorkflowEnabled: (workflow: WorkflowSummary, enabled: boolean) => void
  updatingWorkflowStatus: boolean
  slackAppSetupAvailable: boolean
  slackAppSetupDisabled: boolean
  slackAppSetupDisabledReason?: string
  onOpenSlackAppSetup: () => void
  triggerNode: WorkflowManifestNode | null
  triggerRunDisabled: boolean
  triggerRunning: boolean
  onRunTrigger: (node: WorkflowManifestNode) => void | Promise<void>
  editWithAiDisabled: boolean
  onEditWithAi: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const workflowDisabled = workflow?.status === "disabled"

  return (
    <div className="flex h-11 flex-shrink-0 items-center justify-between border-b border-kumo-hairline px-4">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="inline-flex h-6 items-center rounded-md bg-kumo-base px-2 text-xs font-medium text-kumo-default ring-1 ring-kumo-hairline">
          {workflow ? `v${workflow.manifestVersion}` : "Draft"}
        </span>
        {workflow ? (
          <span className="truncate text-xs text-kumo-subtle">
            Updated {formatTime(workflow.updatedAt)}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <div
          className="relative"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) {
              setMenuOpen(false)
            }
          }}
        >
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            className="rounded-md p-1.5 text-kumo-subtle ring-1 ring-kumo-hairline transition hover:bg-kumo-tint hover:text-kumo-default"
            title="Workflow actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreVertical className="h-3.5 w-3.5" aria-hidden />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-40 rounded-lg bg-kumo-elevated p-1 shadow-xl ring-1 ring-kumo-line"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onExport()
                }}
                disabled={!workflow}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-kumo-default transition hover:bg-kumo-tint disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Download className="h-4 w-4" aria-hidden />
                Export YAML
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  if (!workflow) {
                    return
                  }
                  setMenuOpen(false)
                  onSetWorkflowEnabled(workflow, workflowDisabled)
                }}
                disabled={!workflow || updatingWorkflowStatus}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-kumo-default transition hover:bg-kumo-tint disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Ban className="h-4 w-4" aria-hidden />
                {workflowDisabled ? "Enable workflow" : "Disable workflow"}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  if (!workflow) {
                    return
                  }
                  setMenuOpen(false)
                  onRequestDeleteWorkflow(workflow)
                }}
                disabled={!workflow}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-kumo-danger transition hover:bg-kumo-danger-tint/10 disabled:cursor-not-allowed disabled:opacity-45 text-kumo-danger"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete workflow
              </button>
            </div>
          ) : null}
        </div>
        {slackAppSetupAvailable ? (
          <button
            type="button"
            onClick={onOpenSlackAppSetup}
            disabled={slackAppSetupDisabled}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-kumo-default ring-1 ring-kumo-hairline transition hover:bg-kumo-tint disabled:cursor-not-allowed disabled:opacity-45"
            title={slackAppSetupDisabledReason}
          >
            <SlackMarkIcon className="h-4 w-4" />
            Slack app
          </button>
        ) : null}
        {triggerNode ? (
          <button
            type="button"
            onClick={() => void onRunTrigger(triggerNode)}
            disabled={triggerRunDisabled}
            className="flex items-center gap-1.5 rounded-lg bg-kumo-tint px-2.5 py-1.5 text-xs font-medium text-kumo-default ring-1 ring-kumo-hairline transition hover:bg-kumo-fill disabled:opacity-45"
            title={
              workflowDisabled
                ? "Enable the workflow before running this trigger"
                : triggerRunDisabled
                  ? "Save the workflow before running this trigger"
                  : undefined
            }
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            {triggerRunning ? "Starting" : "Run"}
          </button>
        ) : null}
        <AiBeamButton compact onClick={onEditWithAi} disabled={editWithAiDisabled}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Edit with AI
        </AiBeamButton>
      </div>
    </div>
  )
}

export function WorkflowCanvasControls({
  saveVisible,
  saving,
  onSave,
}: {
  saveVisible: boolean
  saving: boolean
  onSave: () => void
}) {
  if (!saveVisible) {
    return null
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-2 bg-transparent">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-kumo-brand px-4 py-2 text-sm font-medium text-white transition-[transform,opacity] hover:opacity-90 active:scale-[0.96] disabled:opacity-60"
        >
          <Save className="h-4 w-4" aria-hidden />
          {saving ? "Saving" : "Save changes"}
        </button>
      </div>
    </div>
  )
}

export function AiBeamButton({
  children,
  onClick,
  type = "button",
  disabled = false,
  compact = false,
}: {
  children: ReactNode
  onClick?: () => void
  type?: "button" | "submit"
  disabled?: boolean
  compact?: boolean
}) {
  return (
    <BorderBeam
      size="pulse-inner"
      colorVariant="colorful"
      theme="auto"
      borderRadius={8}
      strength={0.78}
      active={!disabled}
      className="inline-flex rounded-lg"
    >
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        className={`inline-flex items-center gap-2 rounded-lg bg-kumo-base font-medium text-kumo-default ring-1 ring-inset ring-kumo-brand/35 transition-[background-color,transform,opacity] hover:bg-kumo-tint active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 ${
          compact ? "px-2.5 py-1.5 text-xs" : "min-h-10 px-4 py-2 text-sm"
        }`}
      >
        {children}
      </button>
    </BorderBeam>
  )
}

export type WorkflowDialogSize = "sm" | "lg" | "xl" | "near-full"

export const WORKFLOW_DIALOG_SIZE_CLASS_NAMES: Record<WorkflowDialogSize, string> = {
  sm: "flex max-h-[85vh] w-full max-w-md flex-col p-0",
  lg: "flex max-h-[85vh] w-full max-w-lg flex-col p-0",
  xl: "flex max-h-[85vh] w-full max-w-2xl flex-col p-0",
  "near-full": NEAR_FULL_DIALOG_CLASS_NAME,
}

export function WorkflowDialogFrame({
  open,
  onClose,
  size = "lg",
  className,
  title,
  description,
  headerLeading,
  headerActions,
  showCloseButton = true,
  closeDisabled = false,
  closeLabel = "Close dialog",
  dismissible = true,
  bodyClassName = "max-h-[70vh] overflow-y-auto px-5 py-4",
  children,
  footer,
  role,
}: {
  open: boolean
  onClose: () => void
  size?: WorkflowDialogSize
  className?: string
  title: ReactNode
  description?: ReactNode
  headerLeading?: ReactNode
  headerActions?: ReactNode
  showCloseButton?: boolean
  closeDisabled?: boolean
  closeLabel?: string
  dismissible?: boolean
  bodyClassName?: string
  children?: ReactNode
  footer?: ReactNode
  role?: "dialog" | "alertdialog"
}) {
  return (
    <Dialog.Root
      open={open}
      role={role}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && dismissible) {
          onClose()
        }
      }}
    >
      <Dialog className={className ?? WORKFLOW_DIALOG_SIZE_CLASS_NAMES[size]}>
        <div className="flex items-start justify-between gap-4 border-b border-kumo-hairline px-5 py-4">
          <div className="flex min-w-0 flex-1 gap-3">
            {headerLeading}
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold leading-6 text-kumo-default">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm leading-5 text-kumo-subtle">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
          </div>
          {headerActions || showCloseButton ? (
            <div className="flex shrink-0 items-center gap-2">
              {headerActions}
              {showCloseButton ? (
                <Button
                  type="button"
                  onClick={onClose}
                  disabled={closeDisabled}
                  shape="circle"
                  variant="ghost"
                  aria-label={closeLabel}
                  icon={<X className="h-4 w-4" aria-hidden />}
                />
              ) : null}
            </div>
          ) : null}
        </div>
        {children != null ? <div className={bodyClassName}>{children}</div> : null}
        {footer ? <div className="border-t border-kumo-hairline">{footer}</div> : null}
      </Dialog>
    </Dialog.Root>
  )
}
