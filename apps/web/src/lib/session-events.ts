import type { SandboxEvent } from "@solzero/shared"
import { toolMatchesMcpDiscoveryServer } from "./tool-formatters"
import type { SubagentRunView } from "./subagent-events"

export type McpDiscoveryErrorEvent = Extract<SandboxEvent, { type: "mcp_discovery_error" }>
type AssistantTimelineEvent = Extract<SandboxEvent, { type: "token" | "reasoning" }>
type FinalAssistantTimelineEvent = Extract<SandboxEvent, { type: "token" }>

export function getAssistantTimelineKey(event: SandboxEvent): string | null {
  if (!isAssistantTimelineEvent(event) || !event.content) {
    return null
  }
  if (event.type === "token") {
    return getAssistantTokenTimelineKey(event)
  }
  return event.assistantMessageId ?? `${event.messageId ?? "message"}:${event.timestamp}`
}

function getFinalAssistantTimelineKey(event: SandboxEvent): string | null {
  if (!isFinalAssistantTimelineEvent(event) || !event.content) {
    return null
  }
  return getAssistantTokenTimelineKey(event)
}

function getAssistantTokenTimelineKey(event: FinalAssistantTimelineEvent): string {
  const baseKey = event.assistantMessageId ?? event.messageId ?? "message"
  return `${baseKey}:${event.timestamp}:${event.content.length}`
}

function getReasoningStreamingEventKey(event: SandboxEvent): string | null {
  if (event.type !== "reasoning") {
    return null
  }
  return event.assistantMessageId ?? null
}

function isStreamingTokenUpdate(previousEvent: SandboxEvent | null, event: SandboxEvent): boolean {
  if (event.type !== "token" || previousEvent?.type !== "token") {
    return false
  }
  if (event.assistantMessageId) {
    return previousEvent.assistantMessageId === event.assistantMessageId
  }
  return (
    !previousEvent.assistantMessageId &&
    Boolean(event.messageId) &&
    previousEvent.messageId === event.messageId
  )
}

function isAssistantTimelineEvent(event: SandboxEvent): event is AssistantTimelineEvent {
  return event.type === "token" || event.type === "reasoning"
}

function isFinalAssistantTimelineEvent(event: SandboxEvent): event is FinalAssistantTimelineEvent {
  return event.type === "token"
}

export function collapseTimelineEvents(events: SandboxEvent[]): SandboxEvent[] {
  const filteredEvents: Array<SandboxEvent | null> = []
  const seenToolCalls = new Map<string, number>()
  const seenCompletions = new Set<string>()
  const seenReasoning = new Map<string, number>()
  const failedCompletionErrors = new Map<string, string | undefined>()
  const mcpDiscoveryErrors = new Map<string, Set<string | undefined>>()

  for (const event of events) {
    if (event.type === "execution_complete" && event.messageId && event.success === false) {
      failedCompletionErrors.set(event.messageId, event.error)
    } else if (event.type === "mcp_discovery_error" && event.messageId) {
      const errors = mcpDiscoveryErrors.get(event.messageId) ?? new Set<string | undefined>()
      errors.add(event.error)
      mcpDiscoveryErrors.set(event.messageId, errors)
    }
  }

  for (const event of events) {
    if (event.type === "tool_call" && event.callId) {
      const existingIdx = seenToolCalls.get(event.callId)
      if (existingIdx !== undefined) {
        const existingEvent = filteredEvents[existingIdx]
        filteredEvents[existingIdx] =
          existingEvent?.type === "tool_call"
            ? {
                ...event,
                output: existingEvent.output,
                result: existingEvent.result,
                error: existingEvent.error,
                success: existingEvent.success,
              }
            : event
      } else {
        seenToolCalls.set(event.callId, filteredEvents.length)
        filteredEvents.push(event)
      }
    } else if (event.type === "tool_result" && event.callId) {
      const existingIdx = seenToolCalls.get(event.callId)
      const existingEvent = existingIdx === undefined ? null : filteredEvents[existingIdx]

      if (existingIdx !== undefined && existingEvent?.type === "tool_call") {
        filteredEvents[existingIdx] = {
          ...existingEvent,
          output: event.result,
          result: event.result,
          error: event.error,
          success: !event.error,
        }

        continue
      }

      filteredEvents.push(event)
    } else if (
      event.type === "error" &&
      event.messageId &&
      (failedCompletionErrors.get(event.messageId) === event.error ||
        mcpDiscoveryErrors.get(event.messageId)?.has(event.error))
    ) {
      continue
    } else if (event.type === "execution_complete" && event.messageId) {
      if (!seenCompletions.has(event.messageId)) {
        seenCompletions.add(event.messageId)
        filteredEvents.push(event)
      }
    } else {
      const reasoningStreamingEventKey = getReasoningStreamingEventKey(event)
      if (reasoningStreamingEventKey) {
        const existingIdx = seenReasoning.get(reasoningStreamingEventKey)
        if (existingIdx !== undefined) {
          filteredEvents[existingIdx] = null
        }
        seenReasoning.set(reasoningStreamingEventKey, filteredEvents.length)
      } else if (isStreamingTokenUpdate(filteredEvents.at(-1) ?? null, event)) {
        filteredEvents[filteredEvents.length - 1] = null
      }
      filteredEvents.push(event)
    }
  }

  return filteredEvents.filter((event): event is SandboxEvent => event !== null)
}

