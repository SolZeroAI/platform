import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { Link } from "@tanstack/react-router"
import {
  DEFAULT_ISOLATE_STEP_LIMIT,
  isOktaReconnectMcpDiscoveryError,
  getErrorMessage,
  type OpenCodeInteractionResponse,
  type SandboxEvent,
} from "@solzero/shared"
import { AlertCircle, Brain, Check, ChevronRight, Copy, ExternalLink } from "lucide-react"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { SafeMarkdown } from "@/components/safe-markdown"
import {
  buildOktaReconnectSessionPath,
  formatOktaReconnectError,
} from "@/components/settings/okta-reconnect"
import { AnimatedLayerCardPrimary } from "@/components/expandable-layer-card"
import { reconnectOkta } from "@/lib/auth-client"
import { copyToClipboard } from "@/lib/format"
import {
  buildContextForgeTokenSettingsSearch,
  buildMcpSettingsSearchForServer,
  getMcpTokenSettingsTarget,
} from "@/lib/mcp-settings-links"
import { parseReasoningSummary } from "@/lib/reasoning-summary"
import { formatExecutionDuration } from "@/lib/session-events"
import { manrope } from "@/lib/fonts"
import { S0LogoSvg } from "@/components/s0-logo-svg"
import { S0Loader } from "@/components/s0-loader"
import { InteractionRequestItem } from "./interaction-request-item"

