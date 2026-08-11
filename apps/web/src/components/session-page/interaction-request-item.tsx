import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import type { OpenCodeInteractionResponse, SandboxEvent } from "@solzero/shared"
import { ChevronRight, MessageSquare, ShieldQuestion, X } from "lucide-react"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { AnimatedLayerCardPrimary } from "@/components/expandable-layer-card"

export function InteractionRequestItem({
  event,
  response,
  time,
  isStreamingFocus,
  isProcessing,
  onInteractionReply,
}: {
  event: Extract<SandboxEvent, { type: "interaction_request" }>
  response: Extract<SandboxEvent, { type: "interaction_response" }> | null
  time: string
  isStreamingFocus: boolean
  isProcessing: boolean
  onInteractionReply: (response: OpenCodeInteractionResponse) => void
}) {
  const contentId = useId()
  const [isExpanded, setIsExpanded] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const userToggledRef = useRef(false)
  const isPending = response == null
  const title = event.title || (event.kind === "permission" ? "Permission requested" : "Question")

  useEffect(() => {
    if (!isProcessing || !isPending) {
      userToggledRef.current = false
      setIsExpanded(false)
    }
  }, [isPending, isProcessing])

  useEffect(() => {
    if (userToggledRef.current) {
      return
    }
    setIsExpanded(isPending && isStreamingFocus)
  }, [isPending, isStreamingFocus])

  const submitResponse = useCallback(
    (nextResponse: OpenCodeInteractionResponse) => {
      setSubmitting(true)
      onInteractionReply(nextResponse)
    },
    [onInteractionReply],
  )

  const responseLabel = formatInteractionResponse(response)
  const Icon = event.kind === "permission" ? ShieldQuestion : MessageSquare

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
              className={`h-4 w-4 shrink-0 text-kumo-warning transition-transform duration-200 ${
                isExpanded ? "rotate-90" : ""
              }`}
              aria-hidden
            />
            <Icon className="h-4 w-4 shrink-0 text-kumo-warning" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium text-kumo-default">{title}</span>
            {responseLabel ? (
              <span className="shrink-0 text-xs text-kumo-subtle">{responseLabel}</span>
            ) : null}
            <span className="ml-auto shrink-0 text-xs text-kumo-subtle">{time}</span>
          </button>
        </LayerCard.Secondary>
        <AnimatedLayerCardPrimary open={isExpanded} id={contentId} className="rounded-lg px-4 py-3">
          {event.kind === "permission" ? (
            <PermissionInteractionBody
              event={event}
              response={response}
              submitting={submitting}
              onReply={submitResponse}
            />
          ) : (
            <QuestionInteractionBody
              event={event}
              response={response}
              submitting={submitting}
              onReply={submitResponse}
            />
          )}
        </AnimatedLayerCardPrimary>
      </LayerCard>
    </div>
  )
}

