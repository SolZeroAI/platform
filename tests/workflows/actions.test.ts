import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { RequestLogger } from "../../packages/api/src/server/effect/services/observability"
import type { Env } from "../../packages/api/src/server/background/types"
import { WorkflowActionExecutor } from "../../packages/api/src/server/background/workflows/actions"

type SqliteValue = string | number | bigint | null | Uint8Array

class SqliteD1Statement implements D1PreparedStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly query: string,
    private readonly params: SqliteValue[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteD1Statement(this.db, this.query, values.map(toSqliteValue))
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    const row = this.db.prepare(this.query).get(...this.params) as Record<string, T> | undefined
    if (!row) {
      return null
    }
    if (columnName) {
      return row[columnName] ?? null
    }
    return row as T
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    const result = this.db.prepare(this.query).run(...this.params)
    return {
      results: [],
      success: true,
      meta: {
        changed_db: true,
        changes: result.changes,
        duration: 0,
        last_row_id: Number(result.lastInsertRowid),
        rows_read: 0,
        rows_written: result.changes,
        size_after: 0,
      },
    }
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const statement = this.db.prepare(this.query)
    const results = statement.all(...this.params) as T[]
    return {
      results,
      success: true,
      meta: {
        changed_db: false,
        changes: 0,
        duration: 0,
        last_row_id: 0,
        rows_read: results.length,
        rows_written: 0,
        size_after: 0,
      },
    }
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const statement = this.db.prepare(this.query)
    const columns = statement.columns().map((column) => column.name)
    const rows = statement.all(...this.params) as Record<string, unknown>[]
    return rows.map((row) => columns.map((column) => row[column])) as T[]
  }
}

class SqliteD1Database implements D1Database {
  constructor(private readonly db: DatabaseSync) {}

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this.db, query)
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return Promise.all(statements.map((statement) => statement.run<T>()))
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.db.exec(query)
    return { count: 0, duration: 0 }
  }
}

function toSqliteValue(value: unknown): SqliteValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value === null ||
    value instanceof Uint8Array
  ) {
    return value
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0
  }
  throw new TypeError(`Unsupported SQLite bind value: ${String(value)}`)
}

function createWorkflowEventsDb(runUserId = "user_1"): D1Database {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(`
    CREATE TABLE workflow_runs (
      id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, workflow_version INTEGER NOT NULL,
      workflow_instance_id TEXT, user_id TEXT NOT NULL, trigger_kind TEXT NOT NULL,
      trigger_node_id TEXT, status TEXT NOT NULL, input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT, error TEXT, started_at INTEGER NOT NULL, completed_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO workflow_runs (
      id, workflow_id, workflow_version, user_id, trigger_kind, status,
      input_json, started_at, updated_at
    ) VALUES ('run_1', 'wf_1', 1, '${runUserId}', 'manual', 'running', '{}', 1, 1);
    CREATE TABLE workflow_run_events (
      id          TEXT    PRIMARY KEY,
      workflow_id TEXT    NOT NULL,
      run_id      TEXT    NOT NULL,
      sequence    INTEGER NOT NULL,
      node_id     TEXT,
      event_type  TEXT    NOT NULL,
      level       TEXT    NOT NULL DEFAULT 'info',
      message     TEXT    NOT NULL,
      data_json   TEXT    NOT NULL DEFAULT '{}',
      created_at  INTEGER NOT NULL
    );
  `)
  return new SqliteD1Database(sqlite)
}

function createEnv(
  options: {
    db?: D1Database
    slackToken?: string
    workflowBucket?: Partial<Pick<R2Bucket, "get" | "put">>
    kvNamespace?: Partial<Pick<KVNamespace, "get" | "put">>
    runUserId?: string
  } = {},
): Env {
  const workflowBucket = {
    get: vi.fn(),
    put: vi.fn(),
    ...options.workflowBucket,
  }
  const kvNamespace = {
    get: vi.fn(),
    put: vi.fn(),
    ...options.kvNamespace,
  }
  return {
    DB: options.db ?? createWorkflowEventsDb(options.runUserId),
    WORKFLOW_BUCKET: workflowBucket,
    AI_SEARCH_CONTENT_BUCKET: workflowBucket,
    USER_WORKFLOW_KV: kvNamespace,
    REPOS_CACHE: kvNamespace,
    SLACK_TOKEN: options.slackToken,
  } as unknown as Env
}