export function EventItem({
  event,
  isFinalAssistantResponse,
  isActiveAssistantResponse,
  isLatestAssistantMessage,
  executionDurationMs,
  currentParticipantId,
  sessionId,
  sessionModel,
  collapseOktaReconnectErrors,
  autoExpandMcpDiscoveryError,
  isStreamingFocusMcpDiscoveryError,
  isStreamingFocusReasoning,
  isStreamingFocusInteraction,
  isProcessing,
  interactionResponse,
  onInteractionReply,
  animateExecutionComplete,
}: {
  event: SandboxEvent
  isFinalAssistantResponse: boolean
  isActiveAssistantResponse: boolean
  isLatestAssistantMessage: boolean
  executionDurationMs: number | null
  currentParticipantId: string | null
  sessionId: string | null
  sessionModel?: string
  collapseOktaReconnectErrors: boolean
  autoExpandMcpDiscoveryError: boolean
  isStreamingFocusMcpDiscoveryError: boolean
  isStreamingFocusReasoning: boolean
  isStreamingFocusInteraction: boolean
  isProcessing: boolean
  interactionResponse: Extract<SandboxEvent, { type: "interaction_response" }> | null
  onInteractionReply: (response: OpenCodeInteractionResponse) => void
  animateExecutionComplete: boolean
}) {
  const [copied, setCopied] = useState(false)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const time = new Date(event.timestamp * 1000).toLocaleTimeString()
  const isFinalLikeAssistantResponse =
    event.type === "token" && (isFinalAssistantResponse || isActiveAssistantResponse)

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  const handleCopyContent = useCallback(async (content: string) => {
    const success = await copyToClipboard(content)
    if (!success) {
      return
    }

    setCopied(true)
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current)
    }
    copyTimeoutRef.current = setTimeout(() => {
      setCopied(false)
      copyTimeoutRef.current = null
    }, 1500)
  }, [])

  const buildErrorDiagnostic = useCallback(
    (title: string, detail: string) =>
      [
        `Session: ${sessionId ?? "unknown"}`,
        sessionModel ? `Model: ${sessionModel}` : null,
        `Timestamp: ${new Date(event.timestamp * 1000).toISOString()}`,
        `Type: ${title}`,
        "",
        detail,
      ]
        .filter(Boolean)
        .join("\n"),
    [event.timestamp, sessionId, sessionModel],
  )

  const renderErrorCard = useCallback(
    (title: string, detail: string) => {
      const diagnostic = buildErrorDiagnostic(title, detail)
      return (
        <div className="group rounded-lg bg-kumo-danger-tint p-4 ring-1 ring-kumo-danger">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="h-4 w-4 text-kumo-danger flex-shrink-0" aria-hidden />
              <span className="text-sm font-medium text-kumo-danger">{title}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                onClick={() => handleCopyContent(diagnostic)}
                className="p-1 text-kumo-danger hover:text-kumo-danger hover:bg-kumo-danger-tint opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto transition-colors"
                title={copied ? "Copied" : "Copy error details"}
                aria-label={copied ? "Copied" : "Copy error details"}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                )}
              </button>
              <span className="text-xs text-kumo-subtle">{time}</span>
            </div>
          </div>
          <pre className="whitespace-pre-wrap break-words text-sm text-kumo-danger">{detail}</pre>
          <p className="mt-2 text-xs text-kumo-danger">Copy details to share this error.</p>
        </div>
      )
    },
    [buildErrorDiagnostic, copied, handleCopyContent, time],
  )

  switch (event.type) {
    case "user_message": {
      if (!event.content) {
        return null
      }
      const messageContent = event.content

      const isCurrentUser =
        event.author?.participantId && currentParticipantId
          ? event.author.participantId === currentParticipantId
          : !event.author

      const authorName = isCurrentUser ? "You" : event.author?.name || "Unknown User"

      return (
        <div className="group ml-8 rounded-2xl bg-kumo-tint p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {!isCurrentUser && event.author?.avatar && (
                <img src={event.author.avatar} alt={authorName} className="w-5 h-5 rounded-full" />
              )}
              <span className={`${manrope.className} text-xs font-bold text-kumo-subtle`}>
                {authorName}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleCopyContent(messageContent)}
                className="p-1 text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint/60 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto transition-colors"
                title={copied ? "Copied" : "Copy markdown"}
                aria-label={copied ? "Copied" : "Copy markdown"}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                )}
              </button>
              <span className="text-xs text-kumo-subtle">{time}</span>
            </div>
          </div>
          <pre className="whitespace-pre-wrap text-sm text-kumo-default">{messageContent}</pre>
        </div>
      )
    }

    case "token": {
      if (!event.content) {
        return null
      }
      const messageContent = event.content
      if (isFinalLikeAssistantResponse) {
        return (
          <FinalAssistantMessageItem
            content={messageContent}
            time={time}
            copied={copied}
            onCopy={() => handleCopyContent(messageContent)}
          />
        )
      }

      return (
        <AssistantMessageItem
          content={messageContent}
          time={time}
          isLatest={isLatestAssistantMessage}
          copied={copied}
          onCopy={() => handleCopyContent(messageContent)}
        />
      )
    }

    case "reasoning": {
      if (!event.content) {
        return null
      }
      const messageContent = event.content
      return (
        <ReasoningMessageItem
          content={messageContent}
          time={time}
          copied={copied}
          isStreamingFocus={isStreamingFocusReasoning}
          isProcessing={isProcessing}
          label="Thinking"
          onCopy={handleCopyContent}
        />
      )
    }

    case "tool_call":
      return null

    case "mcp_discovery_error":
      return (
        <McpDiscoveryErrorItem
          event={event}
          time={time}
          sessionId={sessionId}
          collapseAfterOktaReconnect={collapseOktaReconnectErrors}
          autoExpand={autoExpandMcpDiscoveryError}
          isStreamingFocus={isStreamingFocusMcpDiscoveryError}
          isProcessing={isProcessing}
        />
      )

    case "step_limit_warning":
      return <StepLimitWarningItem event={event} sessionId={sessionId} time={time} />

    case "interaction_request":
      return (
        <InteractionRequestItem
          event={event}
          response={interactionResponse}
          time={time}
          isStreamingFocus={isStreamingFocusInteraction}
          isProcessing={isProcessing}
          onInteractionReply={onInteractionReply}
        />
      )

    case "interaction_response":
      return null

    case "resume_started":
      return <ResumeStartedItem time={time} />

    case "tool_result":
      if (!event.error) {
        return null
      }
      return renderErrorCard("Tool failed", event.error)

    case "git_sync":
      return (
        <div className="flex items-center gap-2 text-sm text-kumo-subtle">
          <span className="w-2 h-2 rounded-full bg-kumo-brand" />
          Git sync: {event.status}
          <span className="text-xs">{time}</span>
        </div>
      )

    case "error":
      return renderErrorCard("Error", event.error || "Unknown error")

    case "execution_complete":
      if (event.success === false) {
        return renderErrorCard("Execution failed", event.error || "Unknown error")
      }
      return (
        <ExecutionCompleteDivider
          durationMs={executionDurationMs}
          time={time}
          animate={animateExecutionComplete}
        />
      )

    default:
      return null
  }
}

