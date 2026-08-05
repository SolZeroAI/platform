import { describe, expect, it } from "vitest"
import type { SandboxEvent, SubagentSessionEvent } from "@solzero/shared"
import { groupEvents } from "@/components/session-page/events"
import { reduceSubagentEvents } from "./subagent-events"

type StripSubagentEventBase<T> = T extends SubagentSessionEvent
  ? Omit<T, "eventId" | "messageId" | "runId" | "sandboxId" | "sequence" | "timestamp" | "type">
  : never
type SubagentEventPayload = StripSubagentEventBase<SubagentSessionEvent>

function subagentEvent(
  sequence: number,
  payload: SubagentEventPayload,
  overrides: Partial<SubagentSessionEvent> = {},
): SubagentSessionEvent {
  const runId = overrides.runId ?? "run-1"
  return {
    type: "subagent_event",
    eventId: `sae_${runId}_${sequence}`,
    runId,
    sequence,
    parentToolCallId: "parent-tool-1",
    messageId: "prompt-1",
    sandboxId: "isolate-1",
    timestamp: 100 + sequence,
    ...payload,
    ...overrides,
  } as SubagentSessionEvent
}

describe("reduceSubagentEvents", () => {
  it("reconstructs child output and namespaces tool calls per run", () => {
    const events: SandboxEvent[] = [
      subagentEvent(0, {
        kind: "started",
        agentType: "IsolateSubAgent",
        order: 0,
        task: "Inspect the API boundary",
        model: "openai/gpt-5",
      }),
      subagentEvent(1, {
        kind: "chunk",
        body: JSON.stringify({ type: "text-delta", id: "text-1", delta: "Found " }),
      }),
      subagentEvent(2, {
        kind: "chunk",
        body: JSON.stringify({ type: "text-delta", id: "text-1", delta: "the boundary." }),
      }),
      subagentEvent(3, {
        kind: "chunk",
        body: JSON.stringify({
          type: "reasoning-delta",
          id: "reasoning-1",
          delta: "Checking callers.",
        }),
      }),
      subagentEvent(4, {
        kind: "chunk",
        body: JSON.stringify({
          type: "tool-input-available",
          toolCallId: "call-1",
          toolName: "Read",
          input: { filePath: "src/api.ts" },
        }),
      }),
      subagentEvent(5, {
        kind: "chunk",
        body: JSON.stringify({
          type: "tool-output-available",
          toolCallId: "call-1",
          output: { lines: 42 },
        }),
      }),
      subagentEvent(6, { kind: "finished", summary: "The boundary is typed." }),
    ]

    const state = reduceSubagentEvents(events)
    const run = state.runs[0]

    expect(run).toMatchObject({
      runId: "run-1",
      status: "completed",
      task: "Inspect the API boundary",
      model: "openai/gpt-5",
      text: "Found the boundary.",
      reasoning: "Checking callers.",
      summary: "The boundary is typed.",
      toolCallCount: 1,
      toolNames: ["Read"],
      durationMs: 6000,
    })
    expect(run?.toolEvents).toMatchObject([
      {
        type: "tool_call",
        callId: "run-1:call-1",
        tool: "Read",
        args: { filePath: "src/api.ts" },
        output: '{\n  "lines": 42\n}',
        success: true,
      },
    ])
  })

  it("deduplicates replayed sequences and safely ignores unknown chunks", () => {
    const events: SandboxEvent[] = [
      subagentEvent(0, { kind: "started", agentType: "IsolateSubAgent", order: 0 }),
      subagentEvent(1, {
        kind: "chunk",
        body: JSON.stringify({ type: "text-delta", delta: "Once" }),
      }),
      subagentEvent(
        1,
        { kind: "chunk", body: JSON.stringify({ type: "text-delta", delta: " twice" }) },
        { replay: true },
      ),
      subagentEvent(2, {
        kind: "chunk",
        body: JSON.stringify({ type: "future-sdk-chunk", value: "ignored" }),
      }),
      subagentEvent(3, { kind: "chunk", body: "not-json" }),
      subagentEvent(4, { kind: "finished", summary: "Done" }),
    ]

    expect(reduceSubagentEvents(events).runs[0]).toMatchObject({
      text: "Once",
      status: "completed",
      summary: "Done",
    })
  })

  it("projects progress, durable milestones, and interruption metadata", () => {
    const events: SandboxEvent[] = [
      subagentEvent(0, { kind: "started", agentType: "IsolateSubAgent", order: 0 }),
      subagentEvent(1, {
        kind: "chunk",
        body: JSON.stringify({
          type: "data-agent-progress",
          data: { fraction: 0.4, phase: "research", message: "Reading sources" },
        }),
      }),
      subagentEvent(2, {
        kind: "chunk",
        body: JSON.stringify({
          type: "data-agent-milestone",
          data: { name: "sources-ready", sequence: 1, at: 104_000, fraction: 0.5 },
        }),
      }),
      subagentEvent(3, {
        kind: "interrupted",
        error: "No progress",
        reason: "no-progress",
        childStillRunning: false,
      }),
    ]

    expect(reduceSubagentEvents(events).runs[0]).toMatchObject({
      status: "interrupted",
      error: "No progress",
      reason: "no-progress",
      childStillRunning: false,
      progress: { fraction: 0.5, milestone: "sources-ready", at: 104_000 },
      milestones: [{ name: "sources-ready", sequence: 1, at: 104_000 }],
    })
  })

  it("reconstructs a run whose start fell outside the reconnect replay window", () => {
    const events: SandboxEvent[] = Array.from({ length: 499 }, (_, index) =>
      subagentEvent(index + 1, {
        kind: "chunk",
        body: JSON.stringify({
          type: "text-delta",
          id: "text-1",
          delta: index === 0 ? "Visible replay tail" : "",
        }),
      }),
    )
    events.push(subagentEvent(500, { kind: "finished", summary: "Recovered from replay" }))

    const run = reduceSubagentEvents(events).runs[0]

    expect(run).toMatchObject({
      runId: "run-1",
      parentToolCallId: "parent-tool-1",
      agentType: "IsolateSubAgent",
      status: "completed",
      text: "Visible replay tail",
      summary: "Recovered from replay",
      startedAt: 101,
      completedAt: 600,
    })
  })
})

