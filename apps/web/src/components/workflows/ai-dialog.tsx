import { ChevronRight, Sparkles } from "lucide-react"
import {
  type FormEvent,
  type MutableRefObject,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { type SandboxEvent } from "@solzero/shared"
import { S0Loader } from "@/components/s0-loader"
import { S0LogoSvg } from "@/components/s0-logo-svg"
import { SafeMarkdown } from "@/components/safe-markdown"
import { useSessionSocket } from "@/hooks/use-session-socket"
import { showErrorToast } from "@/lib/toast-manager"
import { AiBeamButton, WorkflowDialogFrame } from "./detail-chrome"
import { WorkflowRunSelectionTable } from "./run-selection-table"
import { getErrorMessage, requestJson } from "./run-utils"
import {
  type WorkflowBuilderDraft,
  type WorkflowRun,
  type WorkflowRunStatePatch,
  type WorkflowRunTableState,
} from "./types"

type WorkflowAiOpenRow = "editor" | "run-context"

export function WorkflowAiEditDialog({
  open,
  sessionId,
  sending,
  runs,
  runTableTotal,
  runTableState,
  runTableLoading,
  selectedRuns,
  onClose,
  onRunTableStateChange,
  onToggleRun,
  onToggleVisibleRuns,
  onSend,
  onDraftReady,
}: {
  open: boolean
  sessionId: string | null
  sending: boolean
  runs: WorkflowRun[]
  runTableTotal: number
  runTableState: WorkflowRunTableState
  runTableLoading: boolean
  selectedRuns: ReadonlyMap<string, WorkflowRun>
  onClose: () => void
  onRunTableStateChange: (patch: WorkflowRunStatePatch) => void
  onToggleRun: (run: WorkflowRun, selected: boolean) => void
  onToggleVisibleRuns: (runs: WorkflowRun[], selected: boolean) => void
  onSend: (prompt: string) => void | Promise<void>
  onDraftReady: (draft: WorkflowBuilderDraft) => void
}) {
  const appliedCompletionKeysRef = useRef(new Set<string>())
  const selectedRunIds = useMemo(() => new Set(selectedRuns.keys()), [selectedRuns])
  const [openRow, setOpenRow] = useState<WorkflowAiOpenRow>("editor")

  useEffect(() => {
    if (open) {
      setOpenRow("editor")
    }
  }, [open])

  return (
    <WorkflowDialogFrame
      open={open}
      onClose={onClose}
      size="near-full"
      title="Edit with AI"
      closeLabel="Close Edit with AI dialog"
      bodyClassName="min-h-0 flex-1 overflow-hidden p-0"
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <WorkflowAiDialogRow
          id="workflow-ai-editor"
          title="AI editor"
          summary={sessionId ? "Workflow builder session" : "Ready for workflow edits"}
          icon={<Sparkles className="h-4 w-4 text-kumo-brand" aria-hidden />}
          open={openRow === "editor"}
          onOpen={() => setOpenRow("editor")}
        >
          <WorkflowAiChat
            sessionId={sessionId}
            sending={sending}
            appliedCompletionKeysRef={appliedCompletionKeysRef}
            onSend={onSend}
            onDraftReady={onDraftReady}
          />
        </WorkflowAiDialogRow>

        <WorkflowAiDialogRow
          id="workflow-ai-run-context"
          title="Run context"
          summary="Select runs whose inputs, outputs, status, and errors should inform the edit."
          meta={`${selectedRuns.size} selected`}
          open={openRow === "run-context"}
          onOpen={() => setOpenRow("run-context")}
        >
          <WorkflowRunSelectionTable
            runs={runs}
            total={runTableTotal}
            state={runTableState}
            loading={runTableLoading}
            selectedRunIds={selectedRunIds}
            onStateChange={onRunTableStateChange}
            onToggleRun={onToggleRun}
            onToggleVisibleRuns={onToggleVisibleRuns}
          />
        </WorkflowAiDialogRow>
      </div>
    </WorkflowDialogFrame>
  )
}

function WorkflowAiDialogRow({
  id,
  title,
  summary,
  meta,
  icon,
  open,
  onOpen,
  children,
}: {
  id: string
  title: string
  summary: string
  meta?: string
  icon?: ReactNode
  open: boolean
  onOpen: () => void
  children: ReactNode
}) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden border-b border-kumo-hairline transition-[flex-grow] duration-200 ease-out motion-reduce:transition-none ${
        open ? "grow" : "grow-0"
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onOpen}
        className="flex min-h-16 w-full shrink-0 items-center gap-3 px-5 py-3 text-left outline-none transition hover:bg-kumo-tint/60 focus-visible:bg-kumo-tint"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-kumo-subtle transition-transform duration-200 ${
            open ? "rotate-90" : ""
          }`}
          aria-hidden
        />
        {icon ? <span className="shrink-0">{icon}</span> : null}
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-sm font-medium text-kumo-default">{title}</span>
          <span className="truncate text-xs text-kumo-subtle">{summary}</span>
        </span>
        {meta ? (
          <span className="inline-flex shrink-0 items-center rounded-full bg-kumo-tint px-2 py-0.5 text-[11px] font-medium leading-5 text-kumo-subtle ring-1 ring-kumo-hairline">
            {meta}
          </span>
        ) : null}
      </button>
      <div
        id={id}
        aria-hidden={!open}
        inert={open ? undefined : true}
        className={`grid min-h-0 flex-1 transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col border-t border-kumo-hairline">
            {children}
          </div>
        </div>
      </div>
    </section>
  )
}