export function ExecutionCompleteDivider({
  durationMs,
  time,
  animate = false,
}: {
  durationMs: number | null
  time: string
  animate?: boolean
}) {
  const label =
    durationMs == null ? "Completed" : `Completed in ${formatExecutionDuration(durationMs)}`

  return (
    <div
      className="flex w-full items-center gap-3 py-2"
      title={`Execution completed at ${time}`}
      aria-label={`${label} at ${time}`}
    >
      <span className="h-px min-w-0 flex-1 bg-kumo-hairline" aria-hidden />
      <span className="relative flex min-h-5 min-w-32 shrink-0 items-center justify-center">
        {animate && (
          <span
            className="session-turn-status-complete-loader absolute inset-0 flex items-center justify-center text-kumo-brand"
            aria-hidden
          >
            <S0Loader size={18} />
          </span>
        )}
        <span
          className={`shrink-0 text-xs font-medium text-kumo-success tabular-nums ${
            animate ? "session-turn-status-complete-label" : ""
          }`}
        >
          {label}
        </span>
      </span>
      <span className="h-px min-w-0 flex-1 bg-kumo-hairline" aria-hidden />
    </div>
  )
}

export function ThinkingIndicator() {
  return (
    <div
      className="session-turn-status-active flex w-full items-center py-2"
      title="Agent is thinking"
      aria-label="Agent is thinking"
    >
      <span className="h-px min-w-0 flex-1 bg-kumo-hairline" aria-hidden />
      <span className="flex min-h-5 shrink-0 items-center justify-center px-5 text-kumo-brand">
        <span aria-hidden>
          <S0Loader size={18} />
        </span>
      </span>
      <span className="h-px min-w-0 flex-1 bg-kumo-hairline" aria-hidden />
    </div>
  )
}

export function ResumeStartedItem({ time }: { time: string }) {
  const label = "Resuming after Okta authentication"

  return (
    <div
      className="flex w-full items-center gap-3 py-2"
      title={`Resume started at ${time}`}
      aria-label={`${label} at ${time}`}
    >
      <span className="h-px min-w-0 flex-1 bg-kumo-hairline" aria-hidden />
      <span className="shrink-0 text-xs font-medium text-kumo-success">{label}</span>
      <span className="h-px min-w-0 flex-1 bg-kumo-hairline" aria-hidden />
    </div>
  )
}

