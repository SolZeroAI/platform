import { describe, expect, it } from "vitest"
import {
  delegateToSubagentInputSchema,
  parseAgentToolEventMessage,
  parseSubagentChunkActivity,
  sanitizeParentToolCallArgs,
  sanitizeSubagentTaskPreview,
  toAgentToolFailure,
} from "../../packages/api/src/server/background/isolate/agent/delegation"
import { toRepoWorkspacePath } from "../../packages/api/src/server/background/isolate/repo-paths"
import {
  EMPTY_SUBAGENT_SUMMARY_ERROR,
  SUBAGENT_COMPACT_ERROR_LIMIT,
  SUBAGENT_COMPACT_LABEL_LIMIT,
  SUBAGENT_COMPACT_PROGRESS_LIMIT,
  SUBAGENT_COMPACT_SUMMARY_LIMIT,
  summarizeSubagentRuns,
  type SandboxEvent,
} from "../../packages/shared/src"

type AgentToolEventMessage = NonNullable<ReturnType<typeof parseAgentToolEventMessage>>
type AgentToolEvent = AgentToolEventMessage["event"]
type RunAgentToolResult = Parameters<typeof toAgentToolFailure>[0]

function agentToolEvent(
  event: AgentToolEvent,
  overrides: Partial<Omit<AgentToolEventMessage, "event" | "type">> = {},
): string {
  return JSON.stringify({
    type: "agent-tool-event",
    parentToolCallId: "delegate-call-1",
    sequence: 4,
    event,
    ...overrides,
  })
}

describe("Isolate sub-agent delegation input", () => {
  it("keeps model-controlled delegation fields outside the trusted run configuration", async () => {
    const validate = delegateToSubagentInputSchema.validate
    expect(validate).toBeTypeOf("function")

    const result = await validate?.({
      task: "Inspect the session event reducer",
      context: "Focus on replay behavior",
      expectedOutput: "Return findings with file references",
      parentSessionId: "attacker-selected-session",
      model: "attacker-selected-model",
      selectedTools: [{ kind: "github_repo" }],
    })

    expect(result).toEqual({
      success: true,
      value: {
        task: "Inspect the session event reducer",
        context: "Focus on replay behavior",
        expectedOutput: "Return findings with file references",
      },
    })
    expect(await delegateToSubagentInputSchema.jsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["task"],
      properties: {
        task: { maxLength: 16_000 },
        context: { maxLength: 32_000 },
        expectedOutput: { maxLength: 8_000 },
      },
    })
  })

  it.each([
    ["missing task", {}, "task is required"],
    ["blank task", { task: "   " }, "task is required"],
    ["oversized task", { task: "t".repeat(16_001) }, "task must not exceed 16000 characters"],
    ["non-string context", { task: "task", context: 42 }, "context must be a string"],
    [
      "oversized expected output",
      { task: "task", expectedOutput: "o".repeat(8_001) },
      "expectedOutput must not exceed 8000 characters",
    ],
  ])("rejects %s", async (_name, input, expectedError) => {
    const result = await delegateToSubagentInputSchema.validate?.(input)

    expect(result?.success).toBe(false)
    if (result && !result.success) {
      expect(result.error.message).toBe(expectedError)
    }
  })
})

describe("Isolate sub-agent shared workspace paths", () => {
  it.each([
    ["README.md", "/repo/README.md"],
    ["/README.md", "/repo/README.md"],
    ["/repo/src/index.ts", "/repo/src/index.ts"],
    ["src/../README.md", "/repo/README.md"],
    ["**/*.ts", "/repo/**/*.ts"],
  ])("maps %s into the parent repository", (path, expected) => {
    expect(toRepoWorkspacePath(path)).toBe(expected)
  })

  it("allows the repository root only for directory-style operations", () => {
    expect(toRepoWorkspacePath("/", { allowRoot: true })).toBe("/repo")
    expect(toRepoWorkspacePath("/repo", { allowRoot: true })).toBe("/repo")
    expect(() => toRepoWorkspacePath("/repo")).toThrow("must identify an entry")
  })

  it.each(["..", "../outside", "/repo/../../outside"])(
    "rejects workspace traversal through %s",
    (path) => {
      expect(() => toRepoWorkspacePath(path)).toThrow("must stay within")
    },
  )
})

