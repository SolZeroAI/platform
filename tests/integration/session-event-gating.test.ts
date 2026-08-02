import { describe, expect, it } from "vitest"
import type { SandboxEvent } from "../../packages/api/src/server/background/types"
import {
  isStoppedByUserMessage,
  shouldProcessSandboxEventForMessage,
  STOPPED_BY_USER_ERROR,
} from "../../packages/api/src/server/background/session/event-gating"
import type { MessageRow } from "../../packages/api/src/server/background/session/types"

function createMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "message-1",
    author_id: "participant-1",
    content: "Investigate the alert",
    source: "web",
    model: "litellm/gpt-5.4-mini",
    reasoning_effort: "medium",
    execution_mode: "sync",
    attachments: null,
    callback_context: null,
    status: "processing",
    error_message: null,
    created_at: 1,
    started_at: 2,
    completed_at: null,
    ...overrides,
  }
}

function createToolCallEvent(overrides: Partial<SandboxEvent> = {}): SandboxEvent {
  return {
    type: "tool_call",
    tool: "grafana_query",
    args: { query: "up" },
    callId: "call-1",
    messageId: "message-1",
    sandboxId: "session-1",
    timestamp: 3,
    ...overrides,
  }
}

describe("session event gating", () => {
  it("processes runtime events while the message is still processing", () => {
    expect(
      shouldProcessSandboxEventForMessage({
        event: createToolCallEvent(),
        message: createMessage(),
      }),
    ).toBe(true)
  })

  it("drops late runtime events after the message was stopped by the user", () => {
    const stopped = createMessage({
      status: "failed",
      error_message: STOPPED_BY_USER_ERROR,
      completed_at: 4,
    })

    expect(isStoppedByUserMessage(stopped)).toBe(true)
    expect(
      shouldProcessSandboxEventForMessage({
        event: createToolCallEvent(),
        message: stopped,
      }),
    ).toBe(false)
    expect(
      shouldProcessSandboxEventForMessage({
        event: {
          type: "execution_complete",
          messageId: stopped.id,
          success: true,
          sandboxId: "session-1",
          timestamp: 5,
        },
        message: stopped,
      }),
    ).toBe(false)
  })

  it("allows events without message ids", () => {
    expect(
      shouldProcessSandboxEventForMessage({
        event: {
          type: "push_complete",
          branchName: "feature/test",
          timestamp: 1,
        },
        message: null,
      }),
    ).toBe(true)
  })
})
