import { useNavigate } from "@tanstack/react-router"
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
import { useAuthSession } from "@/lib/auth-client"
import { isIdleRuntimeStatus } from "@/lib/runtime-status"
import {
  shouldUsePromptHttpStream,
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

  const handleArchive = useCallback(async () => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/archive`, {
        method: "POST",
      })
      if (!response.ok) {
        throw new Error(`Failed to archive session: ${response.status}`)
      }
    } catch (errorValue) {
      setPromptError(getErrorMessage(errorValue))
    }
  }, [sessionId])

  const handleUnarchive = useCallback(async () => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/unarchive`, {
        method: "POST",
      })
      if (!response.ok) {
        throw new Error(`Failed to unarchive session: ${response.status}`)
      }
    } catch (errorValue) {
      setPromptError(getErrorMessage(errorValue))
    }
  }, [sessionId])

  const [prompt, setPrompt] = useState("")
  const isArchived = sessionState?.status === "archived"
  const [streamedAssistantText, setStreamedAssistantText] = useState("")
  const [isSubmittingPrompt, setIsSubmittingPrompt] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)
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
    [allModels],
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
        const response = await fetch(`/api/sessions/${sessionId}/tools`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tools: value.tools,
            customMcpServers: value.customMcpServers,
            isolateStepLimit: value.isolateStepLimit,
            ...(sessionState?.agentRuntime === "isolate" ? { subagents: value.subagents } : {}),
          }),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => null)
          throw new Error(
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Failed to update agent tools",
          )
        }
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
  }, [navigate, sessionId, toolsSearch])

  useEffect(() => {
    if (sessionState?.model) {
      const matchingModel = allModels.find((model) => model.id === sessionState.model)
      const defaultModel = allModels.find((model) => model.id === providerCatalog?.defaultModel)
      setSelectedModel(matchingModel?.id ?? defaultModel?.id ?? sessionState.model)
      setReasoningEffort(sessionState.reasoningEffort ?? matchingModel?.reasoning?.default)
      return
    }

    if (providerCatalog?.defaultModel) {
      setSelectedModel((current) =>
        current && allModels.some((model) => model.id === current)
          ? current
          : (allModels.find((model) => model.id === providerCatalog.defaultModel)?.id ?? ""),
      )
    }
  }, [allModels, providerCatalog?.defaultModel, sessionState?.model, sessionState?.reasoningEffort])

  useEffect(() => {
    if (!selectedModelOption?.reasoning) {
      setReasoningEffort(undefined)
      return
    }

    const reasoning = selectedModelOption.reasoning

    setReasoningEffort((current) =>
      current && reasoning.efforts.some((effort) => effort === current)
        ? current
        : reasoning.default,
    )
  }, [selectedModelOption])

  useEffect(() => {
    if (isArchived) {
      setModelDialogOpen(false)
    }
  }, [isArchived])

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

  const [homeBootThinking, setHomeBootThinking] = useState(false)

  useLayoutEffect(() => {
    if (boot !== "1") {
      return
    }

    setHomeBootThinking(true)
    void navigate({
      to: "/session/$id",
      params: { id: sessionId },
      search: (prev) => {
        return { ...prev, boot: undefined }
      },
      replace: true,
    })
  }, [boot, navigate, sessionId])

  useEffect(() => {
    if (toolsSearch === "step-limit") {
      setToolsDialogOpen(true)
    }
  }, [toolsSearch])

  useEffect(() => {
    if (homeBootThinking && isProcessing) {
      setHomeBootThinking(false)
    }
  }, [homeBootThinking, isProcessing])

  useEffect(() => {
    if (!homeBootThinking) {
      return
    }
    const hasTerminalEvent = events.some(
      (event) => event.type === "error" || event.type === "execution_complete",
    )
    if (isIdleRuntimeStatus(runtimeStatus) || sessionState?.runtimeError || hasTerminalEvent) {
      setHomeBootThinking(false)
    }
  }, [events, homeBootThinking, runtimeStatus, sessionState?.runtimeError])

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
      setPromptError(msg)
      setHomeBootThinking(false)
    }
  }, [sessionId])

  useEffect(() => {
    const reconnectKey = `${oktaReconnect ?? "none"}:${resumeMessageId ?? ""}:${
      oktaReconnectError ?? ""
    }`
    if (!oktaReconnect || handledOktaReconnectRef.current === reconnectKey) {
      return
    }
    handledOktaReconnectRef.current = reconnectKey

    if (oktaReconnect === "complete") {
      setPromptError(null)
      setCollapseOktaReconnectErrors(true)

      void (async () => {
        try {
          const response = await submitSessionResume({
            sessionId,
            messageId: resumeMessageId,
            reason: "okta_reconnect",
          })
          if (!response.ok) {
            const data = await response.json().catch(() => null)
            throw new Error(
              data && typeof data === "object" && "error" in data && typeof data.error === "string"
                ? data.error
                : "Okta authentication completed, but no resumable failed request was found.",
            )
          }
        } catch (errorValue) {
          setPromptError(getErrorMessage(errorValue))
        }
      })()
    } else if (oktaReconnect === "error") {
      setPromptError(formatOktaReconnectError(oktaReconnectError))
    } else {
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
  }, [navigate, oktaReconnect, oktaReconnectError, resumeMessageId, sessionId])

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
        const response = await submitSessionPrompt({
          sessionId,
          content: nextPrompt,
          model: resolvedModelId,
          reasoningEffort,
          stream,
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(errorText || "Failed to send prompt")
        }

        if (!stream || !response.body) {
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