describe("Isolate sub-agent task previews", () => {
  it("collapses control whitespace and redacts common credential forms", () => {
    const preview = sanitizeSubagentTaskPreview(
      [
        "Investigate\n\tthe failure",
        "Authorization: top-secret-value",
        "Bearer abc.def_ghi-123",
        "api_key=secret-api-key",
        "ghp_1234567890abcdefghijklmnop",
        "xoxb-123456789012-secret",
        "then report back",
      ].join("  "),
    )

    expect(preview).toBe(
      "Investigate the failure Authorization=[REDACTED] Bearer [REDACTED] api_key=[REDACTED] [REDACTED] [REDACTED] then report back",
    )
    expect(preview).not.toContain("top-secret-value")
    expect(preview).not.toContain("secret-api-key")
  })

  it("truncates persisted previews to 280 characters without truncating the raw task", () => {
    const rawTask = `Review ${"a".repeat(400)}`
    const preview = sanitizeSubagentTaskPreview(rawTask)

    expect(preview).toHaveLength(280)
    expect(preview.endsWith("…")).toBe(true)
    expect(rawTask).toHaveLength(407)
  })

  it("persists only the task preview for delegation while leaving ordinary tool args unchanged", () => {
    const ordinaryArgs = {
      query: "Authorization: ordinary-tool-value",
      context: "ordinary tools retain their established persistence contract",
    }
    expect(sanitizeParentToolCallArgs("search_files", ordinaryArgs)).toBe(ordinaryArgs)

    const delegated = sanitizeParentToolCallArgs("delegate_to_subagent", {
      task: `Inspect failure with OPENAI_API_KEY=task-secret ${"x".repeat(400)}`,
      context: "password=context-secret",
      expectedOutput: "Bearer expected-output-secret",
      injected: "token=injected-secret",
    })
    expect(delegated).toEqual({
      task: expect.stringContaining("OPENAI_API_KEY=[REDACTED]"),
    })
    expect((delegated as { task: string }).task).toHaveLength(280)
    expect(JSON.stringify(delegated)).not.toMatch(
      /task-secret|context-secret|expected-output-secret|injected-secret|expectedOutput|context/,
    )
  })
})