export function McpDiscoveryErrorItem({
  event,
  time,
  sessionId,
  collapseAfterOktaReconnect,
  autoExpand,
  isStreamingFocus,
  isProcessing,
}: {
  event: SandboxEvent
  time: string
  sessionId: string | null
  collapseAfterOktaReconnect: boolean
  autoExpand: boolean
  isStreamingFocus: boolean
  isProcessing: boolean
}) {
  const contentId = useId()
  const isTerminal = Boolean(
    event.terminal ?? (typeof event.metadata?.terminal === "boolean" && event.metadata.terminal),
  )
  const [isExpanded, setIsExpanded] = useState(autoExpand)
  const [reconnectingOkta, setReconnectingOkta] = useState(false)
  const [reconnectError, setReconnectError] = useState<string | null>(null)
  const userToggledRef = useRef(false)
  const serverName =
    event.serverName ??
    (typeof event.metadata?.serverName === "string" ? event.metadata.serverName : "MCP")
  const error = event.error || "Discovery failed"
  const tokenSettingsTarget = getMcpTokenSettingsTarget(error)
  const canReconnectOkta =
    Boolean(sessionId) && isTerminal && isOktaReconnectMcpDiscoveryError(event)

  useEffect(() => {
    if (collapseAfterOktaReconnect && canReconnectOkta) {
      setIsExpanded(false)
    }
  }, [canReconnectOkta, collapseAfterOktaReconnect])

  useEffect(() => {
    if (!isProcessing) {
      userToggledRef.current = false
    }
  }, [isProcessing])

  useEffect(() => {
    if (!userToggledRef.current) {
      setIsExpanded(isStreamingFocus || autoExpand)
    }
  }, [autoExpand, isStreamingFocus])

  const handleReconnectOkta = useCallback(async () => {
    if (!sessionId) {
      return
    }
    setReconnectError(null)
    setReconnectingOkta(true)
    try {
      await reconnectOkta(
        buildOktaReconnectSessionPath(sessionId, "complete", {
          resumeMessageId: event.messageId,
        }),
        buildOktaReconnectSessionPath(sessionId, "error"),
      )
      setReconnectingOkta(false)
    } catch (errorValue) {
      setReconnectError(
        formatOktaReconnectError(
          errorValue instanceof Error ? errorValue.message : String(errorValue),
        ),
      )
      setReconnectingOkta(false)
    }
  }, [event.messageId, sessionId])

  return (
    <div>
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
            className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm text-kumo-subtle outline-none transition-colors hover:text-kumo-default focus-visible:text-kumo-default"
          >
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-kumo-danger transition-transform duration-200 ${
                isExpanded ? "rotate-90" : ""
              }`}
              aria-hidden
            />
            <AlertCircle className="h-4 w-4 shrink-0 text-kumo-danger" aria-hidden />
            <span className="font-medium text-kumo-default">Discovery</span>
            <span className="truncate text-kumo-subtle">{serverName} MCP unavailable</span>
            <span className="ml-auto shrink-0 text-xs text-kumo-subtle">{time}</span>
          </button>
        </LayerCard.Secondary>
        <AnimatedLayerCardPrimary
          open={isExpanded}
          id={contentId}
          className="gap-0 rounded-lg px-4 py-3 text-xs"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="font-medium text-kumo-danger">MCP server:</span>
            <span className="break-all text-kumo-default">{serverName}</span>
          </div>
          <div>
            <div className="mb-1 font-medium text-kumo-danger">Error:</div>
            <pre className="max-h-48 overflow-x-auto whitespace-pre-wrap text-kumo-default">
              {tokenSettingsTarget?.type === "contextforge" ? (
                <>
                  Configure your ContextForge API token in{" "}
                  <Link
                    to="/settings"
                    search={buildContextForgeTokenSettingsSearch()}
                    hash="contextforge-api-token"
                    className="font-medium text-kumo-danger underline underline-offset-2 transition hover:text-kumo-danger"
                  >
                    Accounts
                  </Link>
                  .
                </>
              ) : tokenSettingsTarget?.type === "server" ? (
                <>
                  Configure your token for {tokenSettingsTarget.serverLabel} in{" "}
                  <Link
                    to="/settings"
                    search={buildMcpSettingsSearchForServer(tokenSettingsTarget.serverLabel)}
                    className="font-medium text-kumo-danger underline underline-offset-2 transition hover:text-kumo-danger"
                  >
                    MCP settings
                  </Link>
                  .
                </>
              ) : (
                error
              )}
            </pre>
            {reconnectError && (
              <div className="mt-3 border border-kumo-danger/30 bg-kumo-danger-tint px-3 py-2 text-kumo-danger">
                {reconnectError}
              </div>
            )}
            {canReconnectOkta && (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={handleReconnectOkta}
                  disabled={reconnectingOkta}
                  className="kumo-inverse-cta inline-flex min-h-10 items-center gap-2 bg-kumo-contrast px-4 py-2 text-sm font-semibold text-kumo-inverse transition-transform hover:opacity-90 active:scale-[0.96] disabled:cursor-wait disabled:opacity-70"
                >
                  {reconnectingOkta ? "Opening Okta..." : "Authenticate with Okta"}
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </button>
              </div>
            )}
          </div>
        </AnimatedLayerCardPrimary>
      </LayerCard>
    </div>
  )
}

export function StepLimitWarningItem({
  event,
  sessionId,
  time,
}: {
  event: SandboxEvent
  sessionId: string | null
  time: string
}) {
  const stepLimit =
    typeof event.stepLimit === "number" ? event.stepLimit : DEFAULT_ISOLATE_STEP_LIMIT
  const message =
    event.content ||
    `The agent reached the ${stepLimit}-step call limit and finished without more tool calls.`
  const linkClass =
    "inline-flex items-center gap-1 rounded-md bg-kumo-warning-tint/10 px-2.5 py-1.5 text-xs font-medium text-kumo-warning ring-1 ring-kumo-warning transition hover:bg-kumo-warning-tint/20 text-kumo-warning"

  return (
    <div className="rounded-lg bg-kumo-warning-tint/10 p-4 text-sm ring-1 ring-kumo-warning">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-kumo-warning" />
          <span className="font-medium text-kumo-default">Step limit reached</span>
        </div>
        <span className="flex-shrink-0 text-xs text-kumo-subtle">{time}</span>
      </div>
      <p className="text-sm text-kumo-subtle">{message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {sessionId ? (
          <Link
            to="/session/$id"
            params={{ id: sessionId }}
            search={(prev) => ({ ...prev, tools: "step-limit" })}
            className={linkClass}
          >
            Increase this session
          </Link>
        ) : null}
        <Link
          to="/settings"
          search={{ category: "providers" }}
          hash="isolate-step-limit"
          className={linkClass}
        >
          Change default
        </Link>
      </div>
    </div>
  )
}

export function AssistantMessageItem({
  content,
  time,
  isLatest,
  copied,
  onCopy,
}: {
  content: string
  time: string
  isLatest: boolean
  copied: boolean
  onCopy: () => void
}) {
  const contentId = useId()
  const [isExpanded, setIsExpanded] = useState(isLatest)
  const userToggledRef = useRef(false)
  const summary = content.replace(/\s+/g, " ").trim()

  useEffect(() => {
    if (isLatest) {
      userToggledRef.current = false
      setIsExpanded(true)
      return
    }
    if (!userToggledRef.current) {
      setIsExpanded(false)
    }
  }, [isLatest])

  return (
    <div className="group py-1">
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
            className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm text-kumo-subtle outline-none transition-colors hover:text-kumo-default focus-visible:text-kumo-default"
          >
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-kumo-brand transition-transform duration-200 ${
                isExpanded ? "rotate-90" : ""
              }`}
              aria-hidden
            />
            <S0LogoSvg className="h-4 w-4 shrink-0 text-kumo-brand" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-kumo-default">Agent</span>{" "}
              <span className="text-kumo-subtle">{summary}</span>
            </span>
            <span className="ml-auto shrink-0 text-xs text-kumo-subtle">{time}</span>
          </button>
        </LayerCard.Secondary>
        <AnimatedLayerCardPrimary open={isExpanded} id={contentId} className="rounded-lg px-4 py-3">
          <div className="relative">
            <button
              type="button"
              onClick={onCopy}
              className="pointer-events-none absolute right-0 top-0 p-1 text-kumo-subtle opacity-0 transition-colors hover:bg-kumo-tint hover:text-kumo-default group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
              title={copied ? "Copied" : "Copy markdown"}
              aria-label={copied ? "Copied" : "Copy markdown"}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
            <SafeMarkdown content={content} className="pr-7 text-sm" />
          </div>
        </AnimatedLayerCardPrimary>
      </LayerCard>
    </div>
  )
}

