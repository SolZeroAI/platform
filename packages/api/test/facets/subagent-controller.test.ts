import type { AgentToolFailure, RunAgentToolResult } from "agents"
import { describe, expect, it, vi } from "vitest"
import {
  createInitialIsolateSessionAgentState,
  IsolateSubagentController,
  type IsolateSubagentHost,
} from "../../src/server/background/isolate/agent/subagent-controller"
import type { IsolateSubagentDelegation } from "../../src/server/background/isolate/subagent"

interface HostHarness {
  readonly host: IsolateSubagentHost
  readonly cancelAgentTool: ReturnType<typeof vi.fn>
  readonly registerSubagentTrustedConfig: ReturnType<typeof vi.fn>
  readonly releaseSubagentTrustedConfig: ReturnType<typeof vi.fn>
  readonly runAgentTool: ReturnType<typeof vi.fn>
  readonly logError: ReturnType<typeof vi.fn>
}

function createHostHarness(input?: {
  readonly durableRunIds?: string[]
  readonly releaseRejects?: boolean
  readonly runRejects?: boolean
  readonly runResult?: RunAgentToolResult<string>
}): HostHarness {
  let state = {
    ...createInitialIsolateSessionAgentState(),
    sessionId: "session-1",
    userId: "user-1",
    repoOwner: "Consensys",
    repoName: "ai",
    model: "test/model",
    subagentDispatch:
      input?.durableRunIds === undefined
        ? undefined
        : {
            messageId: "message-1",
            count: input.durableRunIds.length,
            runIds: input.durableRunIds,
          },
  }
  const cancelAgentTool = vi.fn(() => Promise.resolve())
  const registerSubagentTrustedConfig = vi.fn(() => Promise.resolve())
  const releaseSubagentTrustedConfig = vi.fn(() =>
    input?.releaseRejects
      ? Promise.reject(new Error("trusted config cleanup failed"))
      : Promise.resolve(),
  )
  const runAgentTool = vi.fn(() =>
    input?.runRejects
      ? Promise.reject(new Error("facet startup RPC failed"))
      : Promise.resolve(
          input?.runResult ??
            ({
              runId: "message-1:delegate-1",
              agentType: "IsolateSubAgent",
              status: "completed",
              output: "child complete",
            } satisfies RunAgentToolResult<string>),
        ),
  )
  const logError = vi.fn()
  const host = {
    maxSteps: 20,
    activeTurn: {
      model: {
        providerId: "test",
        modelId: "model",
        runtimeModelId: "test/model",
        model: {},
      },
      requestedModel: "test/model",
      messageId: "message-1",
    },
    get state() {
      return state
    },
    setState(next: typeof state) {
      state = next
    },
    getEnv: () => ({}),
    getRuntimeId: () => "session-1",
    createInternalRequestObserver: () => ({
      log: {
        set: vi.fn(),
        emit: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: logError,
      },
    }),
    runAgentTool,
    cancelAgentTool,
    clearAgentToolRuns: () => Promise.resolve(),
    listSubAgents: () => [],
    deleteSubAgent: () => Promise.resolve(),
    registerSubagentTrustedConfig,
    releaseSubagentTrustedConfig,
    clearSubagentTrustedConfigs: () => Promise.resolve(),
  } as unknown as IsolateSubagentHost

  return {
    host,
    cancelAgentTool,
    registerSubagentTrustedConfig,
    releaseSubagentTrustedConfig,
    runAgentTool,
    logError,
  }
}

function runClaimedDelegation(
  controller: IsolateSubagentController,
  delegation: IsolateSubagentDelegation,
  runId: string,
): Promise<string | AgentToolFailure> {
  return (
    controller as unknown as {
      runClaimedDelegation(
        delegation: IsolateSubagentDelegation,
        toolCallId: string,
        runId: string,
        displayOrder: number,
      ): Promise<string | AgentToolFailure>
    }
  ).runClaimedDelegation(delegation, "delegate-1", runId, 1)
}

describe("Isolate sub-agent controller lifecycle hardening", () => {
  it("cancels durable dispatch runs after the parent controller is recreated", async () => {
    const harness = createHostHarness({
      durableRunIds: ["message-1:delegate-1", "message-1:delegate-2"],
    })
    const controller = new IsolateSubagentController(harness.host)

    await controller.cancelActive("parent stopped")

    expect(harness.cancelAgentTool.mock.calls).toEqual([
      ["message-1:delegate-1", "parent stopped"],
      ["message-1:delegate-2", "parent stopped"],
    ])
  })

  it("returns a non-retryable failure and releases trusted config when startup rejects", async () => {
    const harness = createHostHarness({ runRejects: true, releaseRejects: true })
    const controller = new IsolateSubagentController(harness.host)
    const runId = "message-1:delegate-1"

    const result = await runClaimedDelegation(
      controller,
      { task: "Inspect the failing worker" },
      runId,
    )

    expect(result).toEqual({
      ok: false,
      status: "error",
      error: "The sub-agent runtime could not start this delegated run.",
      retryable: false,
    })
    expect(harness.registerSubagentTrustedConfig).toHaveBeenCalledOnce()
    expect(harness.runAgentTool).toHaveBeenCalledOnce()
    expect(harness.releaseSubagentTrustedConfig).toHaveBeenCalledWith(runId)
    expect(harness.logError.mock.calls).toEqual([
      [
        expect.anything(),
        expect.objectContaining({
          event: "Isolate sub-agent runtime rejected the delegated run",
          runId,
        }),
      ],
      [
        expect.anything(),
        expect.objectContaining({
          event: "Failed to release trusted Isolate sub-agent configuration",
          runId,
        }),
      ],
    ])

    await controller.cancelActive("verify in-memory cleanup")
    expect(harness.cancelAgentTool).not.toHaveBeenCalled()
  })

  it("returns an incomplete failure when a completed child has no text summary", async () => {
    const harness = createHostHarness({
      runResult: {
        runId: "message-1:delegate-1",
        agentType: "IsolateSubAgent",
        status: "completed",
        output: "",
        summary: "",
      },
    })
    const controller = new IsolateSubagentController(harness.host)

    await expect(
      runClaimedDelegation(
        controller,
        { task: "Inspect the alert evidence" },
        "message-1:delegate-1",
      ),
    ).resolves.toEqual({
      ok: false,
      status: "error",
      error: "Sub-agent completed without a text summary.",
      retryable: false,
    })
  })
})