export function WorkflowAiChat({
  sessionId,
  sending,
  appliedCompletionKeysRef,
  onSend,
  onDraftReady,
}: {
  sessionId: string | null
  sending: boolean
  appliedCompletionKeysRef: MutableRefObject<Set<string>>
  onSend: (prompt: string) => void | Promise<void>
  onDraftReady: (draft: WorkflowBuilderDraft) => void
}) {
  const [prompt, setPrompt] = useState("")

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = prompt.trim()
    if (!trimmed) {
      return
    }
    setPrompt("")
    void onSend(trimmed)
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-kumo-canvas">
      {sessionId ? (
        <WorkflowAiChatSessionEvents
          sessionId={sessionId}
          appliedCompletionKeysRef={appliedCompletionKeysRef}
          onDraftReady={onDraftReady}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-kumo-subtle">
          Ask for a workflow change. Selected run details will be included with the current YAML.
        </div>
      )}

      <form onSubmit={submitPrompt} className="shrink-0 border-t border-kumo-hairline p-3">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe the workflow change."
          aria-label="Workflow edit request"
          className="min-h-24 w-full resize-none rounded-lg bg-kumo-base p-3 text-sm text-kumo-default outline-none ring-1 ring-kumo-line transition focus:ring-kumo-brand"
        />
        <div className="mt-2 flex justify-end">
          <AiBeamButton type="submit" disabled={sending || !prompt.trim()}>
            <Sparkles className="h-4 w-4" aria-hidden />
            {sending ? "Sending" : "Send"}
          </AiBeamButton>
        </div>
      </form>
    </div>
  )
}

