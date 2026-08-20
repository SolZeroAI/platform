/* oxlint-disable anti-slop/no-module-mocking -- Production modules import at module scope. Replacing these mocks needs DI seams at those factories. */
import * as Option from "effect/Option"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SubagentSessionEvent } from "../../packages/shared/src"

const workflowStoreMocks = vi.hoisted(() => ({
  addRunEvent: vi.fn(),
  getRun: vi.fn(),
}))

vi.mock("../../packages/api/src/server/background/db/workflows", () => ({
  createWorkflowStoreFromD1: () => workflowStoreMocks,
}))

import { mirrorSubagentWorkflowEvent } from "../../packages/api/src/server/background/session/subagent-workflow-mirror"
import type { SessionRepository } from "../../packages/api/src/server/background/session/repository"
import type { Env } from "../../packages/api/src/server/background/types"

function event(
  value: Omit<SubagentSessionEvent, "type" | "eventId" | "messageId" | "sandboxId">,
): SubagentSessionEvent {
  return {
    type: "subagent_event",
    eventId: `sae_${value.runId}_${value.sequence}`,
    messageId: "message-1",
    sandboxId: "session-1",
    ...value,
  } as SubagentSessionEvent
}

function repository(storedEvents: SubagentSessionEvent[] = []): SessionRepository {
  return {
    getMessageById: () =>
      Option.some({
        author_id: "participant-1",
        callback_context: JSON.stringify({
          type: "workflow",
          workflowId: "workflow-1",
          runId: "run-1",
          nodeId: "node-1",
        }),
      }),
    getParticipantById: () => Option.some({ user_id: "user-1" }),
    events: {
      listEventsForMessage: () =>
        storedEvents.map((storedEvent) => ({
          data: JSON.stringify(storedEvent),
        })),
    },
  } as unknown as SessionRepository
}

const env = { DB: {} as D1Database } as Env

describe("sub-agent workflow mirror trust boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowStoreMocks.addRunEvent.mockResolvedValue({})
  })

  it("requires an existing workflow run owned by the session message author", async () => {
    const started = event({
      runId: "child-1",
      sequence: 0,
      timestamp: 1,
      kind: "started",
      agentType: "IsolateSubAgent",
      order: 0,
      task: "Inspect events",
    })

    workflowStoreMocks.getRun.mockResolvedValueOnce(null).mockResolvedValueOnce({
      user_id: "different-user",
    })
    await mirrorSubagentWorkflowEvent({
      env,
      repository: repository(),
      sessionId: "session-1",
      event: started,
    })
    await mirrorSubagentWorkflowEvent({
      env,
      repository: repository(),
      sessionId: "session-1",
      event: started,
    })

    expect(workflowStoreMocks.getRun).toHaveBeenCalledTimes(2)
    expect(workflowStoreMocks.getRun).toHaveBeenCalledWith("workflow-1", "run-1")
    expect(workflowStoreMocks.addRunEvent).not.toHaveBeenCalled()
  })

  it("mirrors only sanitized compact text for an authorized workflow run", async () => {
    const secret = "workflow-mirror-secret"
    const started = event({
      runId: "child-1",
      sequence: 0,
      timestamp: 1,
      kind: "started",
      agentType: "IsolateSubAgent",
      order: 0,
      task: `Inspect token=${secret}`,
    })
    const progress = event({
      runId: "child-1",
      sequence: 1,
      timestamp: 2,
      kind: "chunk",
      body: JSON.stringify({
        type: "data-agent-progress",
        data: {
          message: `Checking password=${secret}`,
          phase: `authorization=${secret}`,
          milestone: `api_key=${secret}`,
        },
      }),
    })
    const finished = event({
      runId: "child-1",
      sequence: 2,
      timestamp: 3,
      kind: "finished",
      summary: `Found Bearer ${secret}`,
    })
    const storedEvents = [started, progress, finished]
    workflowStoreMocks.getRun.mockResolvedValue({ user_id: "user-1" })

    for (const lifecycle of storedEvents) {
      await mirrorSubagentWorkflowEvent({
        env,
        repository: repository(storedEvents),
        sessionId: "session-1",
        event: lifecycle,
      })
    }

    expect(workflowStoreMocks.addRunEvent).toHaveBeenCalledTimes(3)
    const serializedWrites = JSON.stringify(workflowStoreMocks.addRunEvent.mock.calls)
    expect(serializedWrites).not.toContain(secret)
    expect(serializedWrites).toContain("[REDACTED]")
    expect(workflowStoreMocks.addRunEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workflowId: "workflow-1",
        runId: "run-1",
        nodeId: "node-1",
        eventType: "subagent_completed",
        createdAt: 3_000,
        data: expect.objectContaining({
          summary: "Found Bearer [REDACTED]",
          sessionId: "session-1",
        }),
      }),
    )
  })

  it("allows a replay to retry the same deterministic mirror after a transient write failure", async () => {
    const started = event({
      runId: "child-retry",
      sequence: 0,
      timestamp: 1,
      kind: "started",
      agentType: "IsolateSubAgent",
      order: 0,
      task: "Retry compact mirror",
    })
    workflowStoreMocks.getRun.mockResolvedValue({ user_id: "user-1" })
    workflowStoreMocks.addRunEvent
      .mockRejectedValueOnce(new Error("transient D1 failure"))
      .mockResolvedValueOnce({})

    await expect(
      mirrorSubagentWorkflowEvent({
        env,
        repository: repository([started]),
        sessionId: "session-1",
        event: started,
      }),
    ).rejects.toThrow("transient D1 failure")
    await mirrorSubagentWorkflowEvent({
      env,
      repository: repository([started]),
      sessionId: "session-1",
      event: { ...started, replay: true },
    })

    expect(workflowStoreMocks.addRunEvent).toHaveBeenCalledTimes(2)
    expect(workflowStoreMocks.addRunEvent.mock.calls[0]?.[0].id).toBe(
      workflowStoreMocks.addRunEvent.mock.calls[1]?.[0].id,
    )
  })
})
