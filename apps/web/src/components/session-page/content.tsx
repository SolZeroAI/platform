import { Button } from "@cloudflare/kumo/components/button"
import {
  DEFAULT_ISOLATE_STEP_LIMIT,
  DEFAULT_SUBAGENT_MODE,
  type OpenCodeInteractionResponse,
  type OpenCodeMcpServers,
  type RuntimeModelCategory,
  type RuntimeProviderModelOption,
  type SandboxEvent,
  type SessionToolSpec,
  type SubagentMode,
  summarizeSessionTools,
} from "@solzero/shared"
import {
  ArrowDown,
  ArrowUp,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Square,
  Wrench,
} from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { SessionMoreActionsMenu } from "@/components/action-bar"
import {
  HomeToolbarIconButton,
  TOOLS_TOOLBAR_CLASS_NAME,
} from "@/components/home-toolbar-icon-button"
import {
  AiProviderLoadingButton,
  AiProviderRequiredButton,
} from "@/components/ai-provider-required"
import { HomeSessionToolsDialog } from "@/components/home-session-tools-dialog"
import { getSelectedReasoningLabel, ModelThinkingDialog } from "@/components/model-thinking-dialog"
import { PageHeader } from "@/components/page-header"
import { SafeMarkdown } from "@/components/safe-markdown"
import { ToolCallGroup } from "@/components/tool-call-group"
import { useSessionSocket } from "@/hooks/use-session-socket"
import { showErrorToast } from "@/lib/toast-manager"
import {
  buildToolCallDiscoveryErrorMap,
  collapseTimelineEvents,
  getActiveAssistantTimelineKey,
  getAssistantTimelineKey,
  getAutoExpandedMcpDiscoveryErrorKey,
  getExecutionDurationMsByMessageId,
  getFinalAssistantTimelineKeys,
  getMcpDiscoveryErrorTimelineKey,
  getStreamingExpandedGroupId,
} from "@/lib/session-events"
import { manrope } from "@/lib/fonts"
import { AUTO_SCROLL_BOTTOM_THRESHOLD_PX, groupEvents } from "./events"
import {
  CombinedStatusDot,
  ParticipantsList,
  SessionHeaderRuntimeStatus,
  SessionStatusSidebar,
} from "./status"
import { EventItem, ThinkingIndicator } from "./event-items"
import { SubagentGroup } from "./subagent-group"

