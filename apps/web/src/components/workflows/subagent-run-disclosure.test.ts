import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  groupWorkflowSubagentEvents,
  WorkflowSubagentRunDisclosure,
} from "./subagent-run-disclosure"
import type { WorkflowRunEvent } from "./types"

function event(overrides: Partial<WorkflowRunEvent>): WorkflowRunEvent {
  return {
    id: "event-1",
    sequence: 1,
    nodeId: "investigate",
    eventType: "subagent_started",
    level: "info",
    message: "Sub-agent started",
    data: {
      sessionId: "session-1",
      childRunId: "child-1",
      task: "Inspect observability evidence",
      model: "openai/gpt-5",
      status: "running",
    },
    createdAt: 1_000,
    ...overrides,
  }
}

describe("workflow sub-agent disclosure", () => {
  it("folds replayed lifecycle rows by child while preserving ordinary event order", () => {
    const ordinary = event({
      id: "ordinary",
      sequence: 2,
      eventType: "node_started",
      data: {},
    })
    const rows = groupWorkflowSubagentEvents([
      event({ id: "started", sequence: 1 }),
      ordinary,
      event({
        id: "progress",
        sequence: 3,
        eventType: "subagent_progress",
        data: {
          sessionId: "session-1",
          childRunId: "child-1",
          progress: { fraction: 0.5, message: "Halfway" },
        },
      }),
    ])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ type: "subagent", childRunId: "child-1" })
    expect(rows[0]?.type === "subagent" ? rows[0].events : []).toHaveLength(2)
    expect(rows[1]).toEqual({ type: "event", event: ordinary })
  })

  it("renders compact task, status, tool count, and duration without raw tool payloads", () => {
    const events = [
      event({ id: "started", sequence: 1 }),
      event({
        id: "activity",
        sequence: 2,
        eventType: "subagent_activity",
        data: {
          sessionId: "session-1",
          childRunId: "child-1",
          status: "running",
          toolName: "query_observability",
          toolCallId: "call-1",
        },
        createdAt: 1_500,
      }),
      event({
        id: "completed",
        sequence: 3,
        eventType: "subagent_completed",
        data: {
          sessionId: "session-1",
          childRunId: "child-1",
          status: "completed",
          durationMs: 2_000,
          toolCallCount: 1,
          toolNames: ["query_observability"],
          summary: "Evidence collected",
        },
        createdAt: 3_000,
      }),
    ]

    const markup = renderToString(
      createElement(WorkflowSubagentRunDisclosure, {
        childRunId: "child-1",
        events,
      }),
    )

    expect(markup).toContain("Inspect observability evidence")
    expect(markup).toContain("completed")
    expect(markup).toContain("1 tool call")
    expect(markup).toContain("2.0s")
    expect(markup).not.toContain("rawArguments")
  })

  it("retains the latest progress when a later activity event omits progress", () => {
    const events = [
      event({ id: "started", sequence: 1 }),
      event({
        id: "progress",
        sequence: 2,
        eventType: "subagent_progress",
        data: {
          sessionId: "session-1",
          childRunId: "child-1",
          progress: { fraction: 0.6, message: "Evidence reconciled" },
        },
        createdAt: 1_500,
      }),
      event({
        id: "activity",
        sequence: 3,
        eventType: "subagent_activity",
        data: {
          sessionId: "session-1",
          childRunId: "child-1",
          status: "running",
          toolName: "query_observability",
          toolCallId: "call-1",
        },
        createdAt: 2_000,
      }),
    ]

    const markup = renderToString(
      createElement(WorkflowSubagentRunDisclosure, {
        childRunId: "child-1",
        events,
      }),
    )

    expect(markup).toContain("Evidence reconciled")
  })
})