describe("Isolate sub-agent compact summaries", () => {
  it("redacts and truncates every model-authored compact field without mutating full replay", () => {
    const rawSecret = "compact-secret-value"
    const events: SandboxEvent[] = [
      {
        type: "subagent_event",
        eventId: "sae_run-compact_0",
        runId: "run-compact",
        sequence: 0,
        messageId: "message-1",
        sandboxId: "session-1",
        timestamp: 1,
        kind: "started",
        agentType: "IsolateSubAgent",
        order: 0,
        task: `Review token=${rawSecret} ${"t".repeat(400)}`,
      },
      {
        type: "subagent_event",
        eventId: "sae_run-compact_1",
        runId: "run-compact",
        sequence: 1,
        messageId: "message-1",
        sandboxId: "session-1",
        timestamp: 2,
        kind: "chunk",
        body: JSON.stringify({
          type: "data-agent-progress",
          data: {
            message: `Checking password=${rawSecret} ${"p".repeat(400)}`,
            phase: `authorization=${rawSecret} ${"h".repeat(200)}`,
            milestone: `api_key=${rawSecret} ${"m".repeat(200)}`,
            name: `secret=${rawSecret} ${"n".repeat(200)}`,
          },
        }),
      },
      {
        type: "subagent_event",
        eventId: "sae_run-compact_2",
        runId: "run-compact",
        sequence: 2,
        messageId: "message-1",
        sandboxId: "session-1",
        timestamp: 3,
        kind: "finished",
        summary: `Found Bearer ${rawSecret} ${"s".repeat(1_500)}`,
      },
    ]

    const [summary] = summarizeSubagentRuns(events)
    expect(summary?.task).toHaveLength(280)
    expect(summary?.summary).toHaveLength(SUBAGENT_COMPACT_SUMMARY_LIMIT)
    expect(summary?.progress?.message).toHaveLength(SUBAGENT_COMPACT_PROGRESS_LIMIT)
    expect(summary?.progress?.phase).toHaveLength(SUBAGENT_COMPACT_LABEL_LIMIT)
    expect(summary?.progress?.milestone).toHaveLength(SUBAGENT_COMPACT_LABEL_LIMIT)
    expect(summary?.milestones?.[0]?.name).toHaveLength(SUBAGENT_COMPACT_LABEL_LIMIT)
    expect(JSON.stringify(summary)).not.toContain(rawSecret)
    expect(JSON.stringify(events)).toContain(rawSecret)

    const errorEvents = [
      ...events.slice(0, 2),
      {
        ...events[2],
        eventId: "sae_run-compact_2-error",
        kind: "error" as const,
        error: `authorization=${rawSecret} ${"e".repeat(800)}`,
      },
    ] as SandboxEvent[]
    const [failed] = summarizeSubagentRuns(errorEvents)
    expect(failed?.error).toHaveLength(SUBAGENT_COMPACT_ERROR_LIMIT)
    expect(failed?.error).not.toContain(rawSecret)
  })

  it("marks a finished run without a text summary as incomplete", () => {
    const events: SandboxEvent[] = [
      {
        type: "subagent_event",
        eventId: "sae_run-empty_0",
        runId: "run-empty",
        sequence: 0,
        messageId: "message-1",
        sandboxId: "session-1",
        timestamp: 1,
        kind: "started",
        agentType: "IsolateSubAgent",
        order: 0,
      },
      {
        type: "subagent_event",
        eventId: "sae_run-empty_1",
        runId: "run-empty",
        sequence: 1,
        messageId: "message-1",
        sandboxId: "session-1",
        timestamp: 2,
        kind: "finished",
        summary: "   ",
      },
    ]

    expect(summarizeSubagentRuns(events)).toEqual([
      expect.objectContaining({
        runId: "run-empty",
        status: "error",
        error: EMPTY_SUBAGENT_SUMMARY_ERROR,
      }),
    ])
  })
})

describe("Cloudflare agent-tool event relay validation", () => {
  it.each<AgentToolEvent>([
    {
      kind: "started",
      runId: "run-1",
      agentType: "IsolateSubAgent",
      inputPreview: { task: "Inspect events" },
      order: 1,
      display: { name: "Sub-agent" },
    },
    {
      kind: "chunk",
      runId: "run-1",
      body: JSON.stringify({ type: "text-delta", id: "text-1", delta: "Evidence" }),
    },
    { kind: "finished", runId: "run-1", summary: "Complete" },
    { kind: "error", runId: "run-1", error: "Child failed" },
    { kind: "aborted", runId: "run-1", reason: "Parent stopped" },
    {
      kind: "interrupted",
      runId: "run-1",
      error: "Tail recovery budget was exhausted",
      reason: "budget-exceeded",
      childStillRunning: false,
    },
  ])("accepts and preserves an official $kind event", (event) => {
    const parsed = parseAgentToolEventMessage(agentToolEvent(event, { sequence: 17, replay: true }))

    expect(parsed).toEqual({
      type: "agent-tool-event",
      parentToolCallId: "delegate-call-1",
      sequence: 17,
      replay: true,
      event,
    })
    expect(`${parsed?.event.runId}:${parsed?.sequence}`).toBe("run-1:17")
  })

  it.each([
    ["binary frames", new Uint8Array([1, 2, 3])],
    ["invalid JSON", "not-json"],
    ["wrong outer type", JSON.stringify({ type: "message", sequence: 0, event: {} })],
    [
      "negative sequence",
      agentToolEvent({ kind: "finished", runId: "run-1", summary: "done" }, { sequence: -1 }),
    ],
    [
      "fractional sequence",
      agentToolEvent({ kind: "finished", runId: "run-1", summary: "done" }, { sequence: 1.5 }),
    ],
    [
      "false replay marker",
      JSON.stringify({
        type: "agent-tool-event",
        sequence: 0,
        replay: false,
        event: { kind: "finished", runId: "run-1", summary: "done" },
      }),
    ],
    ["malformed chunk JSON", agentToolEvent({ kind: "chunk", runId: "run-1", body: "not-json" })],
    [
      "chunk JSON without a type",
      agentToolEvent({ kind: "chunk", runId: "run-1", body: JSON.stringify({ delta: "hi" }) }),
    ],
    [
      "unknown UI message chunk",
      agentToolEvent({
        kind: "chunk",
        runId: "run-1",
        body: JSON.stringify({ type: "invented-chunk", delta: "hi" }),
      }),
    ],
    [
      "unknown interruption reason",
      JSON.stringify({
        type: "agent-tool-event",
        sequence: 0,
        event: {
          kind: "interrupted",
          runId: "run-1",
          error: "Interrupted",
          reason: "invented-reason",
        },
      }),
    ],
  ])("rejects %s", (_name, frame) => {
    expect(parseAgentToolEventMessage(frame as string | ArrayBufferView)).toBeNull()
  })
})