export function ReasoningMessageItem({
  content,
  time,
  copied,
  isStreamingFocus,
  isProcessing,
  label,
  onCopy,
}: {
  content: string
  time: string
  copied: boolean
  isStreamingFocus: boolean
  isProcessing: boolean
  label: string
  onCopy: (content: string) => void
}) {
  const contentId = useId()
  const [isExpanded, setIsExpanded] = useState(false)
  const userToggledRef = useRef(false)
  const reasoning = parseReasoningSummary(content)
  const title = reasoning.title ?? label
  const body = reasoning.body
  const copyContent = body || content

  useEffect(() => {
    if (!isProcessing) {
      userToggledRef.current = false
      setIsExpanded(false)
    }
  }, [isProcessing])

  useEffect(() => {
    if (userToggledRef.current) {
      return
    }
    setIsExpanded(isStreamingFocus)
  }, [isStreamingFocus])

  return (
    <div className="group py-1">
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
            className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm text-kumo-subtle outline-none transition-colors hover:text-kumo-default focus-visible:text-kumo-default"
          >
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-kumo-brand transition-transform duration-200 ${
                isExpanded ? "rotate-90" : ""
              }`}
              aria-hidden
            />
            <Brain className="h-4 w-4 shrink-0 text-kumo-brand" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium text-kumo-default">{title}</span>
            <span className="ml-auto shrink-0 text-xs text-kumo-subtle">{time}</span>
          </button>
        </LayerCard.Secondary>
        <AnimatedLayerCardPrimary open={isExpanded} id={contentId} className="rounded-lg px-4 py-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => onCopy(copyContent)}
              className="pointer-events-none absolute right-0 top-0 p-1 text-kumo-subtle opacity-0 transition-colors hover:bg-kumo-tint hover:text-kumo-default group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
              title={copied ? "Copied" : "Copy markdown"}
              aria-label={copied ? "Copied" : "Copy markdown"}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
            {body ? (
              <SafeMarkdown content={body} className="pr-7 text-sm" />
            ) : (
              <p className="pr-7 text-sm text-kumo-subtle">{title}</p>
            )}
          </div>
        </AnimatedLayerCardPrimary>
      </LayerCard>
    </div>
  )
}

export function FinalAssistantMessageItem({
  content,
  time,
  copied,
  onCopy,
}: {
  content: string
  time: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="group mr-8 rounded-2xl bg-kumo-base p-4 ring-1 ring-kumo-hairline">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-0.5">
          <S0LogoSvg className="h-4 w-4 shrink-0 text-kumo-brand" aria-hidden />
          <span className={`${manrope.className} text-xs font-bold text-kumo-subtle`}>Agent</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCopy}
            className="p-1 text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto transition-colors"
            title={copied ? "Copied" : "Copy markdown"}
            aria-label={copied ? "Copied" : "Copy markdown"}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
          <span className="text-xs text-kumo-subtle">{time}</span>
        </div>
      </div>
      <SafeMarkdown content={content} className="text-sm" />
    </div>
  )
}

export { getErrorMessage }