describe("groupEvents sub-agent disclosure", () => {
  it("replaces concurrent delegation tool rows and lifecycle events with one group", () => {
    const events: SandboxEvent[] = [
      {
        type: "tool_call",
        tool: "delegate_to_subagent",
        args: { task: "Inspect API" },
        callId: "parent-tool-1",
        messageId: "prompt-1",
        sandboxId: "isolate-1",
        timestamp: 99,
      },
      {
        type: "tool_call",
        tool: "delegate_to_subagent",
        args: { task: "Inspect UI" },
        callId: "parent-tool-2",
        messageId: "prompt-1",
        sandboxId: "isolate-1",
        timestamp: 99,
      },
      subagentEvent(0, {
        kind: "started",
        agentType: "IsolateSubAgent",
        order: 0,
        task: "Inspect API",
      }),
      subagentEvent(
        0,
        { kind: "started", agentType: "IsolateSubAgent", order: 1, task: "Inspect UI" },
        {
          eventId: "sae_run-2_0",
          runId: "run-2",
          parentToolCallId: "parent-tool-2",
        },
      ),
      subagentEvent(1, { kind: "finished", summary: "API done" }),
      subagentEvent(1, { kind: "finished", summary: "UI done" }, { runId: "run-2" }),
    ]

    const groups = groupEvents(events, new Set())

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      type: "subagent_group",
      runs: [
        { runId: "run-1", task: "Inspect API", status: "completed" },
        { runId: "run-2", task: "Inspect UI", status: "completed" },
      ],
    })
  })

  it("renders a run once when parent tools and child lifecycle events interleave", () => {
    const events: SandboxEvent[] = [
      {
        type: "tool_call",
        tool: "delegate_to_subagent",
        args: { task: "Inspect API" },
        callId: "parent-tool-1",
        messageId: "prompt-1",
        sandboxId: "isolate-1",
        timestamp: 99,
      },
      {
        type: "tool_call",
        tool: "Read",
        args: { filePath: "src/orchestrator.ts" },
        callId: "parent-read-1",
        messageId: "prompt-1",
        sandboxId: "isolate-1",
        timestamp: 100,
      },
      subagentEvent(0, {
        kind: "started",
        agentType: "IsolateSubAgent",
        order: 0,
        task: "Inspect API",
      }),
      subagentEvent(1, { kind: "finished", summary: "API done" }),
    ]

    const groups = groupEvents(events, new Set())
    const subagentGroups = groups.filter((group) => group.type === "subagent_group")

    expect(subagentGroups).toHaveLength(1)
    expect(subagentGroups[0]).toMatchObject({
      runs: [{ runId: "run-1", status: "completed" }],
    })
  })
})