export function getFinalAssistantTimelineKeys(events: SandboxEvent[]): Set<string> {
  const latestAssistantKeyByMessageId = new Map<string, string>()
  const finalAssistantKeys = new Set<string>()

  for (const event of events) {
    const assistantKey = getFinalAssistantTimelineKey(event)
    if (assistantKey && event.messageId) {
      latestAssistantKeyByMessageId.set(event.messageId, assistantKey)
    }

    if (event.type === "execution_complete" && event.messageId) {
      const finalAssistantKey = latestAssistantKeyByMessageId.get(event.messageId)
      if (finalAssistantKey) {
        finalAssistantKeys.add(finalAssistantKey)
      }
    }
  }

  return finalAssistantKeys
}

export function getExecutionDurationMsByMessageId(events: SandboxEvent[]): Map<string, number> {
  const userMessageTimestampByMessageId = new Map<string, number>()
  const resumeMessageIds = new Set<string>()
  const durationByMessageId = new Map<string, number>()
  let latestUserMessageTimestamp: number | null = null

  for (const event of events) {
    if (event.type === "user_message" && event.messageId) {
      latestUserMessageTimestamp = event.timestamp
      userMessageTimestampByMessageId.set(event.messageId, event.timestamp)
      continue
    }

    if (event.type === "resume_started" && event.messageId) {
      resumeMessageIds.add(event.messageId)
      continue
    }

    if (event.type !== "execution_complete" || !event.messageId) {
      continue
    }

    const startTimestamp =
      userMessageTimestampByMessageId.get(event.messageId) ??
      (resumeMessageIds.has(event.messageId) ? latestUserMessageTimestamp : undefined)
    if (startTimestamp == null) {
      continue
    }

    durationByMessageId.set(
      event.messageId,
      Math.max(0, Math.round((event.timestamp - startTimestamp) * 1000)),
    )
  }

  return durationByMessageId
}

