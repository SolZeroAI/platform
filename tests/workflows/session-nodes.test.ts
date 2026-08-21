/* oxlint-disable anti-slop/no-module-mocking -- Production modules import at module scope. Replacing these mocks needs DI seams at those factories. */
import * as Effect from "effect/Effect"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_ISOLATE_STEP_LIMIT } from "../../packages/shared/src"
import type { Env } from "../../packages/api/src/server/background/types"

const workflowStoreMocks = vi.hoisted(() => ({
  getWorkflow: vi.fn(),
}))

const sessionIndexStoreMocks = vi.hoisted(() => ({
  getById: vi.fn(),
  getWorkflowSessionReuseSessionId: vi.fn(),
  upsertWorkflowSessionReuseKey: vi.fn(),
}))

const sessionRunMocks = vi.hoisted(() => ({
  run: vi.fn(),
}))

vi.mock("../../packages/api/src/server/background/db/workflows", () => {
  class WorkflowStore {
    getWorkflow = workflowStoreMocks.getWorkflow
  }

  return {
    WorkflowStore,
    createWorkflowStoreFromD1: () => new WorkflowStore(),
  }
})

vi.mock("../../packages/api/src/server/background/db/session-index", () => {
  class SessionIndexStore {
    getById = sessionIndexStoreMocks.getById
    getWorkflowSessionReuseSessionId = sessionIndexStoreMocks.getWorkflowSessionReuseSessionId
    upsertWorkflowSessionReuseKey = sessionIndexStoreMocks.upsertWorkflowSessionReuseKey
  }

  return {
    SessionIndexStore,
    createSessionIndexStoreFromD1: () => new SessionIndexStore(),
  }
})

vi.mock("../../packages/api/src/server/application/session-run", () => ({
  runSessionApplication: sessionRunMocks.run,
}))

import {
  executeWorkflowSessionNode,
  isWorkflowSessionNodeType,
  type WorkflowSessionNodeExecutionInput,
} from "../../packages/api/src/server/background/workflows/nodes/session"

type MockKvNamespace = KVNamespace & {
  get: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
}

function createWorkflowRecord() {
  return {
    id: "wf_1",
    user_id: "owner_1",
    name: "Incident workflow",
  }
}

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    STAGE: "dev",
    WORKFLOW_SESSION_RESPONSE_CACHE: createResponseCache(),
    ...overrides,
  } as unknown as Env
}

function mockSessionRun(
  body: Record<string, unknown> = {
    sessionId: "session_1",
    messageId: "msg_1",
    output: "done",
    status: "completed",
    createdSession: true,
  },
) {
  sessionRunMocks.run.mockReturnValue(Effect.succeed(Response.json(body)))
  return sessionRunMocks.run
}

function getSessionRunInput(runMock: ReturnType<typeof vi.fn>) {
  return runMock.mock.calls[0]![0] as {
    actorUserId: string
    forcedKind: "isolate" | "sandbox"
    request: Request
    payload: Record<string, unknown>
    trustedWorkflowCallbackContext?: Record<string, unknown>
  }
}

function createResponseCache(initialValue: string | null = null): MockKvNamespace {
  const values = new Map<string, string>()
  const cache = {
    get: vi.fn(async (key: string) => initialValue ?? values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value)
    }),
  }
  return cache as unknown as MockKvNamespace
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function createInput(
  input: Partial<WorkflowSessionNodeExecutionInput> & {
    node: WorkflowSessionNodeExecutionInput["node"]
  },
): WorkflowSessionNodeExecutionInput {
  return {
    env: createEnv(),
    workflowId: "wf_1",
    runId: "run_1",
    inputs: {},
    trigger: { kind: "manual", payload: {} },
    userId: "user_1",
    ...input,
  }
}