function PermissionInteractionBody({
  event,
  response,
  submitting,
  onReply,
}: {
  event: Extract<SandboxEvent, { type: "interaction_request"; kind: "permission" }>
  response: Extract<SandboxEvent, { type: "interaction_response" }> | null
  submitting: boolean
  onReply: (response: OpenCodeInteractionResponse) => void
}) {
  const patterns = event.patterns.filter(Boolean)
  const disabled = submitting || response != null
  const reply = (value: "once" | "always" | "reject") =>
    onReply({
      runtime: "opencode",
      kind: "permission",
      interactionId: event.interactionId,
      reply: value,
    })

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-xs font-medium uppercase text-kumo-subtle">Permission</div>
        <div className="mt-1 font-mono text-kumo-default">{event.permission}</div>
      </div>
      {patterns.length > 0 ? (
        <div>
          <div className="text-xs font-medium uppercase text-kumo-subtle">Patterns</div>
          <div className="mt-1 space-y-1">
            {patterns.map((pattern) => (
              <div key={pattern} className="break-all font-mono text-xs text-kumo-default">
                {pattern}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {response ? (
        <p className="text-sm text-kumo-subtle">{formatInteractionResponse(response)}</p>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => reply("reject")}
            disabled={disabled}
            className="inline-flex min-h-9 items-center gap-2 rounded-md border border-kumo-line px-3 py-1.5 text-sm text-kumo-subtle transition hover:bg-kumo-tint hover:text-kumo-default disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X className="h-4 w-4" aria-hidden />
            Reject
          </button>
          <button
            type="button"
            onClick={() => reply("once")}
            disabled={disabled}
            className="inline-flex min-h-9 items-center gap-2 rounded-md border border-kumo-line px-3 py-1.5 text-sm text-kumo-default transition hover:bg-kumo-tint disabled:cursor-not-allowed disabled:opacity-60"
          >
            Allow once
          </button>
          <button
            type="button"
            onClick={() => reply("always")}
            disabled={disabled}
            className="kumo-inverse-cta inline-flex min-h-9 items-center gap-2 bg-kumo-contrast px-3 py-1.5 text-sm font-semibold text-kumo-inverse transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Always allow
          </button>
        </div>
      )}
    </div>
  )
}

function QuestionInteractionBody({
  event,
  response,
  submitting,
  onReply,
}: {
  event: Extract<SandboxEvent, { type: "interaction_request"; kind: "question" }>
  response: Extract<SandboxEvent, { type: "interaction_response" }> | null
  submitting: boolean
  onReply: (response: OpenCodeInteractionResponse) => void
}) {
  const [selectedByIndex, setSelectedByIndex] = useState<Record<number, string[]>>({})
  const [customByIndex, setCustomByIndex] = useState<Record<number, string>>({})
  const answers = useMemo(
    () =>
      event.questions.map((question, index) => {
        const selected = selectedByIndex[index] ?? []
        const custom = (customByIndex[index] ?? "").trim()
        return custom && question.custom ? [...selected, custom] : selected
      }),
    [customByIndex, event.questions, selectedByIndex],
  )
  const canSubmit =
    !submitting &&
    response == null &&
    answers.length === event.questions.length &&
    answers.every((answer) => answer.length > 0)

  const toggleOption = (questionIndex: number, label: string, multiple: boolean | undefined) => {
    setSelectedByIndex((current) => {
      const currentValues = current[questionIndex] ?? []
      const nextValues = multiple
        ? currentValues.includes(label)
          ? currentValues.filter((value) => value !== label)
          : [...currentValues, label]
        : [label]
      return { ...current, [questionIndex]: nextValues }
    })
  }

  if (response) {
    return <p className="text-sm text-kumo-subtle">{formatInteractionResponse(response)}</p>
  }

  return (
    <div className="space-y-4 text-sm">
      {event.questions.map((question, questionIndex) => {
        const selected = selectedByIndex[questionIndex] ?? []
        return (
          <div key={`${event.interactionId}-${questionIndex}`} className="space-y-2">
            <div>
              <div className="font-medium text-kumo-default">{question.header}</div>
              <p className="mt-1 text-kumo-subtle">{question.question}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {question.options.map((option) => {
                const active = selected.includes(option.label)
                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => toggleOption(questionIndex, option.label, question.multiple)}
                    className={`min-h-9 rounded-md border px-3 py-1.5 text-left text-sm transition ${
                      active
                        ? "border-kumo-brand bg-kumo-brand/10 text-kumo-default"
                        : "border-kumo-line text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
                    }`}
                    title={option.description}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            {question.custom ? (
              <input
                value={customByIndex[questionIndex] ?? ""}
                onChange={(changeEvent) =>
                  setCustomByIndex((current) => ({
                    ...current,
                    [questionIndex]: changeEvent.target.value,
                  }))
                }
                className="min-h-9 w-full rounded-md border border-kumo-line bg-kumo-base px-3 py-1.5 text-sm text-kumo-default outline-none transition focus:border-kumo-brand focus:ring-1 focus:ring-kumo-brand"
                placeholder="Custom answer"
              />
            ) : null}
          </div>
        )
      })}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() =>
            onReply({
              runtime: "opencode",
              kind: "question",
              interactionId: event.interactionId,
              rejected: true,
            })
          }
          disabled={submitting}
          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-kumo-line px-3 py-1.5 text-sm text-kumo-subtle transition hover:bg-kumo-tint hover:text-kumo-default disabled:cursor-not-allowed disabled:opacity-60"
        >
          <X className="h-4 w-4" aria-hidden />
          Reject
        </button>
        <button
          type="button"
          onClick={() =>
            onReply({
              runtime: "opencode",
              kind: "question",
              interactionId: event.interactionId,
              answers,
            })
          }
          disabled={!canSubmit}
          className="kumo-inverse-cta inline-flex min-h-9 items-center gap-2 bg-kumo-contrast px-3 py-1.5 text-sm font-semibold text-kumo-inverse transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Submit answer
        </button>
      </div>
    </div>
  )
}

function formatInteractionResponse(
  response: Extract<SandboxEvent, { type: "interaction_response" }> | null,
): string | null {
  if (!response) {
    return null
  }
  if (response.kind === "permission") {
    if (response.reply === "once") {
      return "Allowed once"
    }
    if (response.reply === "always") {
      return "Always allowed"
    }
    return "Rejected"
  }
  return response.rejected ? "Rejected" : "Answered"
}
