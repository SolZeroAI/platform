import type { StreamCallback } from "@cloudflare/think"
import type { AgentToolEventMessage, RunAgentToolResult } from "agents"
import * as Option from "effect/Option"
import { describe, expect, it, vi } from "vitest"
import {
  claimSubagentDispatch,
  clearSubagentDispatch,
  MAX_SUBAGENT_RUNS_PER_TURN,
  resolveSubagentMessageId,
} from "../../packages/api/src/server/background/isolate/agent/subagent-dispatch-state"
import {
  cancelInterruptedSubagentStillRunning,
  OrderedSubagentEventRelay,
  type OrderedSubagentEventRelayTarget,
} from "../../packages/api/src/server/background/isolate/agent/subagent-event-relay"
import {
  hydrateCompletedAgentToolEventMessage,
  inspectedAgentToolCompletedAtMs,
  projectSubagentSessionEvent,
  resolveAgentToolCompletedAtMs,
  startedAgentToolEventMessage,
  terminalAgentToolEventMessage,
} from "../../packages/api/src/server/background/isolate/agent/subagent-event-projection"
import {
  clearSubagentTrustedConfigs,
  readSubagentTrustedConfig,
  registerSubagentTrustedConfig,
  releaseSubagentTrustedConfig,
  trustedConfigFromRunInput,
} from "../../packages/api/src/server/background/isolate/agent/subagent-trusted-config"

type SqliteStatement = ReturnType<DatabaseSync["prepare"]>
type SqliteAllParams = Parameters<SqliteStatement["all"]>
type SqliteRunParams = Parameters<SqliteStatement["run"]>

class SqliteStorage {
  constructor(private readonly db: DatabaseSync) {}

  exec(query: string, ...params: unknown[]): { toArray(): unknown[] } {
    const returnsRows = query.trimStart().toUpperCase().startsWith("SELECT")
    const rows = returnsRows
      ? this.db.prepare(query).all(...(params as SqliteAllParams))
      : this.run(query, params)
    return { toArray: () => rows }
  }

  private run(query: string, params: unknown[]): unknown[] {
    if (params.length === 0) {
      this.db.exec(query)
    } else {
      this.db.prepare(query).run(...(params as SqliteRunParams))
    }
    return []
  }
}

function startedMessage(sequence = 0): AgentToolEventMessage {
  return {
    type: "agent-tool-event",
    parentToolCallId: "parent-tool",
    sequence,
    event: {
      kind: "started",
      runId: "message-1:tool-1",
      agentType: "IsolateSubAgent",
      inputPreview: { task: "Inspect relay", model: "test-model" },
      order: 1,
      display: { name: "Sub-agent" },
    },
  }
}

function relayTarget(
  overrides: Partial<OrderedSubagentEventRelayTarget> = {},
): OrderedSubagentEventRelayTarget {
  return {
    getCallback: () => Option.none(),
    resolveMessageId: () => Option.some("message-1"),
    persist: () => Promise.resolve(),
    onCallbackFailure: () => undefined,
    onRelayFailure: () => undefined,
    ...overrides,
  }
}

