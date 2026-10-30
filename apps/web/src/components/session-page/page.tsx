import { useNavigate } from "@tanstack/react-router"
import type { UpdateSessionToolsPayload } from "@solzero/api"
import {
  getGitHubRepoTool,
  isAgentRuntimeCompatibleWithProvider,
  resolveAgentRuntime,
  type OpenCodeMcpServers,
  type ProviderSettingsResponse,
  type SessionToolSpec,
  type SubagentMode,
} from "@solzero/shared"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { S0Loader } from "@/components/s0-loader"
import { SidebarLayout } from "@/components/sidebar-layout"
import {
  formatOktaReconnectError,
  resolveOAuthCallbackError,
} from "@/components/settings/okta-reconnect"
import { useProviderSettings } from "@/hooks/use-provider-settings"
import { useSessionSocket } from "@/hooks/use-session-socket"
import { runApi } from "@/lib/api-client"
import { useAuthSession } from "@/lib/auth-client"
import { isIdleRuntimeStatus } from "@/lib/runtime-status"
import {
  shouldUsePromptHttpStream,
  streamSessionPrompt,
  submitSessionPrompt,
  submitSessionResume,
  takeSessionPromptError,
} from "@/lib/session-prompt"
import { useSessionReplay } from "@/lib/use-session-replay"
import { SessionContent } from "./content"
import { getErrorMessage } from "./event-items"

