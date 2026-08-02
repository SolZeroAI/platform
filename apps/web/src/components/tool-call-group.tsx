"use client"

import { Badge } from "@cloudflare/kumo/components/badge"
import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { AlertCircle, ChevronRight } from "lucide-react"
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import type { SandboxEvent } from "@c0-agent/shared"
import { isToolCallFailed, type McpDiscoveryErrorEvent } from "@/lib/session-events"
import { AnimatedNumber } from "@/components/animated-number"
import { AnimatedLayerCardPrimary } from "@/components/expandable-layer-card"
import { formatToolGroup } from "@/lib/tool-formatters"
import { formatFullTimestamp, formatShortTimestamp } from "@/lib/time"
import { ToolCallBanner, ToolIcon } from "./tool-call-item"

interface ToolCallGroupProps {
  events: SandboxEvent[]
  groupId: string
  discoveryErrorsByCallId?: ReadonlyMap<string, McpDiscoveryErrorEvent>
  isStreamingFocus?: boolean
  isProcessing?: boolean
}

export function ToolCallGroup({
  events,
  groupId,
  discoveryErrorsByCallId,
  isStreamingFocus = false,
  isProcessing = false,
}: ToolCallGroupProps) {
  const contentId = useId()
  const [isExpanded, setIsExpanded] = useState(false)
  const userToggledRef = useRef(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isProcessing) {
      userToggledRef.current = false
    }
  }, [isProcessing])

  useEffect(() => {
    if (userToggledRef.current) {
      return
    }
    setIsExpanded(isStreamingFocus)
  }, [isStreamingFocus])

  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el || !isExpanded || (!isProcessing && !isStreamingFocus)) {
      return
    }

    el.scrollTop = el.scrollHeight
  }, [events.length, isExpanded, isProcessing, isStreamingFocus])

  const formatted = formatToolGroup(events)
  const firstEvent = events[0]
  const time = formatShortTimestamp(firstEvent.timestamp)
  const fullTimestamp = formatFullTimestamp(firstEvent.timestamp)
  const failedCount = events.filter((event) =>
    isToolCallFailed(event, event.callId ? discoveryErrorsByCallId?.get(event.callId) : undefined),
  ).length
  const successfulCount = Math.max(0, events.length - failedCount)

  return (
    <div className="py-1">
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
              className={`h-4 w-4 shrink-0 text-kumo-warning transition-transform duration-200 ${
                isExpanded ? "rotate-90" : ""
              }`}
              aria-hidden
            />
            <ToolIcon name={formatted.icon} />
            <span className="font-medium text-kumo-default">{formatted.toolName}</span>
            {events.length > 1 && successfulCount > 0 ? (
              <Badge variant="neutral" className="shrink-0 font-mono tabular-nums">
                <AnimatedNumber value={successfulCount} />
                <span className="sr-only">
                  {" "}
                  {successfulCount === 1 ? "successful tool call" : "successful tool calls"}
                </span>
              </Badge>
            ) : events.length === 1 && formatted.summary ? (
              <span className="truncate text-kumo-subtle">{formatted.summary}</span>
            ) : null}
            {failedCount > 0 ? (
              <Badge
                variant="error"
                className="shrink-0 gap-1 bg-kumo-danger-tint/50 font-mono tabular-nums"
              >
                <AlertCircle className="h-3 w-3 text-kumo-danger" aria-hidden />
                <AnimatedNumber value={failedCount} />
                <span className="sr-only">
                  {" "}
                  {failedCount === 1 ? "failed tool call" : "failed tool calls"}
                </span>
              </Badge>
            ) : null}
            <span className="ml-auto shrink-0 text-xs text-kumo-subtle" title={fullTimestamp}>
              {time}
            </span>
          </button>
        </LayerCard.Secondary>
        <AnimatedLayerCardPrimary
          open={isExpanded}
          id={contentId}
          className="gap-0 rounded-lg px-3 py-3"
        >
          <div
            ref={scrollContainerRef}
            className="transparent-scrollbar max-h-[calc(var(--tool-call-banner-height)*2.5+var(--tool-call-banner-gap)*2)] overflow-y-auto [--tool-call-banner-gap:theme(spacing.2)] [--tool-call-banner-height:4rem]"
          >
            <div className="space-y-2">
              {events.map((event, index) => (
                <ToolCallBanner
                  key={`${groupId}-${index}`}
                  event={event}
                  discoveryError={
                    event.callId ? discoveryErrorsByCallId?.get(event.callId) : undefined
                  }
                />
              ))}
            </div>
          </div>
        </AnimatedLayerCardPrimary>
      </LayerCard>
    </div>
  )
}