describe("durable Isolate sub-agent relay", () => {
  it("uses direct persistence when the prompt callback is absent", async () => {
    const persist = vi.fn(() => Promise.resolve())
    const relay = new OrderedSubagentEventRelay(relayTarget({ persist }))
    const message = startedMessage()

    relay.enqueue(message)
    await relay.flush()

    expect(persist).toHaveBeenCalledWith("message-1", message)
  })

  it("falls back to direct persistence after the prompt callback rejects", async () => {
    const callbackFailure = vi.fn()
    const persist = vi.fn(() => Promise.resolve())
    const callback = {
      onEvent: vi.fn(() => Promise.reject(new Error("callback disconnected"))),
    } as unknown as StreamCallback
    const relay = new OrderedSubagentEventRelay(
      relayTarget({
        getCallback: () => Option.some(callback),
        persist,
        onCallbackFailure: callbackFailure,
      }),
    )

    relay.enqueue(startedMessage())
    await relay.flush()

    expect(callbackFailure).toHaveBeenCalledOnce()
    expect(persist).toHaveBeenCalledOnce()
  })

  it("carries an authoritative lifecycle timestamp through direct persistence", async () => {
    const persist = vi.fn(() => Promise.resolve())
    const relay = new OrderedSubagentEventRelay(relayTarget({ persist }))
    const message = startedMessage()

    await relay.persistLifecycle(message, 1_785_000_000_123)

    expect(persist).toHaveBeenCalledWith("message-1", message, 1_785_000_000_123)
  })

  it("keeps official frames ordered and continues after one fallback fails", async () => {
    const relayed: number[] = []
    const failures: number[] = []
    const persist = vi.fn((_messageId: string, message: AgentToolEventMessage) => {
      relayed.push(message.sequence)
      return message.sequence === 0
        ? Promise.reject(new Error("transient SessionDO failure"))
        : Promise.resolve()
    })
    const relay = new OrderedSubagentEventRelay(
      relayTarget({
        persist,
        onRelayFailure: (_cause, message) => failures.push(message.sequence),
      }),
    )

    relay.enqueue(startedMessage(0))
    relay.enqueue(startedMessage(1))
    await relay.flush()

    expect(relayed).toEqual([0, 1])
    expect(failures).toEqual([0])
  })

  it("does not send an old retained child through a newer prompt callback", async () => {
    const callback = { onEvent: vi.fn(() => Promise.resolve()) } as unknown as StreamCallback
    const persist = vi.fn(() => Promise.resolve())
    const relay = new OrderedSubagentEventRelay(
      relayTarget({
        getCallback: (message) =>
          Option.liftPredicate(callback, () => message.event.runId.startsWith("message-2:")),
        resolveMessageId: (message) =>
          resolveSubagentMessageId(message.event.runId, undefined, "message-2"),
        persist,
      }),
    )

    relay.enqueue(startedMessage())
    await relay.flush()

    expect(callback.onEvent).not.toHaveBeenCalled()
    expect(persist).toHaveBeenCalledWith("message-1", expect.any(Object))
  })

  it("projects deterministic SessionDO identities and terminal reconciliation frames", () => {
    const started = projectSubagentSessionEvent({
      message: startedMessage(),
      messageId: "message-1",
      sandboxId: "session-1",
      timestamp: 123,
    })
    const terminal = terminalAgentToolEventMessage(
      {
        runId: "message-1:tool-1",
        parentToolCallId: "parent-tool",
        agentType: "IsolateSubAgent",
        status: "completed",
        displayOrder: 1,
        startedAt: 1,
      },
      { status: "completed", summary: "Relay verified" },
      4,
    )
    const projectedTerminal = projectSubagentSessionEvent({
      message: terminal,
      messageId: "message-1",
      sandboxId: "session-1",
      timestamp: 124,
    })

    expect(started).toMatchObject({
      eventId: "sae_message-1:tool-1_0",
      kind: "started",
      task: "Inspect relay",
      model: "test-model",
    })
    expect(projectedTerminal).toMatchObject({
      eventId: "sae_message-1:tool-1_4",
      kind: "finished",
      summary: "Relay verified",
    })
  })

  it("uses the inspected child output when the SDK lifecycle summary is empty", () => {
    const terminal = terminalAgentToolEventMessage(
      {
        runId: "message-1:tool-output",
        parentToolCallId: "parent-tool-output",
        agentType: "IsolateSubAgent",
        status: "completed",
        displayOrder: 1,
        startedAt: 1,
      },
      { status: "completed" },
      5,
    )

    expect(
      hydrateCompletedAgentToolEventMessage(
        terminal,
        "Found two related alerts with token=secret-value and verified the dashboard.",
      ).event,
    ).toEqual({
      kind: "finished",
      runId: "message-1:tool-output",
      summary: "Found two related alerts with token=[REDACTED] and verified the dashboard.",
    })
  })

  it("keeps delayed recovery projections on SDK lifecycle timestamps", () => {
    const run = {
      runId: "message-1:tool-delayed",
      parentToolCallId: "parent-tool-delayed",
      agentType: "IsolateSubAgent",
      inputPreview: { task: "Recover delayed child", model: "test-model" },
      status: "completed" as const,
      displayOrder: 2,
      startedAt: 1_785_000_000_000,
      completedAt: 1_785_000_012_345,
    }
    const started = startedAgentToolEventMessage(run)
    const completedAt = resolveAgentToolCompletedAtMs(run, 1_785_999_999_999)
    const terminal = terminalAgentToolEventMessage(
      run,
      { status: "completed", summary: "Recovered after eviction" },
      7,
    )
    const startedProjection = projectSubagentSessionEvent({
      message: started,
      messageId: "message-1",
      sandboxId: "session-1",
      timestamp: run.startedAt / 1000,
    })
    const terminalProjection = projectSubagentSessionEvent({
      message: terminal,
      messageId: "message-1",
      sandboxId: "session-1",
      timestamp: completedAt / 1000,
    })
    const duplicateTerminalProjection = projectSubagentSessionEvent({
      message: terminal,
      messageId: "message-1",
      sandboxId: "session-1",
      timestamp: completedAt / 1000,
    })

    expect(startedProjection.timestamp).toBe(1_785_000_000)
    expect(terminalProjection.timestamp).toBe(1_785_000_012.345)
    expect(terminalProjection.timestamp - startedProjection.timestamp).toBeCloseTo(12.345)
    expect(terminalProjection.eventId).toBe(duplicateTerminalProjection.eventId)
    expect(completedAt).not.toBe(1_785_999_999_999)
  })

  it("uses a caller-stable terminal fallback when the SDK omits completedAt", () => {
    const run = {
      runId: "message-1:tool-fallback",
      agentType: "IsolateSubAgent",
      status: "interrupted" as const,
      displayOrder: 3,
      startedAt: 1_785_000_000_000,
    }
    const stableFallback = 1_785_000_020_000

    expect(resolveAgentToolCompletedAtMs(run, stableFallback)).toBe(stableFallback)
    expect(resolveAgentToolCompletedAtMs(run, stableFallback)).toBe(stableFallback)
  })

  it("defers a terminal frame when registry inspection cannot prove completedAt", () => {
    const failedInspection = inspectedAgentToolCompletedAtMs(Option.none())
    const incompleteInspection = inspectedAgentToolCompletedAtMs(
      Option.some({ completedAt: undefined }),
    )
    const completedInspection = inspectedAgentToolCompletedAtMs(
      Option.some({ completedAt: 1_785_000_012_345 }),
    )

    expect(Option.isNone(failedInspection)).toBe(true)
    expect(Option.isNone(incompleteInspection)).toBe(true)
    expect(Option.getOrUndefined(completedInspection)).toBe(1_785_000_012_345)
  })

  it("keeps the eight-run claim durable and idempotent per parent message", () => {
    let dispatch = Option.getOrUndefined(
      claimSubagentDispatch(undefined, "message-1", "run-1"),
    )?.state
    const replay = Option.getOrUndefined(claimSubagentDispatch(dispatch, "message-1", "run-1"))
    for (let index = 2; index <= MAX_SUBAGENT_RUNS_PER_TURN; index += 1) {
      dispatch = Option.getOrUndefined(
        claimSubagentDispatch(dispatch, "message-1", `run-${index}`),
      )?.state
    }

    expect(replay).toMatchObject({ order: 1, changed: false })
    expect(dispatch).toMatchObject({ count: 8 })
    expect(Option.isNone(claimSubagentDispatch(dispatch, "message-1", "run-9"))).toBe(true)
    expect(
      Option.getOrUndefined(claimSubagentDispatch(dispatch, "message-2", "run-next")),
    ).toMatchObject({ order: 1, state: { messageId: "message-2", count: 1 } })
    expect(Option.isNone(clearSubagentDispatch(dispatch, "message-1"))).toBe(true)
  })

  it("cancels an interrupted awaited child that reports it is still running", async () => {
    const cancel = vi.fn(() => Promise.resolve())
    const interrupted: RunAgentToolResult<string> = {
      runId: "message-1:tool-1",
      agentType: "IsolateSubAgent",
      status: "interrupted",
      error: "parent recovery window ended",
      retryable: true,
      reason: "window-exceeded",
      childStillRunning: true,
    }

    const result = await cancelInterruptedSubagentStillRunning(
      interrupted.runId,
      interrupted,
      cancel,
    )

    expect(result).toBe(interrupted)
    expect(cancel).toHaveBeenCalledWith(
      interrupted.runId,
      "Awaited Isolate sub-agent was interrupted while still running",
    )
  })

  it("keeps trusted recovery config in parent SQL without storing delegation text", () => {
    const db = new DatabaseSync(":memory:")
    const sql = new SqliteStorage(db)
    const trusted = trustedConfigFromRunInput({
      delegation: { task: "Never persist this model-controlled task" },
      parentSessionId: "session-1",
      userId: "user-1",
      repoOwner: "owner",
      repoName: "repo",
      model: "test-model",
      stepLimit: 8,
      selectedTools: [],
      customMcpServers: {},
    })

    registerSubagentTrustedConfig(sql, "run-1", trusted)
    registerSubagentTrustedConfig(sql, "run-2", { ...trusted, model: "other-model" })

    expect(readSubagentTrustedConfig(sql, "run-1")).toEqual(trusted)
    expect(JSON.stringify(readSubagentTrustedConfig(sql, "run-1"))).not.toContain(
      "Never persist this model-controlled task",
    )
    releaseSubagentTrustedConfig(sql, "run-1")
    expect(readSubagentTrustedConfig(sql, "run-1")).toBeNull()
    clearSubagentTrustedConfigs(sql)
    expect(readSubagentTrustedConfig(sql, "run-2")).toBeNull()
    db.close()
  })
})
import { DatabaseSync } from "node:sqlite"