describe("workflow session node adapter", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    workflowStoreMocks.getWorkflow.mockResolvedValue(createWorkflowRecord())
    sessionIndexStoreMocks.getById.mockResolvedValue(null)
    sessionIndexStoreMocks.getWorkflowSessionReuseSessionId.mockResolvedValue(null)
    sessionIndexStoreMocks.upsertWorkflowSessionReuseKey.mockResolvedValue(undefined)
  })

  it("identifies session Workflow Node types", () => {
    expect(isWorkflowSessionNodeType("isolate-session")).toBe(true)
    expect(isWorkflowSessionNodeType("sandbox-session")).toBe(true)
    expect(isWorkflowSessionNodeType("http-request")).toBe(false)
  })

  it("runs isolate sessions directly with the authenticated workflow actor", async () => {
    const runMock = mockSessionRun()
    const env = createEnv()

    const result = await Effect.runPromise(
      executeWorkflowSessionNode(
        createInput({
          env,
          node: {
            id: "agent",
            type: "isolate-session",
            label: "Run agent",
            options: {
              prompt: "Handle {{inputs.alert}}",
              model: "litellm/gpt-5.4-mini",
              reasoningEffort: "low",
              secretKeys: ["ALERTS_TOKEN"],
            },
          },
          inputs: { alert: "disk full" },
        }),
      ),
    )

    const runInput = getSessionRunInput(runMock)
    expect(runInput.actorUserId).toBe("user_1")
    expect(runInput.forcedKind).toBe("isolate")
    expect(new URL(runInput.request.url).pathname).toBe("/sessions/run")
    expect(runInput.payload).toMatchObject({
      title: "Incident workflow: Run agent",
      content: "Handle disk full",
      model: "litellm/gpt-5.4-mini",
      reasoningEffort: "low",
      isolateStepLimit: DEFAULT_ISOLATE_STEP_LIMIT,
      incognito: true,
      subagents: "enabled",
      secretKeys: ["ALERTS_TOKEN"],
    })
    expect(runInput.payload).not.toHaveProperty("callbackContext")
    expect(runInput.trustedWorkflowCallbackContext).toEqual({
      type: "workflow",
      workflowId: "wf_1",
      runId: "run_1",
      nodeId: "agent",
    })
    expect(result).toEqual({
      outputs: {
        sessionId: "session_1",
        messageId: "msg_1",
        output: "done",
        status: "completed",
        error: undefined,
        cacheHit: false,
        createdSession: true,
      },
    })
  })

  it("runs sandbox sessions through the direct application service", async () => {
    const runMock = mockSessionRun({ sessionId: "session_2" })
    const env = createEnv()

    await Effect.runPromise(
      executeWorkflowSessionNode(
        createInput({
          env,
          oktaUserId: "okta_given",
          node: {
            id: "sandbox",
            type: "sandbox-session",
            label: "Run sandbox",
            options: {
              model: "litellm/gpt-5.4-mini",
            },
          },
        }),
      ),
    )

    const runInput = getSessionRunInput(runMock)
    expect(runInput.actorUserId).toBe("user_1")
    expect(runInput.forcedKind).toBe("sandbox")
    expect(runInput.payload).toMatchObject({
      incognito: true,
    })
    expect(runInput.payload).not.toHaveProperty("subagents")
    expect(runInput.payload).not.toHaveProperty("isolateStepLimit")
  })

  it("does not make an HTTP request to run a session", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    mockSessionRun({ sessionId: "session_2" })
    const env = createEnv()

    await Effect.runPromise(
      executeWorkflowSessionNode(
        createInput({
          env,
          oktaUserId: null,
          node: {
            id: "sandbox",
            type: "sandbox-session",
            label: "Run sandbox",
            options: {
              model: "litellm/gpt-5.4-mini",
            },
          },
        }),
      ),
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns cached session responses without calling the agent runtime", async () => {
    const runMock = mockSessionRun()
    const cache = createResponseCache(
      JSON.stringify({
        sessionId: "session_cached",
        messageId: "msg_cached",
        output: "cached answer",
        status: "completed",
        subagentRuns: [
          {
            runId: "child_1",
            agentType: "IsolateSubAgent",
            status: "completed",
            startedAt: 1,
            completedAt: 2,
            durationMs: 1000,
            toolCallCount: 2,
            toolNames: ["search", "read"],
            summary: "Found the relevant evidence",
          },
        ],
      }),
    )
    const env = createEnv({ WORKFLOW_SESSION_RESPONSE_CACHE: cache })

    const result = await Effect.runPromise(
      executeWorkflowSessionNode(
        createInput({
          env,
          node: {
            id: "agent",
            type: "isolate-session",
            label: "Run agent",
            options: {
              model: "litellm/gpt-5.4-mini",
              cacheKey: "alert:{{inputs.alert}}",
              cacheTtlSeconds: 120,
            },
          },
          inputs: { alert: "disk full" },
        }),
      ),
    )

    expect(cache.get).toHaveBeenCalledTimes(1)
    expect(runMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      outputs: {
        sessionId: "session_cached",
        messageId: "msg_cached",
        output: "cached answer",
        status: "completed",
        error: undefined,
        cacheHit: true,
        createdSession: false,
        subagentRuns: [
          expect.objectContaining({
            runId: "child_1",
            status: "completed",
            toolCallCount: 2,
          }),
        ],
      },
    })
  })

  it("writes completed cache misses to KV with the configured TTL", async () => {
    mockSessionRun({
      sessionId: "session_1",
      messageId: "msg_1",
      output: "fresh answer",
      status: "completed",
      createdSession: true,
    })
    const cache = createResponseCache()
    const env = createEnv({ WORKFLOW_SESSION_RESPONSE_CACHE: cache })

    await Effect.runPromise(
      executeWorkflowSessionNode(
        createInput({
          env,
          node: {
            id: "agent",
            type: "isolate-session",
            label: "Run agent",
            options: {
              model: "litellm/gpt-5.4-mini",
              cacheKey: "alert:{{inputs.alert}}",
              cacheTtlSeconds: 120,
            },
          },
          inputs: { alert: "disk full" },
        }),
      ),
    )

    expect(cache.put).toHaveBeenCalledTimes(1)
    const [, value, options] = cache.put.mock.calls[0]!
    expect(JSON.parse(String(value))).toEqual({
      sessionId: "session_1",
      messageId: "msg_1",
      output: "fresh answer",
      status: "completed",
    })
    expect(options).toEqual({ expirationTtl: 120 })
  })

  it("keeps Isolate response caches separate across sub-agent modes", async () => {
    const runMock = mockSessionRun({
      sessionId: "session_1",
      messageId: "msg_1",
      output: "fresh answer",
      status: "completed",
      createdSession: true,
    })
    const cache = createResponseCache()
    const env = createEnv({ WORKFLOW_SESSION_RESPONSE_CACHE: cache })
    const node = (subagents: "enabled" | "disabled") => ({
      id: "agent",
      type: "isolate-session" as const,
      label: "Run agent",
      options: {
        model: "litellm/gpt-5.4-mini",
        cacheKey: "alert:{{inputs.alert}}",
        cacheTtlSeconds: 120,
        subagents,
      },
    })

    await Effect.runPromise(
      executeWorkflowSessionNode(
        createInput({ env, node: node("enabled"), inputs: { alert: "disk full" } }),
      ),
    )
    await Effect.runPromise(
      executeWorkflowSessionNode(
        createInput({ env, node: node("disabled"), inputs: { alert: "disk full" } }),
      ),
    )

    expect(runMock).toHaveBeenCalledTimes(2)
    expect(cache.get.mock.calls[0]?.[0]).not.toBe(cache.get.mock.calls[1]?.[0])
  })

  it("disables response caching below Cloudflare KV's minimum TTL", async () => {
    const runMock = mockSessionRun({
      sessionId: "session_1",
      messageId: "msg_1",
      output: "fresh answer",
      status: "completed",
      createdSession: true,
    })
    const cache = createResponseCache()
    const env = createEnv({ WORKFLOW_SESSION_RESPONSE_CACHE: cache })

    await Effect.runPromise(
      executeWorkflowSessionNode(
        createInput({
          env,
          node: {
            id: "agent",
            type: "isolate-session",
            label: "Run agent",
            options: {
              model: "litellm/gpt-5.4-mini",
              cacheKey: "alert:{{inputs.alert}}",
              cacheTtlSeconds: 59,
            },
          },
          inputs: { alert: "disk full" },
        }),
      ),
    )

    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
    expect(runMock).toHaveBeenCalledTimes(1)
  })

  it("reuses valid session key mappings and prefers connected key inputs", async () => {
    sessionIndexStoreMocks.getWorkflowSessionReuseSessionId.mockResolvedValue("session_reused")
    sessionIndexStoreMocks.getById.mockResolvedValue({
      id: "session_reused",
      user_id: "user_1",
      session_kind: "isolate",
      incognito: true,
      subagents: "enabled",
      status: "active",
    })
    const runMock = mockSessionRun({
      sessionId: "session_reused",
      messageId: "msg_2",
      output: "continued answer",
      status: "completed",
      createdSession: false,
    })
    const env = createEnv()

    await Effect.runPromise(
      executeWorkflowSessionNode(
        createInput({
          env,
          node: {
            id: "agent",
            type: "isolate-session",
            label: "Run agent",
            options: {
              model: "litellm/gpt-5.4-mini",
              sessionKey: "option-key",
            },
          },
          inputs: { sessionKey: "input-key" },
        }),
      ),
    )

    expect(sessionIndexStoreMocks.getWorkflowSessionReuseSessionId).toHaveBeenCalledWith({
      userId: "user_1",
      workflowId: "wf_1",
      nodeId: "agent",
      sessionKind: "isolate",
      keyHash: await sha256Hex("input-key"),
    })
    const runInput = getSessionRunInput(runMock)
    expect(runInput.payload).toMatchObject({
      sessionId: "session_reused",
    })
    expect(sessionIndexStoreMocks.upsertWorkflowSessionReuseKey).not.toHaveBeenCalled()
  })

  it("overwrites stale session key mappings with the new session", async () => {
    sessionIndexStoreMocks.getWorkflowSessionReuseSessionId.mockResolvedValue("session_old")
    sessionIndexStoreMocks.getById.mockResolvedValue({
      id: "session_old",
      user_id: "user_1",
      session_kind: "isolate",
      incognito: true,
      subagents: "enabled",
      status: "archived",
    })
    const runMock = mockSessionRun({
      sessionId: "session_new",
      messageId: "msg_new",
      output: "new answer",
      status: "completed",
      createdSession: true,
    })
    const env = createEnv()

    await Effect.runPromise(
      executeWorkflowSessionNode(
        createInput({
          env,
          node: {
            id: "agent",
            type: "isolate-session",
            label: "Run agent",
            options: {
              model: "litellm/gpt-5.4-mini",
              sessionKey: "thread-1",
            },
          },
        }),
      ),
    )

    const runInput = getSessionRunInput(runMock)
    expect(runInput.payload.sessionId).toBeUndefined()
    expect(sessionIndexStoreMocks.upsertWorkflowSessionReuseKey).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        workflowId: "wf_1",
        nodeId: "agent",
        sessionKind: "isolate",
        keyHash: await sha256Hex("thread-1"),
        sessionId: "session_new",
      }),
    )
  })

  it("does not reuse session key mappings with mismatched incognito visibility", async () => {
    sessionIndexStoreMocks.getWorkflowSessionReuseSessionId.mockResolvedValue("session_visible")
    sessionIndexStoreMocks.getById.mockResolvedValue({
      id: "session_visible",
      user_id: "user_1",
      session_kind: "isolate",
      incognito: false,
      subagents: "enabled",
      status: "active",
    })
    const runMock = mockSessionRun({
      sessionId: "session_hidden",
      messageId: "msg_hidden",
      output: "hidden answer",
      status: "completed",
      createdSession: true,
    })
    const env = createEnv()

    await Effect.runPromise(
      executeWorkflowSessionNode(
        createInput({
          env,
          node: {
            id: "agent",
            type: "isolate-session",
            label: "Run agent",
            options: {
              model: "litellm/gpt-5.4-mini",
              sessionKey: "thread-1",
              incognito: true,
            },
          },
        }),
      ),
    )

    const runInput = getSessionRunInput(runMock)
    expect(runInput.payload.sessionId).toBeUndefined()
    expect(runInput.payload.incognito).toBe(true)
    expect(sessionIndexStoreMocks.upsertWorkflowSessionReuseKey).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session_hidden",
        keyHash: await sha256Hex("thread-1"),
      }),
    )
  })

  it("does not reuse an Isolate session with a different sub-agent mode", async () => {
    sessionIndexStoreMocks.getWorkflowSessionReuseSessionId.mockResolvedValue("session_disabled")
    sessionIndexStoreMocks.getById.mockResolvedValue({
      id: "session_disabled",
      user_id: "user_1",
      session_kind: "isolate",
      incognito: true,
      subagents: "disabled",
      status: "active",
    })
    const runMock = mockSessionRun({
      sessionId: "session_enabled",
      messageId: "msg_enabled",
      output: "new answer",
      status: "completed",
      createdSession: true,
    })

    await Effect.runPromise(
      executeWorkflowSessionNode(
        createInput({
          node: {
            id: "agent",
            type: "isolate-session",
            label: "Run agent",
            options: {
              model: "litellm/gpt-5.4-mini",
              sessionKey: "thread-1",
              subagents: "enabled",
            },
          },
        }),
      ),
    )

    expect(getSessionRunInput(runMock).payload).toMatchObject({
      sessionId: undefined,
      subagents: "enabled",
    })
    expect(sessionIndexStoreMocks.upsertWorkflowSessionReuseKey).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session_enabled" }),
    )
  })

  it("keeps missing v3 Isolate options disabled while v4 defaults to enabled", async () => {
    const runMock = mockSessionRun()
    const node = {
      id: "agent",
      type: "isolate-session" as const,
      label: "Run agent",
      options: { model: "litellm/gpt-5.4-mini" },
    }

    await Effect.runPromise(executeWorkflowSessionNode(createInput({ manifestVersion: 3, node })))
    expect(getSessionRunInput(runMock).payload.subagents).toBe("disabled")

    runMock.mockClear()
    await Effect.runPromise(executeWorkflowSessionNode(createInput({ manifestVersion: 4, node })))
    expect(getSessionRunInput(runMock).payload.subagents).toBe("enabled")
  })

  it("requires an explicit model for workflow agent nodes", async () => {
    await expect(
      Effect.runPromise(
        executeWorkflowSessionNode(
          createInput({
            node: {
              id: "agent",
              type: "isolate-session",
              label: "Run agent",
              options: {},
            },
          }),
        ),
      ),
    ).rejects.toThrow("Workflow agent node requires an AI Provider model")
  })

  it("fails when the Workflow is not found", async () => {
    workflowStoreMocks.getWorkflow.mockResolvedValue(null)

    await expect(
      Effect.runPromise(
        executeWorkflowSessionNode(
          createInput({
            node: {
              id: "agent",
              type: "isolate-session",
              label: "Run agent",
              options: {},
            },
          }),
        ),
      ),
    ).rejects.toThrow("Workflow 'wf_1' was not found")
  })
})