export function SessionPage({
  search,
  sessionId,
  initialProviderSettings = null,
}: {
  search: any
  sessionId: string
  initialProviderSettings?: ProviderSettingsResponse | null
}) {
  const { data: authSession, status: authStatus } = useAuthSession()
  const isAdmin = authSession?.isAdmin === true

  const {
    boot,
    tools: toolsSearch,
    oktaReconnect,
    resumeMessageId,
    error: oktaReconnectErrorCode,
    error_description: oktaReconnectErrorDescription,
  } = search

  const oktaReconnectError = resolveOAuthCallbackError(
    oktaReconnectErrorCode,
    oktaReconnectErrorDescription,
  )

  const navigate = useNavigate({ from: "/session/$id" })

  const { catalog: providerCatalog, loading: providerLoading } = useProviderSettings({
    initialData: initialProviderSettings,
  })

  const rawModelOptions = useMemo(
    () => providerCatalog?.modelOptions ?? [],
    [providerCatalog?.modelOptions],
  )

  const providerDefaultModelConfigured = Boolean(providerCatalog?.defaultModel)

  const {
    connected,
    connecting,
    authError,
    connectionError,
    sessionState,
    events,
    runtimeActivity,
    runtimeActivityLoading,
    runtimeActivityError,
    participants,
    artifacts,
    currentParticipantId,
    isProcessing,
    loadingHistory,
    replyToInteraction,
    stopExecution,
    sendTyping,
    reconnect,
    loadOlderEvents,
  } = useSessionSocket(sessionId)

  const agentRuntime = resolveAgentRuntime({
    agentRuntime: sessionState?.agentRuntime ?? sessionState?.capabilities?.agentRuntime,
    sessionKind: sessionState?.sessionKind,
  })

  const modelOptions = useMemo(
    () =>
      rawModelOptions
        .map((group) => ({
          ...group,
          models: group.models.filter((model) =>
            isAgentRuntimeCompatibleWithProvider(agentRuntime, model.providerId, model.providerApi),
          ),
        }))
        .filter((group) => group.models.length > 0),
    [agentRuntime, rawModelOptions],
  )

  const allModels = useMemo(() => modelOptions.flatMap((group) => group.models), [modelOptions])
  const replay = useSessionReplay(events)

  const [prompt, setPrompt] = useState("")
  const isArchived = sessionState?.status === "archived"
  const [streamedAssistantText, setStreamedAssistantText] = useState("")
  const [isSubmittingPrompt, setIsSubmittingPrompt] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)

  const handleArchive = useCallback(async () => {
    try {
      await runApi((client) => client.sessions.archive({ params: { id: sessionId } }), {
        fallbackMessage: "Failed to archive session",
      })
    } catch (errorValue) {
      setPromptError(getErrorMessage(errorValue))
    }
  }, [sessionId, setPromptError])

  const handleUnarchive = useCallback(async () => {
    try {
      await runApi((client) => client.sessions.unarchive({ params: { id: sessionId } }), {
        fallbackMessage: "Failed to unarchive session",
      })
    } catch (errorValue) {
      setPromptError(getErrorMessage(errorValue))
    }
  }, [sessionId, setPromptError])

  const [collapseOktaReconnectErrors, setCollapseOktaReconnectErrors] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string>("")
  const [reasoningEffort, setReasoningEffort] = useState<string | undefined>(undefined)
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [toolsDialogOpen, setToolsDialogOpen] = useState(false)
  const [isSavingTools, setIsSavingTools] = useState(false)
  const [toolsError, setToolsError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const handledOktaReconnectRef = useRef<string | null>(null)

  const selectedModelOption = useMemo(
    () => allModels.find((model) => model.id === selectedModel) ?? null,
    [allModels, selectedModel],
  )

  const resolvedModelId =
    selectedModel || sessionState?.model || providerCatalog?.defaultModel || ""

  const selectedModelLabel = selectedModelOption?.name || "select model"
  const sessionRepoTool = getGitHubRepoTool(sessionState?.tools)

  const sessionRepoFullName = sessionRepoTool
    ? `${sessionRepoTool.repoOwner}/${sessionRepoTool.repoName}`
    : sessionState?.repoOwner && sessionState.repoName
      ? `${sessionState.repoOwner}/${sessionState.repoName}`
      : null

  const sessionToolCount = sessionState
    ? (sessionState.tools?.filter((tool) => tool.kind !== "github_repo").length ?? 0) +
      Object.keys(sessionState.customMcpServers ?? {}).length
    : 0

  const runtimeStatus = sessionState?.runtimeStatus ?? sessionState?.sandboxStatus

  const handleModelChange = useCallback(
    (model: string) => {
      setSelectedModel(model)
      const nextModel = allModels.find((item) => item.id === model)
      setReasoningEffort(nextModel?.reasoning?.default)
    },
    [allModels, setReasoningEffort],
  )

  const handleSaveTools = useCallback(
    async (value: {
      tools: SessionToolSpec[]
      customMcpServers: OpenCodeMcpServers
      isolateStepLimit: number
      subagents: SubagentMode
    }) => {
      setIsSavingTools(true)
      setToolsError(null)

      try {
        await runApi(
          (client) =>
            client.sessions.tools({
              params: { id: sessionId },
              payload: buildSessionToolsPatchBody(value, sessionState?.agentRuntime === "isolate"),
            }),
          { fallbackMessage: "Failed to update agent tools" },
        )
      } catch (errorValue) {
        setToolsError(
          errorValue instanceof Error ? errorValue.message : "Failed to update agent tools",
        )
        throw errorValue
      } finally {
        setIsSavingTools(false)
      }
    },
    [sessionId, sessionState?.agentRuntime],
  )

  const handleCloseToolsDialog = useCallback(() => {
    setToolsDialogOpen(false)

    if (toolsSearch === "step-limit") {
      void navigate({
        to: "/session/$id",
        params: { id: sessionId },
        search: (prev) => ({ ...prev, tools: undefined }),
        replace: true,
      })
    }
  }, [navigate, sessionId, toolsSearch, setToolsDialogOpen])

  // Adjust the selected model while rendering when the session or catalog default changes.
  const modelSource = {
    allModels,
    defaultModel: providerCatalog?.defaultModel,
    model: sessionState?.model,
    reasoningEffort: sessionState?.reasoningEffort,
  }

  const [syncedModelSource, setSyncedModelSource] = useState<typeof modelSource | null>(null)

  if (
    syncedModelSource?.allModels !== modelSource.allModels ||
    syncedModelSource.defaultModel !== modelSource.defaultModel ||
    syncedModelSource.model !== modelSource.model ||
    syncedModelSource.reasoningEffort !== modelSource.reasoningEffort
  ) {
    setSyncedModelSource(modelSource)
    const { defaultModel, model, reasoningEffort: sessionReasoningEffort } = modelSource

    if (model) {
      const matchingModel = allModels.find((item) => item.id === model)
      const defaultOption = allModels.find((item) => item.id === defaultModel)
      setSelectedModel(matchingModel?.id ?? defaultOption?.id ?? model)
      setReasoningEffort(sessionReasoningEffort ?? matchingModel?.reasoning?.default)
    } else if (defaultModel) {
      setSelectedModel((current) =>
        current && allModels.some((item) => item.id === current)
          ? current
          : (allModels.find((item) => item.id === defaultModel)?.id ?? ""),
      )
    }
  }

  // Keep the reasoning effort valid for the selected model.
  const [reasoningModelOption, setReasoningModelOption] = useState(selectedModelOption)

  if (reasoningModelOption !== selectedModelOption) {
    setReasoningModelOption(selectedModelOption)
    const reasoning = selectedModelOption?.reasoning

    setReasoningEffort((current) =>
      reasoning
        ? current && reasoning.efforts.some((effort) => effort === current)
          ? current
          : reasoning.default
        : undefined,
    )
  }

  if (isArchived && modelDialogOpen) {
    setModelDialogOpen(false)
  }

  useEffect(() => {
    if (!isProcessing && !isSubmittingPrompt && streamedAssistantText) {
      const timeout = setTimeout(() => {
        setStreamedAssistantText("")
      }, 150)

      return () => clearTimeout(timeout)
    }
  }, [isProcessing, isSubmittingPrompt, streamedAssistantText])

  useEffect(() => {
    if (authStatus === "unauthenticated") {
      void navigate({ to: "/" })
    }
  }, [authStatus, navigate])

  const [homeBootThinking, setHomeBootThinking] = useState(boot === "1")
  const [thinkingBoot, setThinkingBoot] = useState(boot)

  if (thinkingBoot !== boot) {
    setThinkingBoot(boot)

    if (boot === "1") {
      setHomeBootThinking(true)
    }
  }

  useLayoutEffect(() => {
    if (boot !== "1") {
      return
    }

    void navigate({
      to: "/session/$id",
      params: { id: sessionId },
      search: (prev) => {
        return { ...prev, boot: undefined }
      },
      replace: true,
    })
  }, [boot, navigate, sessionId])

  const [dialogToolsSearch, setDialogToolsSearch] = useState<typeof toolsSearch | null>(null)

  if (dialogToolsSearch !== toolsSearch) {
    setDialogToolsSearch(toolsSearch)

    if (toolsSearch === "step-limit") {
      setToolsDialogOpen(true)
    }
  }

  // Stop the boot indicator once the run starts, finishes, or fails.
  if (
    homeBootThinking &&
    (isProcessing ||
      isIdleRuntimeStatus(runtimeStatus) ||
      sessionState?.runtimeError ||
      events.some((event) => event.type === "error" || event.type === "execution_complete"))
  ) {
    setHomeBootThinking(false)
  }

  useEffect(() => {
    if (!homeBootThinking) {
      return
    }

    const id = window.setTimeout(() => setHomeBootThinking(false), 120_000)

    return () => window.clearTimeout(id)
  }, [homeBootThinking])

  useEffect(() => {
    const msg = takeSessionPromptError(sessionId)

    if (msg) {
      // oxlint-disable-next-line react/set-state-in-effect -- takeSessionPromptError consumes a one-shot value from browser storage, so it cannot run during render.
      setPromptError(msg)
      setHomeBootThinking(false)
    }
  }, [sessionId])

  // Show the Okta reconnect result while rendering; the effect below resumes the session.
  const oktaReconnectKey = `${oktaReconnect ?? "none"}:${resumeMessageId ?? ""}:${
    oktaReconnectError ?? ""
  }`

  const [shownOktaReconnectKey, setShownOktaReconnectKey] = useState<string | null>(null)

  if (shownOktaReconnectKey !== oktaReconnectKey) {
    setShownOktaReconnectKey(oktaReconnectKey)

    if (oktaReconnect === "complete") {
      setPromptError(null)
      setCollapseOktaReconnectErrors(true)
    } else if (oktaReconnect === "error") {
      setPromptError(formatOktaReconnectError(oktaReconnectError))
    }
  }

  useEffect(() => {
    const reconnectKey = oktaReconnectKey

    if (!oktaReconnect || handledOktaReconnectRef.current === reconnectKey) {
      return
    }

    handledOktaReconnectRef.current = reconnectKey

    if (oktaReconnect === "complete") {
      void (async () => {
        try {
          await submitSessionResume({
            sessionId,
            messageId: resumeMessageId,
            reason: "okta_reconnect",
          })
        } catch (errorValue) {
          setPromptError(getErrorMessage(errorValue))
        }
      })()
    } else if (oktaReconnect !== "error") {
      return
    }

    void navigate({
      to: "/session/$id",
      params: { id: sessionId },
      search: (prev) => ({
        ...prev,
        oktaReconnect: undefined,
        resumeMessageId: undefined,
        error: undefined,
        error_description: undefined,
      }),
      replace: true,
    })
  }, [navigate, oktaReconnect, oktaReconnectKey, resumeMessageId, sessionId])

  const submitPrompt = useCallback(() => {
    if (
      isArchived ||
      replay.isReplaying ||
      !prompt.trim() ||
      isProcessing ||
      isSubmittingPrompt ||
      modelOptions.length === 0 ||
      !resolvedModelId
    ) {
      return
    }

    const nextPrompt = prompt
    setPromptError(null)
    setStreamedAssistantText("")

    const stream = shouldUsePromptHttpStream({
      agentRuntime,
      sessionKind: sessionState?.sessionKind,
      connected,
    })

    setPrompt("")
    setIsSubmittingPrompt(true)

    void (async () => {
      try {
        const input = {
          sessionId,
          content: nextPrompt,
          model: resolvedModelId,
          reasoningEffort,
        }

        if (!stream) {
          await submitSessionPrompt(input)

          return
        }

        const response = await streamSessionPrompt(input)

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(errorText || "Failed to send prompt")
        }

        if (!response.body) {
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let accumulated = ""

        while (true) {
          const { value, done } = await reader.read()

          if (done) {
            break
          }

          if (!value) {
            continue
          }

          accumulated += decoder.decode(value, { stream: true })
          setStreamedAssistantText(accumulated)
        }

        accumulated += decoder.decode()
        setStreamedAssistantText(accumulated)
      } catch (errorValue) {
        setPromptError(errorValue instanceof Error ? errorValue.message : "Failed to send prompt")
      } finally {
        setIsSubmittingPrompt(false)
      }
    })()
  }, [
    connected,
    isArchived,
    isProcessing,
    isSubmittingPrompt,
    modelOptions.length,
    prompt,
    replay.isReplaying,
    reasoningEffort,
    resolvedModelId,
    sessionId,
    agentRuntime,
    sessionState?.sessionKind,
    setPromptError,
    setStreamedAssistantText,
    setPrompt,
    setIsSubmittingPrompt,
  ])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      submitPrompt()
    },
    [submitPrompt],
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value)

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    typingTimeoutRef.current = setTimeout(() => {
      sendTyping()
    }, 300)
  }

  if (authStatus === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <S0Loader size={32} />
      </div>
    )
  }

  const displayEvents = replay.isReplaying ? replay.events : events
  const displayIsProcessing = replay.isReplaying ? replay.isProcessing : isProcessing

  return (
    <SidebarLayout>
      <SessionContent
        sessionId={sessionId}
        sessionState={sessionState}
        connected={connected}
        connecting={connecting}
        authError={authError}
        connectionError={connectionError}
        reconnect={reconnect}
        participants={participants}
        events={displayEvents}
        runtimeActivity={runtimeActivity}
        runtimeActivityLoading={runtimeActivityLoading}
        runtimeActivityError={runtimeActivityError}
        artifacts={artifacts}
        currentParticipantId={currentParticipantId}
        messagesEndRef={messagesEndRef}
        prompt={prompt}
        streamedAssistantText={replay.isReplaying ? "" : streamedAssistantText}
        isProcessing={displayIsProcessing}
        isSubmittingPrompt={isSubmittingPrompt}
        promptError={promptError}
        setPromptError={setPromptError}
        collapseOktaReconnectErrors={collapseOktaReconnectErrors}
        isAdmin={isAdmin}
        selectedModel={selectedModel}
        selectedModelLabel={selectedModelLabel}
        selectedModelOption={selectedModelOption}
        modelOptions={modelOptions}
        providerCatalogLoading={providerLoading}
        providerDefaultModelConfigured={providerDefaultModelConfigured}
        reasoningEffort={reasoningEffort}
        modelDialogOpen={modelDialogOpen}
        toolsDialogOpen={toolsDialogOpen}
        toolsSearch={toolsSearch}
        sessionToolCount={sessionToolCount}
        sessionRepoFullName={sessionRepoFullName}
        isSavingTools={isSavingTools}
        toolsError={toolsError}
        inputRef={inputRef}
        handleSubmit={handleSubmit}
        handleSaveTools={handleSaveTools}
        handleCloseToolsDialog={handleCloseToolsDialog}
        handleInputChange={handleInputChange}
        handleKeyDown={handleKeyDown}
        setToolsDialogOpen={setToolsDialogOpen}
        setModelDialogOpen={setModelDialogOpen}
        setSelectedModel={handleModelChange}
        setReasoningEffort={setReasoningEffort}
        replyToInteraction={replyToInteraction}
        stopExecution={stopExecution}
        handleArchive={handleArchive}
        handleUnarchive={handleUnarchive}
        loadingHistory={loadingHistory}
        loadOlderEvents={loadOlderEvents}
        homeBootThinking={replay.isReplaying ? false : homeBootThinking}
        isReplaying={replay.isReplaying}
        isReplayPaused={replay.isPaused}
        showDebugMenu={isAdmin}
        onReplay={replay.start}
        onToggleReplayPaused={replay.togglePause}
        onStopReplay={replay.stop}
      />
    </SidebarLayout>
  )
}

function buildSessionToolsPatchBody(
  value: {
    tools: SessionToolSpec[]
    customMcpServers: OpenCodeMcpServers
    isolateStepLimit: number
    subagents: SubagentMode
  },
  includeSubagents: boolean,
): UpdateSessionToolsPayload {
  const body = {
    tools: value.tools,
    customMcpServers: value.customMcpServers,
    isolateStepLimit: value.isolateStepLimit,
  }

  return includeSubagents ? { ...body, subagents: value.subagents } : body
}