describe("Isolate sub-agent compact activity", () => {
  it("extracts namespaced tool-call inputs without persisting their arguments", () => {
    const activity = parseSubagentChunkActivity(
      JSON.stringify({
        type: "tool-input-available",
        toolCallId: "tool-7",
        toolName: "search_files",
        input: { query: "credential-bearing raw input" },
      }),
    )

    expect(activity).toEqual({ toolName: "search_files", toolCallId: "tool-7" })
    expect(activity).not.toHaveProperty("input")
  })

  it("extracts only the compact official progress fields", () => {
    const activity = parseSubagentChunkActivity(
      JSON.stringify({
        type: "data-agent-progress",
        data: {
          at: 1_785_000_000_000,
          fraction: 0.5,
          message: "Checking evidence",
          phase: "verification",
          milestone: "sources-checked",
          data: { authorization: "must-not-leak" },
        },
      }),
    )

    expect(activity).toEqual({
      progress: {
        at: 1_785_000_000_000,
        fraction: 0.5,
        message: "Checking evidence",
        phase: "verification",
        milestone: "sources-checked",
      },
    })
    expect(JSON.stringify(activity)).not.toContain("must-not-leak")
  })

  it.each(["not-json", "null", "[]", JSON.stringify({ delta: "missing type" })])(
    "ignores an invalid activity body: %s",
    (body) => {
      expect(parseSubagentChunkActivity(body)).toBeNull()
    },
  )
})

describe("Isolate sub-agent failure mapping", () => {
  it.each([
    [
      "error",
      { runId: "run-error", agentType: "IsolateSubAgent", status: "error", error: "boom" },
      { ok: false, status: "error", error: "boom", retryable: false },
    ],
    [
      "aborted",
      { runId: "run-abort", agentType: "IsolateSubAgent", status: "aborted" },
      {
        ok: false,
        status: "aborted",
        error: "Sub-agent run ended with status 'aborted'",
        retryable: false,
      },
    ],
    [
      "interrupted",
      {
        runId: "run-interrupted",
        agentType: "IsolateSubAgent",
        status: "interrupted",
        error: "Parent recovery deadline elapsed",
        reason: "recovery-deadline",
        childStillRunning: true,
      },
      {
        ok: false,
        status: "interrupted",
        error: "Parent recovery deadline elapsed",
        retryable: true,
        reason: "recovery-deadline",
        childStillRunning: true,
      },
    ],
  ] satisfies ReadonlyArray<[string, RunAgentToolResult, ReturnType<typeof toAgentToolFailure>]>)(
    "maps an awaited %s result to a structured tool failure",
    (_name, result, expected) => {
      expect(toAgentToolFailure(result)).toEqual(expected)
    },
  )

  it("refuses to map completed results as failures", () => {
    expect(() =>
      toAgentToolFailure({
        runId: "run-complete",
        agentType: "IsolateSubAgent",
        status: "completed",
        summary: "done",
      }),
    ).toThrow("Completed sub-agent results cannot be converted to failures")
  })
})