export function formatExecutionDuration(durationMs: number): string {
  const elapsedMs = Math.max(0, Math.round(durationMs))
  if (elapsedMs < 1000) {
    return "less than 1s"
  }

  const seconds = Math.round(elapsedMs / 1000)
  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

export function getActiveAssistantTimelineKey(events: SandboxEvent[]): string | null {
  const latestEvent = events.at(-1)
  if (!latestEvent) {
    return null
  }

  return getAssistantTimelineKey(latestEvent)
}

export function getMcpDiscoveryErrorDisplayKey(event: McpDiscoveryErrorEvent): string {
  return `${event.messageId ?? "message"}:${event.serverName ?? "mcp"}:${event.timestamp}`
}

export function buildToolCallDiscoveryErrorMap(events: SandboxEvent[]): {
  discoveryErrorsByCallId: Map<string, McpDiscoveryErrorEvent>
  hiddenDiscoveryErrorKeys: Set<string>
} {
  const discoveryErrors = events.filter(
    (event): event is McpDiscoveryErrorEvent => event.type === "mcp_discovery_error",
  )
  const discoveryErrorsByCallId = new Map<string, McpDiscoveryErrorEvent>()
  const hiddenDiscoveryErrorKeys = new Set<string>()

  for (const event of events) {
    if (event.type !== "tool_call" || !event.callId || !event.tool) {
      continue
    }

    const match = discoveryErrors.find(
      (discoveryError) =>
        discoveryError.messageId === event.messageId &&
        toolMatchesMcpDiscoveryServer(event.tool, discoveryError.serverName ?? ""),
    )
    if (!match) {
      continue
    }

    discoveryErrorsByCallId.set(event.callId, match)
    hiddenDiscoveryErrorKeys.add(getMcpDiscoveryErrorDisplayKey(match))
  }

  return { discoveryErrorsByCallId, hiddenDiscoveryErrorKeys }
}

export function shouldHideMcpDiscoveryError(
  event: SandboxEvent,
  hiddenDiscoveryErrorKeys: ReadonlySet<string>,
): boolean {
  return (
    event.type === "mcp_discovery_error" &&
    hiddenDiscoveryErrorKeys.has(getMcpDiscoveryErrorDisplayKey(event))
  )
}

export function isToolCallFailed(
  event: SandboxEvent,
  discoveryError?: McpDiscoveryErrorEvent,
): boolean {
  return (
    event.type === "tool_call" && Boolean(event.error || event.success === false || discoveryError)
  )
}

export function getMcpDiscoveryErrorTimelineKey(event: SandboxEvent): string | null {
  if (event.type !== "mcp_discovery_error" || !event.messageId) {
    return null
  }

  return `${event.messageId}:${event.timestamp}`
}

export type TimelineRenderableGroup =
  | { type: "tool_group"; id: string }
  | { type: "subagent_group"; id: string; runs: readonly SubagentRunView[] }
  | { type: "single"; id: string; event: SandboxEvent }

export function getStreamingExpandedGroupId(
  groups: ReadonlyArray<TimelineRenderableGroup>,
  isProcessing: boolean,
): string | null {
  if (!isProcessing || groups.length === 0) {
    return null
  }

  const lastGroup = groups[groups.length - 1]!
  if (lastGroup.type === "tool_group") {
    return lastGroup.id
  }

  if (lastGroup.type === "subagent_group") {
    return lastGroup.id
  }

  if (lastGroup.type === "single" && lastGroup.event.type === "mcp_discovery_error") {
    return lastGroup.id
  }

  if (lastGroup.type === "single" && lastGroup.event.type === "reasoning") {
    return lastGroup.id
  }

  if (lastGroup.type === "single" && lastGroup.event.type === "interaction_request") {
    return lastGroup.id
  }

  return null
}

export function getAutoExpandedMcpDiscoveryErrorKey(
  events: SandboxEvent[],
  isProcessing: boolean,
): string | null {
  if (isProcessing) {
    return null
  }

  const latestEvent = events.at(-1)
  if (latestEvent?.type !== "mcp_discovery_error") {
    return null
  }

  const isTerminal = Boolean(
    latestEvent.terminal ??
    (typeof latestEvent.metadata?.terminal === "boolean" && latestEvent.metadata.terminal),
  )
  return isTerminal ? getMcpDiscoveryErrorTimelineKey(latestEvent) : null
}
