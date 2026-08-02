import { type SandboxEvent } from "@c0-agent/shared"
import { shouldHideMcpDiscoveryError } from "@/lib/session-events"
import { reduceSubagentEvents, type SubagentRunView } from "@/lib/subagent-events"

export type EventGroup =
  | { type: "tool_group"; events: SandboxEvent[]; id: string }
  | { type: "subagent_group"; runs: SubagentRunView[]; id: string }
  | { type: "single"; event: SandboxEvent; id: string }

export function groupEvents(
  events: SandboxEvent[],
  hiddenDiscoveryErrorKeys: ReadonlySet<string>,
): EventGroup[] {
  const groups: EventGroup[] = []
  let currentToolGroup: SandboxEvent[] = []
  let currentSubagentRunIds = new Set<string>()
  let currentSubagentMessageId: string | null = null
  let currentSubagentEventId: string | null = null
  const includedSubagentRunIds = new Set<string>()
  let groupIndex = 0
  const subagentState = reduceSubagentEvents(events)

  const flushToolGroup = () => {
    if (currentToolGroup.length > 0) {
      groups.push({
        type: "tool_group",
        events: [...currentToolGroup],
        id: `tool-group-${groupIndex++}`,
      })
      currentToolGroup = []
    }
  }

  const flushSubagentGroup = () => {
    if (currentSubagentRunIds.size > 0) {
      const runs = [...currentSubagentRunIds].flatMap((runId) => {
        const run = subagentState.runsById.get(runId)
        return run ? [run] : []
      })
      if (runs.length > 0) {
        groups.push({
          type: "subagent_group",
          runs,
          id: `subagent-group-${currentSubagentEventId ?? groupIndex}-${groupIndex++}`,
        })
      }
      currentSubagentRunIds = new Set()
      currentSubagentMessageId = null
      currentSubagentEventId = null
    }
  }

  const appendSubagentRuns = (
    runs: readonly SubagentRunView[],
    messageId: string,
    eventId: string,
  ) => {
    const newRuns = runs.filter((run) => !includedSubagentRunIds.has(run.runId))
    if (newRuns.length === 0) {
      return
    }
    flushToolGroup()
    if (currentSubagentMessageId !== null && currentSubagentMessageId !== messageId) {
      flushSubagentGroup()
    }
    currentSubagentMessageId = messageId
    currentSubagentEventId ??= eventId
    for (const run of newRuns) {
      currentSubagentRunIds.add(run.runId)
      includedSubagentRunIds.add(run.runId)
    }
  }

  for (const event of events) {
    if (event.type === "subagent_event") {
      const run = subagentState.runsById.get(event.runId)
      if (run) {
        appendSubagentRuns([run], event.messageId, event.eventId)
      }
    } else if (event.type === "tool_call") {
      const subagentRuns = event.callId
        ? subagentState.runsByParentToolCallId.get(event.callId)
        : undefined
      if (event.tool === "delegate_to_subagent" && subagentRuns?.length) {
        appendSubagentRuns(
          subagentRuns,
          event.messageId,
          `delegate-${event.callId ?? event.timestamp}`,
        )
        continue
      }
      flushSubagentGroup()
      currentToolGroup.push(event)
    } else if (shouldHideMcpDiscoveryError(event, hiddenDiscoveryErrorKeys)) {
      continue
    } else {
      flushToolGroup()
      flushSubagentGroup()
      groups.push({
        type: "single",
        event,
        id: `single-${event.type}-${event.messageId || event.timestamp}-${groupIndex++}`,
      })
    }
  }

  flushToolGroup()
  flushSubagentGroup()

  return groups
}

export const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 32
