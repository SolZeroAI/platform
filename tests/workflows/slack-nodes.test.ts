import * as Effect from "effect/Effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { executeWorkflowSlackNode } from "../../packages/api/src/server/background/workflows/nodes/slack"
import type { Env } from "../../packages/api/src/server/background/types"

const resolveWorkflowSlackBotToken = vi.fn()

vi.mock("../../packages/api/src/server/background/workflows/slack-apps", () => ({
  resolveWorkflowSlackBotToken: (...args: unknown[]) => resolveWorkflowSlackBotToken(...args),
}))

function slackNodeInput(overrides: Partial<Parameters<typeof executeWorkflowSlackNode>[0]> = {}) {
  return {
    env: {} as Env,
    workflowId: "wf_1",
    runId: "wfr_1",
    node: {
      id: "send",
      type: "slack-send-message",
      label: "Send Slack",
      options: {
        channel: "C1",
        text: "hello {{inputs.name}}",
        threadTs: "",
      },
    },
    inputs: { name: "incident" },
    trigger: { kind: "slack" as const, payload: {} },
    userId: "user_1",
    ...overrides,
  }
}

describe("workflow Slack nodes", () => {
  beforeEach(() => {
    resolveWorkflowSlackBotToken.mockReset()
    resolveWorkflowSlackBotToken.mockReturnValue(Effect.succeed("xoxb-token"))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("posts Slack messages with the workflow app bot token by default", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, channel: "C1", ts: "123.456", message: { text: "ok" } }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await Effect.runPromise(executeWorkflowSlackNode(slackNodeInput()))

    expect(resolveWorkflowSlackBotToken).toHaveBeenCalledWith({
      env: {},
      workflowId: "wf_1",
      token: null,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer xoxb-token",
        }),
      }),
    )
    expect(result).toEqual({
      outputs: {
        ok: true,
        channel: "C1",
        ts: "123.456",
        message: { text: "ok" },
      },
    })
  })

  it("falls back to env.SLACK_TOKEN when no token is provided and no workflow app token resolves", async () => {
    resolveWorkflowSlackBotToken.mockReturnValue(Effect.fail(new Error("missing workflow app")))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, channel: "C1", ts: "123.456" }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await Effect.runPromise(
      executeWorkflowSlackNode(
        slackNodeInput({
          env: { SLACK_TOKEN: "xoxb-env" } as Env,
        }),
      ),
    )

    expect(resolveWorkflowSlackBotToken).toHaveBeenCalledWith({
      env: { SLACK_TOKEN: "xoxb-env" },
      workflowId: "wf_1",
      token: null,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer xoxb-env",
        }),
      }),
    )
    expect(result).toEqual({
      outputs: {
        ok: true,
        channel: "C1",
        ts: "123.456",
        message: null,
      },
    })
  })

  it("returns an empty thread context when channel or thread timestamp is missing", async () => {
    const result = await Effect.runPromise(
      executeWorkflowSlackNode(
        slackNodeInput({
          node: {
            id: "fetch",
            type: "slack-fetch-thread",
            label: "Fetch Slack thread",
            options: { channel: "C1", threadTs: "" },
          },
          inputs: {},
        }),
      ),
    )

    expect(result).toEqual({
      outputs: {
        ok: false,
        channel: "C1",
        threadTs: null,
        messages: [],
        text: "",
      },
    })
  })

  it("fetches Slack thread replies with query parameters", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { user: "U1", text: "What is happening?" },
          { bot_id: "B1", text: "Looking into it." },
        ],
      }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await Effect.runPromise(
      executeWorkflowSlackNode(
        slackNodeInput({
          node: {
            id: "fetch",
            type: "slack-fetch-thread",
            label: "Fetch Slack thread",
            options: {},
          },
          inputs: { channel: "C1", threadTs: "123.456", limit: 2 },
        }),
      ),
    )

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe(
      "https://slack.com/api/conversations.replies?channel=C1&ts=123.456&limit=2&inclusive=true",
    )
    expect(init).toMatchObject({
      method: "GET",
      headers: {
        Authorization: "Bearer xoxb-token",
      },
    })
    expect(result).toEqual({
      outputs: {
        ok: true,
        channel: "C1",
        threadTs: "123.456",
        messages: [
          { user: "U1", text: "What is happening?" },
          { bot_id: "B1", text: "Looking into it." },
        ],
        text: "- U1: What is happening?\n- B1: Looking into it.",
      },
    })
  })

  it("removes Slack reactions from messages", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await Effect.runPromise(
      executeWorkflowSlackNode(
        slackNodeInput({
          node: {
            id: "remove",
            type: "slack-remove-reaction",
            label: "Remove reaction",
            options: { channel: "C1", timestamp: "123.456", name: ":c0-thinking:" },
          },
          inputs: {},
        }),
      ),
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/reactions.remove",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer xoxb-token",
        }),
        body: JSON.stringify({ channel: "C1", timestamp: "123.456", name: "c0-thinking" }),
      }),
    )
    expect(result).toEqual({
      outputs: {
        ok: true,
        channel: "C1",
        ts: "123.456",
        name: "c0-thinking",
      },
    })
  })

  it("surfaces Slack API failures without exposing tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: false, error: "channel_not_found" }),
      })),
    )

    await expect(Effect.runPromise(executeWorkflowSlackNode(slackNodeInput()))).rejects.toThrow(
      "Slack API chat.postMessage failed: channel_not_found",
    )
  })
})
