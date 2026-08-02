import { describe, expect, it, vi } from "vitest"
import { Option, Schema } from "effect"
import * as Effect from "effect/Effect"
import {
  CreateSessionPayload,
  PromptPayload,
  PromptResponse,
  ResumeSessionPayload,
  ResumeSessionResponse,
  RunSessionPayload,
  RunSessionResponse,
} from "../../packages/api/src"
import { SessionIndexStore } from "../../packages/api/src/server/background/db/session-index"
import { SessionRepository } from "../../packages/api/src/server/background/session/repository"
import { collectPromptResult } from "../../packages/api/src/server/effect/handlers/shared/control-plane/sessions"
import { InternalRequests } from "../../packages/api/src/server/effect/handlers/shared/control-plane"
import { DEFAULT_ISOLATE_STEP_LIMIT } from "../../packages/shared/src"

function createSqlResult(rows: unknown[] = []): { toArray: () => unknown[]; one: () => unknown } {
  return {
    toArray: () => rows,
    one: () => rows[0] ?? null,
  }
}

describe("session runtime contract", () => {
  it("defaults create and run requests to isolate sessions", () => {
    const createRequest = Schema.decodeUnknownSync(CreateSessionPayload)({
      title: "Isolate by default",
    })
    const runRequest = Schema.decodeUnknownSync(RunSessionPayload)({
      content: "hello world",
    })
    const incognitoRunRequest = Schema.decodeUnknownSync(RunSessionPayload)({
      content: "hello world",
      incognito: true,
    })

    expect(createRequest.sessionKind).toBe("isolate")
    expect(createRequest.incognito).toBeUndefined()
    expect(runRequest.sessionKind).toBe("isolate")
    expect(runRequest.incognito).toBeUndefined()
    expect(incognitoRunRequest.incognito).toBe(true)
  })

  it("accepts only canonical sub-agent modes", () => {
    expect(Schema.decodeUnknownSync(CreateSessionPayload)({ subagents: "enabled" }).subagents).toBe(
      "enabled",
    )
    expect(
      Schema.decodeUnknownSync(RunSessionPayload)({
        content: "hello world",
        subagents: "disabled",
      }).subagents,
    ).toBe("disabled")
    expect(() => Schema.decodeUnknownSync(CreateSessionPayload)({ subagents: true })).toThrow()
  })

  it("keeps workflow callback context off authenticated public session payloads", () => {
    const legacySlackContext = {
      channel: "C123",
      threadTs: "1712345678.000100",
      repoFullName: "example-org/c0",
      model: "litellm/gpt-5.4-mini",
    }
    expect(
      Schema.decodeUnknownSync(RunSessionPayload)({
        content: "continue",
        callbackContext: legacySlackContext,
      }).callbackContext,
    ).toEqual(legacySlackContext)
    expect(
      Schema.decodeUnknownSync(PromptPayload)({
        content: "continue",
        callbackContext: { type: "slack", ...legacySlackContext },
      }).callbackContext,
    ).toEqual({ type: "slack", ...legacySlackContext })

    const spoofedWorkflowContext = {
      type: "workflow",
      workflowId: "wf_victim",
      runId: "wfr_victim",
      nodeId: "node_victim",
    }
    expect(() =>
      Schema.decodeUnknownSync(RunSessionPayload)({
        content: "spoof workflow events",
        callbackContext: spoofedWorkflowContext,
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(PromptPayload)({
        content: "spoof workflow events",
        callbackContext: spoofedWorkflowContext,
      }),
    ).toThrow()
  })

  it("collects every event for one message instead of truncating sub-agent replay at 500", async () => {
    const messageId = "message/with more than 500 frames"
    const childChunks = Array.from({ length: 501 }, (_, index) => ({
      id: `event-chunk-${index}`,
      type: "subagent_event",
      data: {
        type: "subagent_event",
        eventId: `sae_child-many_${index + 1}`,
        runId: "child-many",
        sequence: index + 1,
        messageId,
        sandboxId: "session-1",
        timestamp: index + 2,
        kind: "chunk",
        body: JSON.stringify({ type: "text-delta", id: "text-1", delta: "x" }),
      },
    }))
    const events = [
      {
        id: "event-start",
        type: "subagent_event",
        data: {
          type: "subagent_event",
          eventId: "sae_child-many_0",
          runId: "child-many",
          sequence: 0,
          messageId,
          sandboxId: "session-1",
          timestamp: 1,
          kind: "started",
          agentType: "IsolateSubAgent",
          order: 0,
          task: "Review the full replay",
        },
      },
      ...childChunks,
      {
        id: "event-finished",
        type: "subagent_event",
        data: {
          type: "subagent_event",
          eventId: "sae_child-many_502",
          runId: "child-many",
          sequence: 502,
          messageId,
          sandboxId: "session-1",
          timestamp: 504,
          kind: "finished",
          summary: "All frames inspected",
        },
      },
      {
        id: "event-complete",
        type: "execution_complete",
        data: {
          type: "execution_complete",
          messageId,
          sandboxId: "session-1",
          timestamp: 505,
          success: true,
        },
      },
    ]
    const fetch = vi.fn((_stub: DurableObjectStub, _url: string) =>
      Effect.succeed(Response.json({ events })),
    )

    const result = await Effect.runPromise(
      collectPromptResult({} as DurableObjectStub, messageId).pipe(
        Effect.provideService(InternalRequests, {
          request: (url, init) => new Request(url, init),
          fetch,
        }),
      ),
    )

    expect(fetch).toHaveBeenCalledWith(
      {},
      `http://internal/internal/events?messageId=${encodeURIComponent(messageId)}`,
    )
    expect(result.status).toBe("completed")
    expect(result.subagentRuns).toEqual([
      expect.objectContaining({
        runId: "child-many",
        status: "completed",
        summary: "All frames inspected",
      }),
    ])
  })

  it("hydrates complete sub-agent message history without changing the pagination window", () => {
    const hydratedRows = [
      {
        id: "start-outside-tail",
        type: "subagent_event",
        data: "{}",
        message_id: "message-many",
        created_at: 1,
      },
      {
        id: "finish-inside-tail",
        type: "subagent_event",
        data: "{}",
        message_id: "message-many",
        created_at: 600,
      },
    ]
    const exec = vi.fn((query: string, limit: number) => {
      expect(limit).toBe(500)
      expect(query).toContain("WITH latest AS")
      expect(query).toContain("subagent_messages")
      expect(query).toContain("message_id IN")
      expect(query).toContain("ORDER BY created_at ASC, event_rowid ASC")
      return createSqlResult(hydratedRows)
    })
    const repository = new SessionRepository({ exec })

    expect(repository.events.getEventsForReplayWithSubagentHistory(500)).toEqual(hydratedRows)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it("preserves an explicitly selected Codex model in create and run payloads", () => {
    const createRequest = Schema.decodeUnknownSync(CreateSessionPayload)({
      agentRuntime: "codex",
      sessionKind: "sandbox",
      model: "litellm/gpt-5.6-terra",
    })
    const runRequest = Schema.decodeUnknownSync(RunSessionPayload)({
      content: "Hello, what model are you?",
      agentRuntime: "codex",
      sessionKind: "sandbox",
      model: "litellm/gpt-5.6-terra",
    })

    expect(createRequest).toMatchObject({
      agentRuntime: "codex",
      model: "litellm/gpt-5.6-terra",
    })
    expect(runRequest).toMatchObject({
      agentRuntime: "codex",
      model: "litellm/gpt-5.6-terra",
    })
  })

  it("normalizes legacy session rows to the OpenCode runtime", () => {
    const exec = vi.fn((query: string) => {
      if (query.includes("SELECT * FROM session")) {
        return createSqlResult([
          {
            id: "session-legacy",
            session_name: "session-legacy",
            session_kind: "sandbox",
            title: "Legacy sandbox",
            repo_owner: "",
            repo_name: "",
            tools_json: "[]",
            custom_mcp_json: "{}",
            secret_keys_json: "[]",
            isolate_step_limit: 8,
            model: "litellm/gpt-5.4-mini",
            reasoning_effort: null,
            status: "created",
            created_at: 1,
            updated_at: 1,
          },
        ])
      }
      return createSqlResult()
    })
    const repository = new SessionRepository({ exec })

    expect(Option.getOrThrow(repository.getSession()).agent_runtime).toBe("opencode")
  })

  it("matches the prompt and run API response shapes returned by sessions", () => {
    const promptResponse = Schema.decodeUnknownSync(PromptResponse)({
      messageId: "message-123",
      status: "queued",
    })
    const resumePayload = Schema.decodeUnknownSync(ResumeSessionPayload)({
      messageId: "message-123",
      reason: "okta_reconnect",
    })
    const resumeResponse = Schema.decodeUnknownSync(ResumeSessionResponse)({
      messageId: "message-456",
      resumedFromMessageId: "message-123",
      status: "queued",
      alreadyResuming: false,
    })
    const runResponse = Schema.decodeUnknownSync(RunSessionResponse)({
      sessionId: "session-123",
      sessionKind: "isolate",
      agentRuntime: "isolate",
      createdSession: true,
      messageId: "message-123",
      status: "completed",
      output: null,
    })

    expect(promptResponse.messageId).toBe("message-123")
    expect(resumePayload.reason).toBe("okta_reconnect")
    expect(resumeResponse.resumedFromMessageId).toBe("message-123")
    expect(runResponse.createdSession).toBe(true)
  })

  it("persists session_kind and agent_runtime in the per-session repository", () => {
    const exec = vi.fn((_query: string, ..._params: unknown[]) => createSqlResult())
    const repository = new SessionRepository({
      exec,
    })

    repository.upsertSession({
      id: "session-123",
      sessionName: "session-123",
      sessionKind: "sandbox",
      agentRuntime: "opencode",
      title: "Sandbox session",
      repoOwner: "",
      repoName: "",
      tools: [],
      customMcpServers: {},
      model: "litellm/gpt-5.4-mini",
      reasoningEffort: null,
      status: "created",
      createdAt: 1,
      updatedAt: 1,
    })

    expect(exec).toHaveBeenCalledTimes(1)
    const [query, ...params] = exec.mock.calls[0]!
    expect(query).toContain("session_kind")
    expect(query).toContain("agent_runtime")
    expect(query).toContain("isolate_step_limit")
    expect(query).toContain("subagents")
    expect(params[2]).toBe("sandbox")
    expect(params[3]).toBe("opencode")
    expect(params).toContain(DEFAULT_ISOLATE_STEP_LIMIT)
    expect(params).toContain("disabled")
  })

  it("records sandbox activity when a sandbox runtime is created", () => {
    const exec = vi.fn((query: string, ..._params: unknown[]) => {
      if (query.includes("SELECT * FROM session")) {
        return createSqlResult([
          {
            id: "session-123",
            session_name: "session-123",
            session_kind: "sandbox",
            agent_runtime: "opencode",
            title: "Sandbox session",
            repo_owner: "",
            repo_name: "",
            tools_json: "[]",
            custom_mcp_json: "{}",
            model: "litellm/gpt-5.4-mini",
            reasoning_effort: null,
            status: "created",
            created_at: 1,
            updated_at: 1,
          },
        ])
      }
      if (query.includes("SELECT * FROM sandbox")) {
        return createSqlResult([
          {
            id: "sandbox-row",
            sandbox_id: null,
            auth_token: null,
            opencode_session_id: null,
            opencode_server_port: null,
            opencode_config_signature: null,
            status: "pending",
            last_heartbeat: null,
            last_activity: null,
            last_spawn_error: null,
            last_spawn_error_at: null,
            created_at: 0,
          },
        ])
      }
      return createSqlResult()
    })
    const repository = new SessionRepository({ exec })

    repository.updateRuntimeForSpawn({
      status: "spawning",
      runtimeId: "sandbox-123",
      authToken: "token-123",
      createdAt: 123,
    })

    const activityInsert = exec.mock.calls.find(([query]) =>
      String(query).includes("INSERT INTO sandbox_activity"),
    )
    expect(activityInsert).toBeDefined()
    expect(activityInsert?.[3]).toBe("created")
    expect(activityInsert?.[4]).toBe("OpenCode created")
    expect(activityInsert?.[5]).toBe(null)
    expect(activityInsert?.[6]).toBe("spawning")
    expect(activityInsert?.[7]).toBe(null)
    expect(activityInsert?.[9]).toContain("previousSandboxId")
    expect(activityInsert?.[9]).toContain("previousRuntimeId")
  })

  it("records isolate runtime activity through the runtime activity interface", () => {
    const exec = vi.fn((query: string, ..._params: unknown[]) => {
      if (query.includes("SELECT * FROM session")) {
        return createSqlResult([
          {
            id: "session-123",
            session_name: "session-123",
            session_kind: "isolate",
            agent_runtime: "isolate",
            title: "Isolate session",
            repo_owner: "",
            repo_name: "",
            tools_json: "[]",
            custom_mcp_json: "{}",
            model: "litellm/gpt-5.4-mini",
            reasoning_effort: null,
            status: "created",
            created_at: 1,
            updated_at: 1,
          },
        ])
      }
      if (query.includes("SELECT * FROM sandbox")) {
        return createSqlResult([
          {
            id: "sandbox-row",
            sandbox_id: null,
            auth_token: null,
            opencode_session_id: null,
            opencode_server_port: null,
            opencode_config_signature: null,
            status: "pending",
            last_heartbeat: null,
            last_activity: null,
            last_spawn_error: null,
            last_spawn_error_at: null,
            created_at: 0,
          },
        ])
      }
      return createSqlResult()
    })
    const createdRows: Array<{ summary: string; runtimeId: string | null }> = []
    const repository = new SessionRepository({ exec }, (row) => {
      createdRows.push({ summary: row.summary, runtimeId: row.runtimeId })
    })

    repository.updateRuntimeForSpawn({
      status: "ready",
      runtimeId: "isolate-runtime-123",
      authToken: "isolate",
      createdAt: 123,
    })

    const createdInsert = exec.mock.calls.find(
      ([query, , , type, summary]) =>
        String(query).includes("INSERT INTO sandbox_activity") &&
        type === "created" &&
        summary === "Isolate created",
    )
    expect(createdInsert).toBeDefined()
    expect(createdRows).toContainEqual({
      summary: "Isolate created",
      runtimeId: "isolate-runtime-123",
    })
    expect(createdRows).toContainEqual({
      summary: "Isolate started",
      runtimeId: "isolate-runtime-123",
    })
  })

  it("keeps sandbox activity storage as a compatibility adapter", () => {
    const exec = vi.fn((query: string, ..._params: unknown[]) => {
      if (query.includes("SELECT * FROM session")) {
        return createSqlResult([
          {
            id: "session-123",
            session_name: "session-123",
            session_kind: "isolate",
            agent_runtime: "isolate",
            title: "Isolate session",
            repo_owner: "",
            repo_name: "",
            tools_json: "[]",
            custom_mcp_json: "{}",
            model: "litellm/gpt-5.4-mini",
            reasoning_effort: null,
            status: "created",
            created_at: 1,
            updated_at: 1,
          },
        ])
      }
      return createSqlResult()
    })
    const createdRows: Array<{
      runtimeId: string | null
      type: string
      keepAlive: boolean | null
    }> = []
    const repository = new SessionRepository({ exec }, (row) => {
      createdRows.push({
        runtimeId: row.runtimeId,
        type: row.type,
        keepAlive: row.keepAlive,
      })
    })

    const row = repository.recordRuntimeActivity({
      runtimeId: "isolate-runtime-123",
      type: "keep_alive_changed",
      summary: "Isolate keep alive enabled",
      keepAlive: true,
      data: { source: "test" },
      createdAt: 456,
    })

    const activityInsert = exec.mock.calls.find(([query]) =>
      String(query).includes("INSERT INTO sandbox_activity"),
    )
    expect(Option.getOrThrow(row)).toMatchObject({
      runtimeId: "isolate-runtime-123",
      type: "keep_alive_changed",
      keepAlive: true,
      createdAt: 456,
    })
    expect(activityInsert).toBeDefined()
    expect(activityInsert?.[2]).toBe("isolate-runtime-123")
    expect(activityInsert?.[7]).toBe(1)
    expect(createdRows).toContainEqual({
      runtimeId: "isolate-runtime-123",
      type: "keep_alive_changed",
      keepAlive: true,
    })
  })

  it("lists legacy sandbox activity rows as runtime activity rows", () => {
    const exec = vi.fn((query: string, ..._params: unknown[]) => {
      if (query.includes("FROM sandbox_activity")) {
        return createSqlResult([
          {
            id: "activity-123",
            sandbox_id: "runtime-123",
            type: "created",
            summary: "Isolate created",
            status_from: null,
            status_to: "ready",
            keep_alive: null,
            reason: null,
            data: '{"source":"legacy-table"}',
            created_at: 789,
          },
        ])
      }
      return createSqlResult()
    })
    const repository = new SessionRepository({ exec })

    expect(repository.listRuntimeActivity(100)).toEqual([
      {
        id: "activity-123",
        runtimeId: "runtime-123",
        type: "created",
        summary: "Isolate created",
        statusFrom: null,
        statusTo: "ready",
        keepAlive: null,
        reason: null,
        dataJson: '{"source":"legacy-table"}',
        createdAt: 789,
      },
    ])
  })

  it("persists session_kind and incognito in the session index store", async () => {
    const run = vi.fn(async () => ({
      success: true as const,
      results: [],
      meta: {
        served_by: "test",
        duration: 0,
        changes: 1,
        last_row_id: 1,
        changed_db: true,
        size_after: 0,
        rows_read: 0,
        rows_written: 1,
      },
    }))
    let statement: D1PreparedStatement
    const bind = vi.fn((..._params: unknown[]) => statement)
    statement = {
      bind,
      first: vi.fn(),
      run,
      all: vi.fn(),
      raw: vi.fn(),
    }
    const prepare = vi.fn((_query: string) => statement)
    const store = new SessionIndexStore({
      prepare,
      batch: vi.fn(),
      exec: vi.fn(),
      withSession: vi.fn(),
      dump: vi.fn(),
    })

    await Effect.runPromise(
      store.create({
        id: "session-123",
        userId: "user-456",
        title: "Sandbox session",
        repoOwner: "",
        repoName: "",
        tools: [],
        customMcpServers: {},
        model: "litellm/gpt-5.4-mini",
        reasoningEffort: null,
        sessionKind: "sandbox",
        agentRuntime: "opencode",
        incognito: true,
        status: "created",
        createdAt: 1,
        updatedAt: 1,
      }),
    )

    expect(prepare).toHaveBeenCalledTimes(1)
    const [query] = prepare.mock.calls[0]!
    expect(query).toContain("session_kind")
    expect(query).toContain("agent_runtime")
    expect(query).toContain("incognito")
    expect(query).toContain("isolate_step_limit")
    const bindArgs = bind.mock.calls[0]!
    expect(bindArgs).not.toContain("hostkey1234567")
    expect(bindArgs).toContain("sandbox")
    expect(bindArgs).toContain("opencode")
    expect(bindArgs).toContain(1)
    expect(bindArgs).toContain(DEFAULT_ISOLATE_STEP_LIMIT)
  })

  it("persists reusable workflow session key mappings in D1", async () => {
    const run = vi.fn(async () => ({
      success: true as const,
      results: [],
      meta: {
        served_by: "test",
        duration: 0,
        changes: 1,
        last_row_id: 1,
        changed_db: true,
        size_after: 0,
        rows_read: 0,
        rows_written: 1,
      },
    }))
    let statement: D1PreparedStatement
    const bind = vi.fn((..._params: unknown[]) => statement)
    statement = {
      bind,
      first: vi.fn(),
      run,
      all: vi.fn(),
      raw: vi.fn(),
    }
    const prepare = vi.fn((_query: string) => statement)
    const store = new SessionIndexStore({
      prepare,
      batch: vi.fn(),
      exec: vi.fn(),
      withSession: vi.fn(),
      dump: vi.fn(),
    })

    await Effect.runPromise(
      store.upsertWorkflowSessionReuseKey({
        userId: "user-456",
        workflowId: "wf-1",
        nodeId: "agent",
        sessionKind: "isolate",
        keyHash: "abc123",
        sessionId: "session-123",
        now: 10,
      }),
    )

    expect(prepare).toHaveBeenCalledTimes(1)
    const [query] = prepare.mock.calls[0]!
    expect(query).toContain("workflow_session_reuse_keys")
    expect(query.toLowerCase()).toContain("on conflict")
    const bindArgs = bind.mock.calls[0]!
    expect(bindArgs).toEqual([
      "user-456",
      "wf-1",
      "agent",
      "isolate",
      "abc123",
      "session-123",
      10,
      10,
      "session-123",
      10,
    ])
  })
})
