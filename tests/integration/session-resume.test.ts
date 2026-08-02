import { Option } from "effect"
import { describe, expect, it } from "vitest"
import type { SandboxEvent } from "../../packages/api/src/server/background/types"
import {
  buildOktaReconnectResumePrompt,
  getResumeSessionRejection,
  getResumableOktaReconnectTarget,
  isResumeStartedEvent,
  parseSandboxEventRow,
} from "../../packages/api/src/server/background/session/resume"
import type {
  EventRow,
  MessageRow,
  SessionRow,
} from "../../packages/api/src/server/background/session/types"

function createMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "message-1",
    author_id: "participant-1",
    content: "What pod is using the most CPU over the past 24 hours?",
    source: "web",
    model: "litellm/gpt-5.4-mini",
    reasoning_effort: "medium",
    execution_mode: "sync",
    attachments: null,
    callback_context: null,
    status: "failed",
    error_message: "Reconnect your configured OAuth account",
    created_at: 1,
    started_at: 2,
    completed_at: 3,
    ...overrides,
  }
}

function createSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "session-1",
    session_name: "session-1",
    session_kind: "isolate",
    title: "MCP Context Forge",
    repo_owner: "",
    repo_name: "",
    github_installation_id: null,
    github_repo_id: null,
    repo_default_branch: null,
    branch_name: null,
    tools_json: "[]",
    custom_mcp_json: "{}",
    isolate_step_limit: 8,
    model: "litellm/gpt-5.4-mini",
    reasoning_effort: "medium",
    status: "created",
    created_at: 1,
    updated_at: 1,
    ...overrides,
  }
}

describe("session resume helpers", () => {
  it("identifies terminal MCP Context Forge Okta reconnect failures as resumable", () => {
    const message = createMessage()
    const events: SandboxEvent[] = [
      {
        type: "mcp_discovery_error",
        serverName: "MCP Context Forge",
        error: "Reconnect your configured OAuth account to use MCP Context Forge tools.",
        terminal: true,
        discoveryReason: "oauth_reconnect_required",
        messageId: message.id,
        sandboxId: "session-1",
        timestamp: 1,
      },
    ]

    expect(Option.getOrNull(getResumableOktaReconnectTarget(message, events))?.message.id).toBe(
      message.id,
    )
    expect(
      Option.getOrNull(
        getResumableOktaReconnectTarget(createMessage({ status: "completed" }), events),
      ),
    ).toBeNull()
    expect(
      Option.getOrNull(
        getResumableOktaReconnectTarget(message, [
          {
            ...events[0]!,
            terminal: false,
          },
        ]),
      ),
    ).toBeNull()
    expect(
      Option.getOrNull(
        getResumableOktaReconnectTarget(message, [
          {
            ...events[0]!,
            discoveryReason: "server_unavailable",
            error: "Streamable HTTP error: upstream unavailable",
          },
        ]),
      ),
    ).toBeNull()
  })

  it("treats MCP Context Forge reconnect text as resumable when the typed reason is missing", () => {
    const message = createMessage()
    const events: SandboxEvent[] = [
      {
        type: "mcp_discovery_error",
        serverName: "MCP Context Forge",
        error: "Reconnect your configured OAuth account to use MCP Context Forge tools.",
        terminal: true,
        messageId: message.id,
        sandboxId: "session-1",
        timestamp: 1,
      },
    ]

    expect(Option.getOrNull(getResumableOktaReconnectTarget(message, events))?.message.id).toBe(
      message.id,
    )
    expect(
      Option.getOrNull(
        getResumableOktaReconnectTarget(message, [
          {
            ...events[0]!,
            discoveryReason: "server_unavailable",
          },
        ]),
      )?.message.id,
    ).toBe(message.id)
  })

  it("rejects non-isolate and archived sessions before resume", () => {
    expect(Option.getOrNull(getResumeSessionRejection(createSession()))).toBeNull()
    expect(
      Option.getOrThrow(getResumeSessionRejection(createSession({ status: "archived" }))),
    ).toContain("archived")
    expect(
      Option.getOrThrow(getResumeSessionRejection(createSession({ session_kind: "sandbox" }))),
    ).toContain("isolate")
  })

  it("builds a continuation prompt from durable assistant and tool context", () => {
    const message = createMessage()
    const target = getResumableOktaReconnectTarget(message, [
      {
        type: "token",
        content: "I found the Grafana datasource and need one more query.",
        messageId: message.id,
        sandboxId: "session-1",
        timestamp: 1,
      },
      {
        type: "tool_call",
        tool: "mcpcf_grafana_list_datasources",
        args: { query: "datasources" },
        callId: "call-complete",
        messageId: message.id,
        sandboxId: "session-1",
        timestamp: 2,
      },
      {
        type: "tool_result",
        callId: "call-complete",
        result: "Prometheus datasource uid prom-1",
        messageId: message.id,
        sandboxId: "session-1",
        timestamp: 3,
      },
      {
        type: "tool_call",
        tool: "mcpcf_grafana_query",
        args: { query: "topk(1, rate(container_cpu_usage_seconds_total[24h]))" },
        callId: "call-incomplete",
        messageId: message.id,
        sandboxId: "session-1",
        timestamp: 4,
      },
      {
        type: "mcp_discovery_error",
        serverName: "MCP Context Forge",
        error: "OAuth reconnect required",
        terminal: true,
        discoveryReason: "oauth_reconnect_required",
        messageId: message.id,
        sandboxId: "session-1",
        timestamp: 5,
      },
    ])

    expect(Option.isSome(target)).toBe(true)
    const prompt = buildOktaReconnectResumePrompt(Option.getOrThrow(target))

    expect(prompt).toContain(message.content)
    expect(prompt).toContain("I found the Grafana datasource")
    expect(prompt).toContain("Prometheus datasource uid prom-1")
    expect(prompt).toContain("status: completed")
    expect(prompt).toContain("status: incomplete")
    expect(prompt).toContain("OAuth reconnect required")
  })

  it("parses durable resume_started events for idempotent duplicate callbacks", () => {
    const row: EventRow = {
      id: "event-1",
      type: "resume_started",
      message_id: "message-2",
      data: JSON.stringify({
        type: "resume_started",
        messageId: "message-2",
        resumedFromMessageId: "message-1",
        reason: "okta_reconnect",
        summary: "Resuming after Okta authentication",
        sandboxId: "session-1",
        timestamp: 1,
      }),
      created_at: 1,
    }

    const event = Option.getOrThrow(parseSandboxEventRow(row))

    expect(isResumeStartedEvent(event)).toBe(true)
    expect(event).toMatchObject({
      messageId: "message-2",
      resumedFromMessageId: "message-1",
    })
  })
})