describe("WorkflowActionExecutor", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it("logs error-level workflow run events with sanitized workflow context", async () => {
    const errorLog = vi.fn()
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: errorLog,
      set: vi.fn(),
      emit: vi.fn(),
    } as unknown as RequestLogger
    const message = "Slack API conversations.replies failed: invalid_arguments"
    const executor = new WorkflowActionExecutor(createEnv({ db: createWorkflowEventsDb() }), log)

    await expect(
      executor.recordWorkflowEvent({
        workflowId: "wf_1",
        runId: "run_1",
        userId: "user_1",
        oktaUserId: "okta_1",
        eventType: "run_failed",
        level: "error",
        message,
        data: {
          error: message,
          nodeId: "fetch_question_thread",
          nodeType: "slack-fetch-thread",
          nodeLabel: "Fetch question thread",
          rawPayload: { text: "do not log me" },
        },
      }),
    ).resolves.toEqual({ ok: true })

    expect(errorLog).toHaveBeenCalledWith(expect.any(Error), {
      event: "workflowRunEventError",
      workflowId: "wf_1",
      runId: "run_1",
      nodeId: "fetch_question_thread",
      nodeType: "slack-fetch-thread",
      nodeLabel: "Fetch question thread",
      workflowEventType: "run_failed",
      workflowEventLevel: "error",
      workflowEventMessage: message,
      workflowEventError: message,
    })
    expect(JSON.stringify(errorLog.mock.calls[0]?.[1])).not.toContain("rawPayload")
  })

  it("writes workflow outputs to the selected R2 bucket", async () => {
    const put = vi.fn(async () => ({ etag: "etag-1" }))
    const executor = new WorkflowActionExecutor(
      createEnv({ workflowBucket: { put } as Pick<R2Bucket, "put"> }),
    )

    const result = await executor.executeWorkflowNode({
      workflowId: "wf_1",
      runId: "run_1",
      node: {
        id: "save",
        type: "r2-put-object",
        label: "Save",
        options: {
          bucket: "WORKFLOW_BUCKET",
          key: "runs/{{runId}}/{{nodeId}}.json",
        },
      },
      inputs: { content: { ok: true } },
      trigger: { kind: "manual", payload: {} },
      userId: "user_1",
    })

    expect(put).toHaveBeenCalledWith("user_1/runs/run_1/save.json", '{\n  "ok": true\n}', {
      httpMetadata: { contentType: "application/json" },
    })
    expect(result).toEqual({
      outputs: {
        bucket: "WORKFLOW_BUCKET",
        key: "runs/run_1/save.json",
        etag: "etag-1",
        contentType: "application/json",
      },
    })
  })

  it("uses the workflow-run owner instead of the RPC-supplied user", async () => {
    const put = vi.fn(async () => ({ etag: "etag-1" }))
    const warn = vi.fn()
    const log = {
      info: vi.fn(),
      warn,
      error: vi.fn(),
      set: vi.fn(),
      emit: vi.fn(),
    } as unknown as RequestLogger
    const executor = new WorkflowActionExecutor(
      createEnv({ runUserId: "authoritative_user", workflowBucket: { put } }),
      log,
    )

    await executor.executeWorkflowNode({
      workflowId: "wf_1",
      runId: "run_1",
      node: {
        id: "save",
        type: "r2-put-object",
        label: "Save",
        options: { bucket: "WORKFLOW_BUCKET", key: "result.json" },
      },
      inputs: { content: "done" },
      trigger: { kind: "manual", payload: {} },
      userId: "spoofed_user",
    })

    expect(put).toHaveBeenCalledWith("authoritative_user/result.json", "done", expect.any(Object))
    expect(warn).toHaveBeenCalledWith(
      "workflow_action.actor_mismatch",
      expect.objectContaining({
        suppliedUserId: "spoofed_user",
        authoritativeUserId: "authoritative_user",
      }),
    )
  })

  it("rejects unsupported R2 bindings", async () => {
    const put = vi.fn()
    const executor = new WorkflowActionExecutor(
      createEnv({ workflowBucket: { put } as Pick<R2Bucket, "put"> }),
    )

    await expect(
      executor.executeWorkflowNode({
        workflowId: "wf_1",
        runId: "run_1",
        node: {
          id: "save",
          type: "r2-put-object",
          label: "Save",
          options: { bucket: "DO_NOT_USE" },
        },
        inputs: { content: "hello" },
        trigger: { kind: "manual", payload: {} },
        userId: "user_1",
      }),
    ).rejects.toThrow("Unsupported workflow R2 bucket 'DO_NOT_USE'")
  })

  it("runs HTTP request nodes with templated options", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { accepted: true },
        {
          status: 202,
          headers: { "x-result": "ok" },
        },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)
    const executor = new WorkflowActionExecutor(createEnv())

    const result = await executor.executeWorkflowNode({
      workflowId: "wf_1",
      runId: "run_1",
      node: {
        id: "request",
        type: "http-request",
        label: "Request",
        options: {
          method: "POST",
          url: "https://example.com/{{inputs.path}}",
          headers: { "x-run": "{{runId}}" },
          body: "hello {{inputs.name}}",
          responseType: "json",
        },
      },
      inputs: { path: "api", name: "Ada" },
      trigger: { kind: "manual", payload: {} },
      userId: "user_1",
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({
        method: "POST",
        headers: { "x-run": "run_1" },
        body: "hello Ada",
      }),
    )
    expect(result).toMatchObject({
      outputs: {
        ok: true,
        status: 202,
        body: { accepted: true },
        json: { accepted: true },
        headers: { "content-type": "application/json", "x-result": "ok" },
      },
    })
  })

  it("renders HTTP request templates from connected inputs", async () => {
    const fetchMock = vi.fn(async () => Response.json({ accepted: true }, { status: 202 }))
    vi.stubGlobal("fetch", fetchMock)
    const executor = new WorkflowActionExecutor(createEnv())
    const sessionOutput = 'hello "Ada"\nline two'

    await executor.executeWorkflowNode({
      workflowId: "wf_1",
      runId: "run_1",
      node: {
        id: "request",
        type: "http-request",
        label: "Add note",
        options: {
          method: "POST",
          url: "https://api.opsgenie.com/v2/alerts/{{inputs.alert.alertId}}/notes",
          headers: { "Content-Type": "application/json" },
          body: '{ "note": "{{inputs.note}}" }',
        },
      },
      inputs: {
        alert: { alertId: "alert-1" },
        body: "raw edge value should not bypass configured body",
        note: sessionOutput,
      },
      trigger: { kind: "manual", payload: {} },
      userId: "user_1",
    })

    const [, requestInit] = fetchMock.mock.calls[0]

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.opsgenie.com/v2/alerts/alert-1/notes",
      expect.objectContaining({
        method: "POST",
      }),
    )
    expect(JSON.parse(String(requestInit?.body))).toEqual({ note: sessionOutput })
    expect(String(requestInit?.body)).toContain("\\n")
    expect(requestInit?.body).not.toBe(sessionOutput)
  })

  it("rejects unconnected node-output template paths", async () => {
    const executor = new WorkflowActionExecutor(createEnv())

    await expect(
      executor.executeWorkflowNode({
        workflowId: "wf_1",
        runId: "run_1",
        node: {
          id: "request",
          type: "http-request",
          label: "Add note",
          options: {
            method: "POST",
            url: "https://api.opsgenie.com/v2/alerts/{{nodes.normalize.result.alertId}}/notes",
          },
        },
        inputs: {},
        trigger: { kind: "manual", payload: {} },
        userId: "user_1",
      }),
    ).rejects.toThrow("Template path 'nodes.normalize.result.alertId' is not available")
  })

  it("uses the HTTP request input body when no body is configured", async () => {
    const fetchMock = vi.fn(async () => Response.json({ accepted: true }, { status: 202 }))
    vi.stubGlobal("fetch", fetchMock)
    const executor = new WorkflowActionExecutor(createEnv())

    await executor.executeWorkflowNode({
      workflowId: "wf_1",
      runId: "run_1",
      node: {
        id: "request",
        type: "http-request",
        label: "Request",
        options: {
          method: "POST",
          url: "https://example.com/notes",
          body: "",
        },
      },
      inputs: { body: { note: "hello" } },
      trigger: { kind: "manual", payload: {} },
      userId: "user_1",
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/notes",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "hello" }, null, 2),
      }),
    )
  })

  it("uses the configured HTTP method when fail-on-error requests fail", async () => {
    const fetchMock = vi.fn(async () => new Response("Method Not Allowed", { status: 405 }))
    vi.stubGlobal("fetch", fetchMock)
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      set: vi.fn(),
      emit: vi.fn(),
      getContext: vi.fn(() => ({})),
    } as unknown as RequestLogger
    const executor = new WorkflowActionExecutor(createEnv(), log)

    await expect(
      executor.executeWorkflowNode({
        workflowId: "wf_1",
        runId: "run_1",
        node: {
          id: "request",
          type: "http-request",
          label: "Add OpsGenie note",
          options: {
            method: "POST",
            url: "https://api.opsgenie.com/v2/alerts/{{inputs.alertId}}/notes?identifierType=alias",
            headers: { Authorization: "GenieKey secret", "Content-Type": "application/json" },
            body: '{ "note": "{{inputs.note}}" }',
            failOnHttpError: true,
          },
        },
        inputs: { alertId: "alert-1", note: "hello" },
        trigger: { kind: "manual", payload: {} },
        userId: "user_1",
      }),
    ).rejects.toThrow("HTTP request failed with status 405")

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.opsgenie.com/v2/alerts/alert-1/notes?identifierType=alias",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "GenieKey secret",
          "Content-Type": "application/json",
        },
        body: '{ "note": "hello" }',
      }),
    )
  })

  it("writes workflow outputs to the selected KV namespace", async () => {
    const put = vi.fn(async () => undefined)
    const executor = new WorkflowActionExecutor(
      createEnv({ kvNamespace: { put } as Pick<KVNamespace, "put"> }),
    )

    const result = await executor.executeWorkflowNode({
      workflowId: "wf_1",
      runId: "run_1",
      node: {
        id: "save",
        type: "kv-put",
        label: "Save",
        options: {
          namespace: "REPOS_CACHE",
          key: "runs/{{runId}}/{{nodeId}}.json",
          expirationTtl: 60,
        },
      },
      inputs: { value: { ok: true } },
      trigger: { kind: "manual", payload: {} },
      userId: "user_1",
    })

    expect(put).toHaveBeenCalledWith("user_1/runs/run_1/save.json", '{\n  "ok": true\n}', {
      expirationTtl: 60,
    })
    expect(result).toEqual({
      outputs: {
        namespace: "REPOS_CACHE",
        key: "runs/run_1/save.json",
        expirationTtl: 60,
      },
    })
  })

  it("rejects unsupported KV namespaces", async () => {
    const put = vi.fn()
    const executor = new WorkflowActionExecutor(
      createEnv({ kvNamespace: { put } as Pick<KVNamespace, "put"> }),
    )

    await expect(
      executor.executeWorkflowNode({
        workflowId: "wf_1",
        runId: "run_1",
        node: {
          id: "save",
          type: "kv-put",
          label: "Save",
          options: { namespace: "DO_NOT_USE" },
        },
        inputs: { value: "hello" },
        trigger: { kind: "manual", payload: {} },
        userId: "user_1",
      }),
    ).rejects.toThrow("Unsupported workflow KV namespace 'DO_NOT_USE'")
  })

  it("reads workflow outputs from the selected R2 bucket", async () => {
    const get = vi.fn(async () => ({
      etag: "etag-1",
      httpMetadata: { contentType: "application/json" },
      text: async () => '{"ok":true}',
    }))
    const executor = new WorkflowActionExecutor(createEnv({ workflowBucket: { get } }))

    const result = await executor.executeWorkflowNode({
      workflowId: "wf_1",
      runId: "run_1",
      node: {
        id: "load",
        type: "r2-get-object",
        label: "Load",
        options: {
          bucket: "WORKFLOW_BUCKET",
          key: "runs/{{runId}}/save.json",
        },
      },
      inputs: {},
      trigger: { kind: "manual", payload: {} },
      userId: "user_1",
    })

    expect(get).toHaveBeenCalledWith("user_1/runs/run_1/save.json")
    expect(result).toEqual({
      outputs: {
        found: true,
        bucket: "WORKFLOW_BUCKET",
        key: "runs/run_1/save.json",
        body: { ok: true },
        json: { ok: true },
        text: '{"ok":true}',
        etag: "etag-1",
        contentType: "application/json",
      },
    })
  })

  it("reads workflow outputs from the selected KV namespace", async () => {
    const get = vi.fn(async () => '{"ok":true}')
    const executor = new WorkflowActionExecutor(createEnv({ kvNamespace: { get } }))

    const result = await executor.executeWorkflowNode({
      workflowId: "wf_1",
      runId: "run_1",
      node: {
        id: "load",
        type: "kv-get",
        label: "Load",
        options: {
          namespace: "REPOS_CACHE",
          key: "runs/{{runId}}/save.json",
        },
      },
      inputs: {},
      trigger: { kind: "manual", payload: {} },
      userId: "user_1",
    })

    expect(get).toHaveBeenCalledWith("user_1/runs/run_1/save.json")
    expect(result).toEqual({
      outputs: {
        found: true,
        namespace: "REPOS_CACHE",
        key: "runs/run_1/save.json",
        value: { ok: true },
        json: { ok: true },
        text: '{"ok":true}',
      },
    })
  })

  it("sends Slack message nodes", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, channel: "C123", ts: "123.456", message: { text: "ok" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    )
    vi.stubGlobal("fetch", fetchMock)
    const executor = new WorkflowActionExecutor(createEnv())

    const result = await executor.executeWorkflowNode({
      workflowId: "wf_1",
      runId: "run_1",
      node: {
        id: "send",
        type: "slack-send-message",
        label: "Send Slack",
        options: {
          channel: "C123",
          text: "Run {{runId}} completed",
        },
      },
      inputs: { token: "xoxb-secret" },
      trigger: { kind: "manual", payload: {} },
      userId: "user_1",
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer xoxb-secret",
          "Content-Type": "application/json; charset=utf-8",
        },
      }),
    )
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toEqual({
      channel: "C123",
      text: "Run run_1 completed",
      unfurl_links: false,
      unfurl_media: false,
    })
    expect(result).toEqual({
      outputs: {
        ok: true,
        channel: "C123",
        ts: "123.456",
        message: { text: "ok" },
      },
    })
  })

  it("falls back to env.SLACK_TOKEN for Slack message nodes without explicit tokens", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, channel: "C123", ts: "123.456" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const executor = new WorkflowActionExecutor(createEnv({ slackToken: "xoxb-env" }))

    const result = await executor.executeWorkflowNode({
      workflowId: "wf_1",
      runId: "run_1",
      node: {
        id: "send",
        type: "slack-send-message",
        label: "Send Slack",
        options: {
          channel: "C123",
          text: "Run {{runId}} completed",
        },
      },
      inputs: {},
      trigger: { kind: "manual", payload: {} },
      userId: "user_1",
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer xoxb-env",
          "Content-Type": "application/json; charset=utf-8",
        },
      }),
    )
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toEqual({
      channel: "C123",
      text: "Run run_1 completed",
      unfurl_links: false,
      unfurl_media: false,
    })
    expect(result).toEqual({
      outputs: {
        ok: true,
        channel: "C123",
        ts: "123.456",
        message: null,
      },
    })
  })

  it("fails email notification nodes as coming soon without calling an email provider", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal("fetch", fetchMock)
    const executor = new WorkflowActionExecutor(createEnv())

    await expect(
      executor.executeWorkflowNode({
        workflowId: "wf_1",
        runId: "run_1",
        node: {
          id: "email",
          type: "email-notification",
          label: "Email",
          options: {
            to: "ops@example.com",
            from: "s0@example.com",
            subject: "Run {{runId}}",
            body: "Done",
          },
        },
        inputs: {},
        trigger: { kind: "manual", payload: {} },
        userId: "user_1",
      }),
    ).rejects.toThrow("Email notifications are coming soon.")

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
