import { describe, expect, it } from "vitest"
import {
  createCodingAgentRuntime,
  mapStreamPart,
} from "../../packages/agent-container/src/harness-runtime"
import { mapRuntimeEvent } from "../../packages/api/src/server/background/sandbox/providers/harness-container-provider"
import {
  CLOUDFLARE_AI_GATEWAY_TOP_UP_URL,
  CLOUDFLARE_WORKERS_AI_PRICING_DOCS_URL,
} from "../../packages/shared/src"

describe("AI SDK harness event mapping", () => {
  it("maps AI SDK text, reasoning, tool, and file-change parts", () => {
    expect(
      mapStreamPart({ type: "text-delta", id: "text-1", text: "hello" }, "message-1"),
    ).toMatchObject({
      type: "text-delta",
      id: "text-1",
      text: "hello",
    })
    expect(
      mapStreamPart({ type: "reasoning-delta", id: "reasoning-1", text: "think" }, "message-1"),
    ).toMatchObject({ type: "reasoning-delta", id: "reasoning-1", text: "think" })
    expect(
      mapStreamPart(
        {
          type: "tool-call",
          toolCallId: "file-1",
          toolName: "fileChange",
          input: { event: "modify", path: "src/index.ts" },
        },
        "message-1",
      ),
    ).toMatchObject({ type: "file-change", event: "modify", path: "src/index.ts" })
    expect(
      mapStreamPart(
        {
          type: "tool-result",
          toolCallId: "file-1",
          toolName: "fileChange",
          output: { event: "modify", path: "src/index.ts" },
        },
        "message-1",
      ),
    ).toBeNull()
  })

  it("turns tool errors, aborts, and error finish reasons into failures", () => {
    expect(
      mapStreamPart(
        { type: "tool-error", toolCallId: "tool-1", toolName: "search", error: "failed" },
        "message-1",
      ),
    ).toMatchObject({ type: "tool-result", isError: true, output: "failed" })
    expect(mapStreamPart({ type: "abort", reason: "stopped" }, "message-1")).toMatchObject({
      type: "error",
      error: "stopped",
    })
    expect(
      mapStreamPart(
        {
          type: "error",
          error: {
            name: "Error",
            message: "Claude Code process exited with code 1",
          },
        },
        "message-1",
      ),
    ).toMatchObject({
      type: "error",
      error: "Claude Code process exited with code 1",
    })
    expect(
      mapStreamPart(
        { type: "finish", finishReason: "error", rawFinishReason: "upstream_error" },
        "message-1",
      ),
    ).toMatchObject({ type: "finish", success: false, error: "upstream_error" })
  })

  it("turns session initialization failures into terminal runtime events", async () => {
    const runtime = createCodingAgentRuntime("codex")

    await expect(
      runtime.send({
        messageId: "message-1",
        sessionId: "session-1",
        content: "hello",
        model: {
          kind: "anthropic",
          providerId: "litellm-anthropic",
          modelId: "claude-sonnet-4-6",
          auth: {
            apiKey: "test-key",
            baseUrl: "https://litellm.example/anthropic",
          },
        },
      }),
    ).resolves.toBeUndefined()

    expect(runtime.poll(0).events).toEqual([
      expect.objectContaining({
        type: "error",
        error: "Codex harness requires an OpenAI Responses or LiteLLM model",
      }),
      expect.objectContaining({
        type: "finish",
        success: false,
        error: "Codex harness requires an OpenAI Responses or LiteLLM model",
      }),
    ])
  })

  it("maps deltas into the cumulative session event contract", () => {
    const state = {
      text: "",
      reasoningById: new Map<string, string>(),
    }
    const first = mapRuntimeEvent(
      {
        type: "text-delta",
        messageId: "message-1",
        id: "text-1",
        text: "hel",
        timestamp: 1_000,
      },
      "sandbox-1",
      state,
    )
    const second = mapRuntimeEvent(
      {
        type: "text-delta",
        messageId: "message-1",
        id: "text-1",
        text: "lo",
        timestamp: 2_000,
      },
      "sandbox-1",
      state,
    )
    const reasoning = mapRuntimeEvent(
      {
        type: "reasoning-delta",
        messageId: "message-1",
        id: "reasoning-1",
        text: "think",
        timestamp: 2_000,
      },
      "sandbox-1",
      state,
    )

    expect(first).toMatchObject({ type: "token", content: "hel" })
    expect(second).toMatchObject({ type: "token", content: "hello" })
    expect(reasoning).toMatchObject({
      type: "reasoning",
      content: "think",
      assistantMessageId: "reasoning-1",
    })
  })

  it("maps exhausted Workers AI allocation failures to an actionable session error", () => {
    const event = mapRuntimeEvent(
      {
        type: "error",
        messageId: "message-1",
        error: "3036: You have used up your daily free allocation of 10,000 neurons.",
        timestamp: 1_000,
      },
      "sandbox-1",
      { text: "", reasoningById: new Map() },
    )

    expect(event).toMatchObject({
      type: "error",
      error: expect.stringContaining(CLOUDFLARE_WORKERS_AI_PRICING_DOCS_URL),
    })
    expect(event?.type === "error" ? event.error : "").toContain(CLOUDFLARE_AI_GATEWAY_TOP_UP_URL)
  })
})