export function WorkflowAiChatSessionEvents({
  sessionId,
  appliedCompletionKeysRef,
  onDraftReady,
}: {
  sessionId: string
  appliedCompletionKeysRef: MutableRefObject<Set<string>>
  onDraftReady: (draft: WorkflowBuilderDraft) => void
}) {
  const { connected, connecting, events, isProcessing, currentParticipantId } =
    useSessionSocket(sessionId)
  const visibleEvents = useMemo(() => getWorkflowAiVisibleEvents(events), [events])
  const latestSuccessfulCompletion = useMemo(
    () =>
      [...events]
        .reverse()
        .find(
          (event) =>
            event.type === "execution_complete" && event.success === true && event.messageId,
        ) ?? null,
    [events],
  )

  useEffect(() => {
    appliedCompletionKeysRef.current.clear()
  }, [appliedCompletionKeysRef, sessionId])

  useEffect(() => {
    if (!latestSuccessfulCompletion?.messageId) {
      return
    }
    const completionKey = `${sessionId}:${latestSuccessfulCompletion.messageId}`
    if (appliedCompletionKeysRef.current.has(completionKey)) {
      return
    }
    appliedCompletionKeysRef.current.add(completionKey)
    void (async () => {
      try {
        const draft = await fetchWorkflowAiDraft(sessionId)
        if (draft) {
          onDraftReady(draft)
        }
      } catch (errorValue) {
        showErrorToast(getErrorMessage(errorValue))
      }
    })()
  }, [appliedCompletionKeysRef, latestSuccessfulCompletion, onDraftReady, sessionId])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2 text-xs text-kumo-subtle">
        <span
          className={`h-2 w-2 rounded-full ${
            connected
              ? "bg-emerald-400"
              : connecting
                ? "animate-pulse bg-kumo-brand"
                : "bg-kumo-subtle"
          }`}
          aria-hidden
        />
        {connected ? "Connected" : connecting ? "Connecting" : "Disconnected"}
      </div>
      <div className="space-y-3">
        {visibleEvents.length > 0 ? (
          visibleEvents.map((event, index) => (
            <WorkflowAiEventItem
              key={`${event.type}-${event.messageId ?? event.callId ?? event.timestamp}-${index}`}
              event={event}
              currentParticipantId={currentParticipantId}
            />
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-kumo-line px-3 py-8 text-center text-sm text-kumo-subtle">
            No messages yet.
          </div>
        )}
        {isProcessing ? (
          <div className="flex items-center gap-2 rounded-lg bg-kumo-base px-3 py-2 text-sm text-kumo-subtle ring-1 ring-kumo-hairline">
            <S0Loader size={14} />
            Thinking
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function WorkflowAiEventItem({
  event,
  currentParticipantId,
}: {
  event: SandboxEvent
  currentParticipantId: string | null
}) {
  const time = new Date(event.timestamp * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })

  if (event.type === "user_message") {
    const isCurrentUser =
      event.author?.participantId && currentParticipantId
        ? event.author.participantId === currentParticipantId
        : true
    return (
      <div className="ml-8 rounded-2xl bg-kumo-tint p-3">
        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-kumo-subtle">
          <span>{isCurrentUser ? "You" : (event.author?.name ?? "User")}</span>
          <span>{time}</span>
        </div>
        <div className="whitespace-pre-wrap text-sm text-kumo-default">
          {getWorkflowAiUserDisplayContent(event.content)}
        </div>
      </div>
    )
  }

  if (event.type === "token" && event.content) {
    return (
      <div className="mr-6 rounded-2xl bg-kumo-base p-3 ring-1 ring-kumo-hairline">
        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-kumo-subtle">
          <span className="flex items-center gap-1">
            <S0LogoSvg className="h-4 w-4 text-kumo-brand" aria-hidden />
            Agent
          </span>
          <span>{time}</span>
        </div>
        <SafeMarkdown content={event.content} className="text-sm" />
      </div>
    )
  }

  if (event.type === "tool_call") {
    return (
      <div className="rounded-lg bg-kumo-base px-3 py-2 text-xs text-kumo-subtle ring-1 ring-kumo-hairline">
        <span className="font-medium text-kumo-default">{event.tool}</span>
      </div>
    )
  }

  if (event.type === "step_limit_warning") {
    return (
      <div className="rounded-lg bg-kumo-warning-tint/10 px-3 py-2 text-xs text-kumo-warning ring-1 ring-kumo-warning/30">
        {event.content ??
          "The agent reached the step limit and is finishing from existing context."}
      </div>
    )
  }

  if (event.type === "execution_complete") {
    if (event.success === false) {
      return (
        <div className="rounded-lg bg-kumo-danger-tint px-3 py-2 text-xs text-kumo-danger ring-1 ring-kumo-danger">
          {event.error ?? "Execution failed"}
        </div>
      )
    }
    return (
      <div className="flex items-center justify-center gap-2 text-[11px] uppercase text-kumo-subtle">
        <span className="h-px flex-1 bg-kumo-hairline" />
        Draft checked
        <span className="h-px flex-1 bg-kumo-hairline" />
      </div>
    )
  }

  if (event.type === "error") {
    return (
      <div className="rounded-lg bg-kumo-danger-tint px-3 py-2 text-xs text-kumo-danger ring-1 ring-kumo-danger">
        {event.error ?? "Unknown error"}
      </div>
    )
  }

  return null
}

export function getWorkflowAiVisibleEvents(events: SandboxEvent[]): SandboxEvent[] {
  const latestTokenByMessageId = new Map<string, SandboxEvent>()
  for (const event of events) {
    if (event.type === "token") {
      latestTokenByMessageId.set(event.messageId, event)
    }
  }

  return events.filter((event) => {
    if (event.type === "token") {
      return latestTokenByMessageId.get(event.messageId) === event
    }
    return (
      event.type === "user_message" ||
      event.type === "tool_call" ||
      event.type === "step_limit_warning" ||
      event.type === "execution_complete" ||
      event.type === "error"
    )
  })
}

export function getWorkflowAiUserDisplayContent(content: string): string {
  const editMarker = "Requested edit:"
  const buildMarker = "User request:"
  const yamlMarker = "Current Workflow YAML:"
  const editIndex = content.indexOf(editMarker)
  if (editIndex >= 0) {
    const yamlIndex = content.indexOf(yamlMarker, editIndex)
    return content
      .slice(editIndex + editMarker.length, yamlIndex >= 0 ? yamlIndex : undefined)
      .trim()
  }
  const buildIndex = content.indexOf(buildMarker)
  return buildIndex >= 0 ? content.slice(buildIndex + buildMarker.length).trim() : content
}

export async function fetchWorkflowAiDraft(
  sessionId: string,
): Promise<WorkflowBuilderDraft | null> {
  const response = await requestJson<{ draft: WorkflowBuilderDraft | null }>(
    `/api/workflows/builder/drafts/latest?sessionId=${encodeURIComponent(sessionId)}`,
  )
  return response.draft
}