export function SessionContent({
  sessionId,
  sessionState,
  connected,
  connecting,
  authError,
  connectionError,
  reconnect,
  participants,
  events,
  runtimeActivity,
  runtimeActivityLoading,
  runtimeActivityError,
  artifacts,
  currentParticipantId,
  messagesEndRef,
  prompt,
  streamedAssistantText,
  isProcessing,
  isSubmittingPrompt,
  promptError,
  setPromptError,
  collapseOktaReconnectErrors,
  isAdmin,
  selectedModel,
  selectedModelLabel,
  selectedModelOption,
  modelOptions,
  providerCatalogLoading,
  providerDefaultModelConfigured,
  reasoningEffort,
  modelDialogOpen,
  toolsDialogOpen,
  toolsSearch,
  sessionToolCount,
  sessionRepoFullName,
  isSavingTools,
  toolsError,
  inputRef,
  handleSubmit,
  handleSaveTools,
  handleCloseToolsDialog,
  handleInputChange,
  handleKeyDown,
  setToolsDialogOpen,
  setModelDialogOpen,
  setSelectedModel,
  setReasoningEffort,
  replyToInteraction,
  stopExecution,
  handleArchive,
  handleUnarchive,
  loadingHistory,
  loadOlderEvents,
  homeBootThinking,
  isReplaying,
  isReplayPaused,
  showDebugMenu,
  onReplay,
  onToggleReplayPaused,
  onStopReplay,
}: {
  sessionId: string
  sessionState: ReturnType<typeof useSessionSocket>["sessionState"]
  connected: boolean
  connecting: boolean
  authError: string | null
  connectionError: string | null
  reconnect: () => void
  participants: ReturnType<typeof useSessionSocket>["participants"]
  events: ReturnType<typeof useSessionSocket>["events"]
  runtimeActivity: ReturnType<typeof useSessionSocket>["runtimeActivity"]
  runtimeActivityLoading: boolean
  runtimeActivityError: string | null
  artifacts: ReturnType<typeof useSessionSocket>["artifacts"]
  currentParticipantId: string | null
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  prompt: string
  streamedAssistantText: string
  isProcessing: boolean
  isSubmittingPrompt: boolean
  promptError: string | null
  setPromptError: (error: string | null) => void
  collapseOktaReconnectErrors: boolean
  isAdmin: boolean
  selectedModel: string
  selectedModelLabel: string
  selectedModelOption: RuntimeProviderModelOption | null
  modelOptions: RuntimeModelCategory[]
  providerCatalogLoading: boolean
  providerDefaultModelConfigured: boolean
  reasoningEffort: string | undefined
  modelDialogOpen: boolean
  toolsDialogOpen: boolean
  toolsSearch?: "step-limit"
  sessionToolCount: number
  sessionRepoFullName: string | null
  isSavingTools: boolean
  toolsError: string | null
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  handleSubmit: (e: React.FormEvent) => void
  handleSaveTools: (value: {
    tools: SessionToolSpec[]
    customMcpServers: OpenCodeMcpServers
    isolateStepLimit: number
    subagents: SubagentMode
  }) => Promise<void>
  handleCloseToolsDialog: () => void
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  handleKeyDown: (e: React.KeyboardEvent) => void
  setToolsDialogOpen: (open: boolean) => void
  setModelDialogOpen: (open: boolean) => void
  setSelectedModel: (model: string) => void
  setReasoningEffort: (value: string | undefined) => void
  replyToInteraction: (response: OpenCodeInteractionResponse) => void
  stopExecution: () => void
  handleArchive: () => void
  handleUnarchive: () => void
  loadingHistory: boolean
  loadOlderEvents: () => void
  homeBootThinking: boolean
  isReplaying: boolean
  isReplayPaused: boolean
  showDebugMenu: boolean
  onReplay: () => void
  onToggleReplayPaused: () => void
  onStopReplay: () => void
}) {
  const isArchived = sessionState?.status === "archived"
  const hasResolvedModel = Boolean(selectedModel || sessionState?.model)
  const canSubmitPrompt =
    !isArchived &&
    !isReplaying &&
    Boolean(prompt.trim()) &&
    !isProcessing &&
    !isSubmittingPrompt &&
    modelOptions.length > 0 &&
    hasResolvedModel
  const selectedReasoningLabel = getSelectedReasoningLabel(selectedModelOption, reasoningEffort)
  const selectedToolsButtonLabel =
    sessionToolCount === 0 ? "Tools" : `tool${sessionToolCount === 1 ? "" : "s"}`
  const selectedToolsAccessibleLabel =
    sessionToolCount === 0 ? "Tools" : `Tools: ${sessionToolCount} ${selectedToolsButtonLabel}`
  const toolbarTooltipHidden = toolsDialogOpen || modelDialogOpen
  const replayToggleLabel = isReplayPaused ? "Resume replay" : "Pause replay"
  const currentError = authError || connectionError
  const runtimeError = sessionState?.runtimeError ?? null
  const [statusSidebarOpen, setStatusSidebarOpen] = useState(false)
  const [animatedCompletionMessageId, setAnimatedCompletionMessageId] = useState<string | null>(
    null,
  )
  const previousTurnBusyRef = useRef(isProcessing || homeBootThinking)

  useEffect(() => {
    if (!currentError) {
      return
    }
    showErrorToast(currentError, {
      actions: [
        {
          children: "Reconnect",
          size: "sm",
          onClick: reconnect,
        },
      ],
    })
  }, [currentError, reconnect])

  useEffect(() => {
    if (!runtimeError) {
      return
    }
    showErrorToast(runtimeError)
  }, [runtimeError])

  useEffect(() => {
    if (!promptError) {
      return
    }
    showErrorToast(promptError)
    setPromptError(null)
  }, [promptError, setPromptError])

  const repoLabel = sessionState
    ? summarizeSessionTools(
        sessionState.tools && sessionState.tools.length > 0
          ? sessionState.tools
          : sessionState.repoOwner && sessionState.repoName
            ? [
                {
                  kind: "github_repo" as const,
                  repoOwner: sessionState.repoOwner,
                  repoName: sessionState.repoName,
                },
              ]
            : [],
        {
          emptyLabel: "No tools",
          customMcpServers: sessionState.customMcpServers,
        },
      )
    : null
  const sessionTitle = sessionState?.title || repoLabel || "Chat agent"

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const hasScrolledRef = useRef(false)
  const isPrependingRef = useRef(false)
  const prevScrollHeightRef = useRef(0)
  const isNearBottomRef = useRef(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  const adjustPromptInputHeight = useCallback(() => {
    const el = inputRef.current
    if (!el) {
      return
    }
    const computed = getComputedStyle(el)
    const lineHeightRaw = computed.lineHeight
    const fontSize = parseFloat(computed.fontSize)
    const lineHeight =
      lineHeightRaw === "normal" || !Number.isFinite(parseFloat(lineHeightRaw))
        ? fontSize * 1.25
        : parseFloat(lineHeightRaw)
    const padding = parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom)
    const minHeight = padding + lineHeight * 2
    const maxHeight = padding + lineHeight * 3

    el.style.height = "auto"
    const contentScrollHeight = el.scrollHeight
    const nextHeight = Math.min(Math.max(contentScrollHeight, minHeight), maxHeight)
    el.style.height = `${nextHeight}px`
    el.style.overflowY = contentScrollHeight > maxHeight ? "auto" : "hidden"
  }, [inputRef])

  useLayoutEffect(() => {
    adjustPromptInputHeight()
  }, [prompt, adjustPromptInputHeight])

  const updateBottomState = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) {
      return
    }

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const isNearBottom = distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX

    isNearBottomRef.current = isNearBottom
    setShowScrollToBottom((current) => {
      const next = !isNearBottom
      return current === next ? current : next
    })
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollContainerRef.current
    if (!el) {
      return
    }

    el.scrollTo({
      top: el.scrollHeight,
      behavior,
    })
    isNearBottomRef.current = true
    setShowScrollToBottom(false)
  }, [])

  const handleScroll = useCallback(() => {
    hasScrolledRef.current = true
    updateBottomState()
  }, [updateBottomState])

  useEffect(() => {
    const sentinel = topSentinelRef.current
    const container = scrollContainerRef.current
    if (!sentinel || !container) {
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (
          entry.isIntersecting &&
          !isReplaying &&
          hasScrolledRef.current &&
          container.scrollHeight > container.clientHeight
        ) {
          prevScrollHeightRef.current = container.scrollHeight
          isPrependingRef.current = true
          loadOlderEvents()
        }
      },
      { root: container, threshold: 0.1 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [isReplaying, loadOlderEvents])

  useEffect(() => {
    updateBottomState()
  }, [updateBottomState])

  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el) {
      return
    }

    if (isPrependingRef.current) {
      el.scrollTop += el.scrollHeight - prevScrollHeightRef.current
      isPrependingRef.current = false
      updateBottomState()
      return
    }

    if (isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight
      updateBottomState()
    }
  }, [events, isProcessing, updateBottomState])

  const groupedEvents = useMemo(() => {
    const timelineEvents = collapseTimelineEvents(events as SandboxEvent[])
    const { discoveryErrorsByCallId, hiddenDiscoveryErrorKeys } =
      buildToolCallDiscoveryErrorMap(timelineEvents)
    const interactionResponsesById = new Map<
      string,
      Extract<SandboxEvent, { type: "interaction_response" }>
    >()
    for (const event of timelineEvents) {
      if (event.type === "interaction_response") {
        interactionResponsesById.set(event.interactionId, event)
      }
    }
    const latestAssistantTimelineKey =
      [...timelineEvents].reverse().map(getAssistantTimelineKey).find(Boolean) ?? null

    const groups = groupEvents(timelineEvents, hiddenDiscoveryErrorKeys)

    return {
      groups,
      discoveryErrorsByCallId,
      executionDurationMsByMessageId: getExecutionDurationMsByMessageId(timelineEvents),
      finalAssistantTimelineKeys: getFinalAssistantTimelineKeys(timelineEvents),
      interactionResponsesById,
      autoExpandedMcpDiscoveryErrorKey: getAutoExpandedMcpDiscoveryErrorKey(
        timelineEvents,
        isProcessing,
      ),
      streamingExpandedGroupId: getStreamingExpandedGroupId(groups, isProcessing),
      latestAssistantTimelineKey,
      activeAssistantTimelineKey: isProcessing
        ? getActiveAssistantTimelineKey(timelineEvents)
        : null,
      latestCompletedMessageId:
        [...timelineEvents]
          .reverse()
          .find(
            (event) =>
              event.type === "execution_complete" &&
              event.success !== false &&
              Boolean(event.messageId),
          )?.messageId ?? null,
    }
  }, [events, isProcessing])

  useEffect(() => {
    const turnBusy = isProcessing || homeBootThinking
    if (previousTurnBusyRef.current && !turnBusy && groupedEvents.latestCompletedMessageId) {
      setAnimatedCompletionMessageId(groupedEvents.latestCompletedMessageId)
      const timeoutId = window.setTimeout(() => {
        setAnimatedCompletionMessageId((current) =>
          current === groupedEvents.latestCompletedMessageId ? null : current,
        )
      }, 900)

      previousTurnBusyRef.current = turnBusy
      return () => window.clearTimeout(timeoutId)
    }

    previousTurnBusyRef.current = turnBusy
  }, [groupedEvents.latestCompletedMessageId, homeBootThinking, isProcessing])

  return (
    <div className="h-full flex flex-col">
      <HomeSessionToolsDialog
        open={toolsDialogOpen}
        onClose={handleCloseToolsDialog}
        selectedTools={
          sessionState?.tools && sessionState.tools.length > 0
            ? sessionState.tools
            : sessionState?.repoOwner && sessionState.repoName
              ? [
                  {
                    kind: "github_repo" as const,
                    repoOwner: sessionState.repoOwner,
                    repoName: sessionState.repoName,
                  },
                ]
              : []
        }
        customMcpServers={sessionState?.customMcpServers ?? {}}
        isolateStepLimit={sessionState?.isolateStepLimit ?? DEFAULT_ISOLATE_STEP_LIMIT}
        subagents={sessionState?.subagents ?? DEFAULT_SUBAGENT_MODE}
        showSubagents={sessionState?.agentRuntime === "isolate"}
        focusStepLimit={toolsSearch === "step-limit"}
        onSave={handleSaveTools}
        saveLabel="Update tools"
        saving={isSavingTools}
        error={toolsError ?? undefined}
      />

      <PageHeader
        actions={
          <div className="flex items-center gap-4">
            <div className="md:hidden">
              <CombinedStatusDot
                connected={connected}
                connecting={connecting}
                sessionKind={sessionState?.sessionKind}
                agentRuntime={sessionState?.agentRuntime}
                runtimeStatus={sessionState?.runtimeStatus ?? sessionState?.sandboxStatus}
                capabilities={sessionState?.capabilities}
              />
            </div>
            <div className="hidden md:contents">
              <SessionHeaderRuntimeStatus
                connected={connected}
                connecting={connecting}
                runtimeStatus={sessionState?.runtimeStatus ?? sessionState?.sandboxStatus}
                sessionKind={sessionState?.sessionKind}
                agentRuntime={sessionState?.agentRuntime}
                capabilities={sessionState?.capabilities}
              />
              <button
                type="button"
                onClick={() => setStatusSidebarOpen((open) => !open)}
                className="p-1.5 text-kumo-subtle transition hover:bg-kumo-tint hover:text-kumo-default"
                title={statusSidebarOpen ? "Close agent status" : "Open agent status"}
                aria-label={statusSidebarOpen ? "Close agent status" : "Open agent status"}
                aria-expanded={statusSidebarOpen}
              >
                {statusSidebarOpen ? (
                  <PanelRightClose className="h-4 w-4" aria-hidden />
                ) : (
                  <PanelRightOpen className="h-4 w-4" aria-hidden />
                )}
              </button>
              <ParticipantsList participants={participants} />
            </div>
          </div>
        }
      >
        <h1 className="min-w-0 truncate text-lg font-medium text-kumo-default">{sessionTitle}</h1>
      </PageHeader>

      <main className="flex-1 flex overflow-hidden">
        <div className="session-messages-pane relative flex-1 min-w-0">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="transparent-scrollbar h-full overflow-y-auto p-4"
          >
            <div className="max-w-3xl mx-auto space-y-2">
              <div ref={topSentinelRef} className="h-1" />
              {loadingHistory && (
                <div className="text-center text-kumo-subtle text-sm py-2">Loading...</div>
              )}
              {isReplaying && (
                <div className="sticky top-0 z-10 rounded-lg border border-kumo-line bg-kumo-elevated/95 px-4 py-3 text-sm text-kumo-default shadow-sm backdrop-blur">
                  <div className="flex items-center justify-between gap-3">
                    <span>{isReplayPaused ? "Replay paused" : "Replaying session"}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={onToggleReplayPaused}
                        title={replayToggleLabel}
                        aria-label={replayToggleLabel}
                        className="relative flex h-8 w-8 items-center justify-center rounded-md text-kumo-subtle transition-[background-color,color,scale] hover:bg-kumo-tint hover:text-kumo-default active:scale-[0.96]"
                      >
                        <span
                          className={[
                            "absolute flex items-center justify-center transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
                            isReplayPaused
                              ? "scale-100 opacity-100 blur-0"
                              : "scale-[0.25] opacity-0 blur-[4px]",
                          ].join(" ")}
                        >
                          <Play className="ml-0.5 h-3.5 w-3.5" aria-hidden />
                        </span>
                        <span
                          className={[
                            "flex items-center justify-center transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
                            isReplayPaused
                              ? "scale-[0.25] opacity-0 blur-[4px]"
                              : "scale-100 opacity-100 blur-0",
                          ].join(" ")}
                        >
                          <Pause className="h-3.5 w-3.5" aria-hidden />
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={onStopReplay}
                        className="rounded-md px-2 py-1 text-xs font-medium text-kumo-subtle transition hover:bg-kumo-tint hover:text-kumo-default"
                      >
                        Stop
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {groupedEvents.groups.map((group) =>
                group.type === "tool_group" ? (
                  <ToolCallGroup
                    key={group.id}
                    events={group.events}
                    groupId={group.id}
                    discoveryErrorsByCallId={groupedEvents.discoveryErrorsByCallId}
                    isStreamingFocus={group.id === groupedEvents.streamingExpandedGroupId}
                    isProcessing={isProcessing}
                  />
                ) : group.type === "subagent_group" ? (
                  <SubagentGroup
                    key={group.id}
                    runs={group.runs}
                    groupId={group.id}
                    isStreamingFocus={group.id === groupedEvents.streamingExpandedGroupId}
                    isProcessing={isProcessing}
                  />
                ) : (
                  <EventItem
                    key={group.id}
                    event={group.event}
                    isFinalAssistantResponse={groupedEvents.finalAssistantTimelineKeys.has(
                      getAssistantTimelineKey(group.event) ?? "",
                    )}
                    isActiveAssistantResponse={
                      getAssistantTimelineKey(group.event) ===
                      groupedEvents.activeAssistantTimelineKey
                    }
                    isLatestAssistantMessage={
                      getAssistantTimelineKey(group.event) ===
                      groupedEvents.latestAssistantTimelineKey
                    }
                    executionDurationMs={
                      group.event.type === "execution_complete" && group.event.messageId
                        ? (groupedEvents.executionDurationMsByMessageId.get(
                            group.event.messageId,
                          ) ?? null)
                        : null
                    }
                    currentParticipantId={currentParticipantId}
                    sessionId={sessionId}
                    sessionModel={sessionState?.model}
                    collapseOktaReconnectErrors={collapseOktaReconnectErrors}
                    autoExpandMcpDiscoveryError={
                      getMcpDiscoveryErrorTimelineKey(group.event) ===
                      groupedEvents.autoExpandedMcpDiscoveryErrorKey
                    }
                    isStreamingFocusMcpDiscoveryError={
                      group.event.type === "mcp_discovery_error" &&
                      group.id === groupedEvents.streamingExpandedGroupId
                    }
                    isStreamingFocusReasoning={
                      group.event.type === "reasoning" &&
                      group.id === groupedEvents.streamingExpandedGroupId
                    }
                    isStreamingFocusInteraction={
                      group.event.type === "interaction_request" &&
                      group.id === groupedEvents.streamingExpandedGroupId
                    }
                    isProcessing={isProcessing}
                    interactionResponse={
                      group.event.type === "interaction_request"
                        ? (groupedEvents.interactionResponsesById.get(group.event.interactionId) ??
                          null)
                        : null
                    }
                    onInteractionReply={replyToInteraction}
                    animateExecutionComplete={
                      group.event.type === "execution_complete" &&
                      group.event.messageId === animatedCompletionMessageId
                    }
                  />
                ),
              )}
              {streamedAssistantText && !connected && (
                <div className="group bg-kumo-base p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`${manrope.className} text-xs font-bold text-kumo-subtle`}>
                      Agent
                    </span>
                  </div>
                  <SafeMarkdown content={streamedAssistantText} className="text-sm" />
                </div>
              )}
              {(isProcessing || homeBootThinking) && <ThinkingIndicator />}

              <div ref={messagesEndRef} />
            </div>
          </div>
          {showScrollToBottom && (
            <div className="pointer-events-none absolute bottom-4 right-6 z-10">
              <button
                type="button"
                onClick={() => scrollToBottom("smooth")}
                className="pointer-events-auto flex items-center gap-2 rounded-full border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-default shadow-sm backdrop-blur transition hover:bg-kumo-tint"
                title="Scroll to bottom"
              >
                <ArrowDown className="h-4 w-4" aria-hidden />
                <span>Latest</span>
              </button>
            </div>
          )}
        </div>
        {statusSidebarOpen && (
          <SessionStatusSidebar
            connected={connected}
            connecting={connecting}
            runtimeStatus={sessionState?.runtimeStatus ?? sessionState?.sandboxStatus}
            sessionKind={sessionState?.sessionKind}
            agentRuntime={sessionState?.agentRuntime}
            capabilities={sessionState?.capabilities}
            createdAt={sessionState?.createdAt}
            activity={runtimeActivity}
            loadingActivity={runtimeActivityLoading}
            activityError={runtimeActivityError}
          />
        )}
      </main>

      <footer className="session-composer-footer relative flex-shrink-0">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto p-4">
          {modelDialogOpen && (
            <ModelThinkingDialog
              modelOptions={modelOptions}
              selectedModel={selectedModel}
              selectedModelOption={selectedModelOption}
              reasoningEffort={reasoningEffort}
              showDefaultModelHint={!providerDefaultModelConfigured && modelOptions.length > 0}
              isAdmin={isAdmin}
              onModelSelect={setSelectedModel}
              onReasoningSelect={setReasoningEffort}
              onClose={() => setModelDialogOpen(false)}
            />
          )}

          <div className="overflow-hidden rounded-xl bg-kumo-elevated">
            {isArchived && (
              <div className="border-b border-kumo-hairline px-4 py-3 text-sm text-kumo-subtle">
                This agent is archived. Unarchive it to continue chatting.
              </div>
            )}

            <textarea
              ref={inputRef}
              value={prompt}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={isArchived || isReplaying}
              placeholder={
                isArchived
                  ? "Unarchive this agent to continue"
                  : isReplaying
                    ? "Replaying session"
                    : isProcessing
                      ? "Type your next message..."
                      : "Ask or build anything"
              }
              className="session-composer-textarea session-composer-textarea--ringed min-h-24 w-full resize-none overflow-x-hidden bg-transparent px-4 py-4 text-kumo-default placeholder:text-kumo-placeholder focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              rows={2}
            />

            <div className="flex items-center justify-between px-4 pt-1 pb-2">
              <div className="flex items-center gap-2">
                <SessionMoreActionsMenu
                  sessionId={sessionState?.id || ""}
                  sessionStatus={sessionState?.status || ""}
                  artifacts={artifacts}
                  secretKeys={sessionState?.secretKeys}
                  repoFullName={sessionRepoFullName}
                  onArchive={handleArchive}
                  onUnarchive={handleUnarchive}
                  showDebugMenu={showDebugMenu}
                  onTestError={() =>
                    setPromptError("This is a test error from the dev environment.")
                  }
                  isReplaying={isReplaying}
                  onReplay={onReplay}
                  onStopReplay={onStopReplay}
                  disabled={isArchived}
                />

                <HomeToolbarIconButton
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.blur()
                    if (!isArchived && !isSavingTools && !isReplaying) {
                      setToolsDialogOpen(true)
                    }
                  }}
                  disabled={isArchived || isSavingTools || isReplaying}
                  ariaLabel={selectedToolsAccessibleLabel}
                  tooltip={selectedToolsAccessibleLabel}
                  tooltipHidden={toolbarTooltipHidden}
                  className={sessionToolCount > 0 ? TOOLS_TOOLBAR_CLASS_NAME : undefined}
                >
                  <Wrench className="h-4 w-4 shrink-0" aria-hidden />
                  {sessionToolCount > 0 && (
                    <span
                      aria-hidden
                      className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-medium leading-none text-white tabular-nums"
                    >
                      {sessionToolCount}
                    </span>
                  )}
                </HomeToolbarIconButton>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {(isProcessing || isSubmittingPrompt) && !isReplaying && prompt.trim() && (
                  <span className="text-xs text-kumo-warning whitespace-nowrap">Waiting...</span>
                )}
                {(isProcessing || isSubmittingPrompt) && !isReplaying && (
                  <button
                    type="button"
                    onClick={stopExecution}
                    className="rounded-lg p-2 text-kumo-danger transition hover:bg-kumo-danger-tint/10 hover:text-kumo-danger"
                    title="Stop"
                  >
                    <Square className="h-5 w-5" aria-hidden />
                  </button>
                )}
                {providerCatalogLoading ? (
                  <AiProviderLoadingButton />
                ) : modelOptions.length === 0 ? (
                  <AiProviderRequiredButton
                    isAdmin={isAdmin}
                    disabled={isArchived || isProcessing || isReplaying}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      !isArchived && !isProcessing && !isReplaying && setModelDialogOpen(true)
                    }
                    disabled={isArchived || isProcessing || isReplaying}
                    aria-label={`Model: ${selectedModelLabel}; thinking: ${selectedReasoningLabel}`}
                    className="home-model-control group flex min-h-9 items-center rounded-lg px-2.5 py-1 text-right transition-[background-color,color,opacity,transform] active:scale-[0.96] disabled:opacity-50"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="max-w-40 truncate text-xs font-medium text-kumo-default leading-tight">
                        {selectedModelLabel}
                      </span>
                      <span className="max-w-40 truncate text-xs text-kumo-subtle leading-tight">
                        {selectedReasoningLabel}
                      </span>
                    </span>
                  </button>
                )}
                <Button
                  type="submit"
                  disabled={!canSubmitPrompt}
                  shape="circle"
                  variant="secondary"
                  aria-label="Send"
                  title={
                    isArchived
                      ? "Unarchive this agent to continue"
                      : isReplaying
                        ? "Stop replay to continue"
                        : !hasResolvedModel
                          ? "Choose a model to continue"
                          : (isProcessing || isSubmittingPrompt) && prompt.trim()
                            ? "Wait for execution to complete"
                            : "Send"
                  }
                  icon={<ArrowUp className="h-5 w-5" aria-hidden />}
                />
              </div>
            </div>
          </div>
        </form>
      </footer>
    </div>
  )
}
