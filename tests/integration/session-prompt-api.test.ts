import { describe, expect, it } from "vitest"
import {
  shouldUsePromptHttpStream,
  submitSessionPrompt,
  submitSessionResume,
} from "../../apps/web/src/lib/session-prompt"
import { mockFetchResponse } from "./fetch-test-helpers"

describe("session prompt API helper", () => {
  it("uses the streamed prompt API path when stream mode is requested", async () => {
    const fetchSpy = mockFetchResponse(
      new Response("partial response", {
        status: 200,
      }),
    )

    const response = await submitSessionPrompt({
      sessionId: "session-123",
      content: "hello",
      model: "litellm/gpt-5.4-mini",
      reasoningEffort: "medium",
      stream: true,
    })

    expect(response.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/sessions/session-123/prompt?stream=1",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      }),
    )
  })

  it("does not use the HTTP stream when the isolate websocket is connected", () => {
    expect(shouldUsePromptHttpStream({ sessionKind: "isolate", connected: true })).toBe(false)
  })

  it("uses the HTTP stream as an isolate fallback when the websocket is disconnected", () => {
    expect(shouldUsePromptHttpStream({ sessionKind: "isolate", connected: false })).toBe(true)
  })

  it("does not use the HTTP stream for sandbox sessions", () => {
    expect(shouldUsePromptHttpStream({ sessionKind: "sandbox", connected: false })).toBe(false)
  })

  it("posts resume requests to the session resume API", async () => {
    const fetchSpy = mockFetchResponse(
      Response.json({
        messageId: "message-456",
        resumedFromMessageId: "message-123",
        status: "queued",
        alreadyResuming: false,
      }),
    )

    const response = await submitSessionResume({
      sessionId: "session-123",
      messageId: "message-123",
      reason: "okta_reconnect",
    })

    expect(response.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/sessions/session-123/resume",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      }),
    )
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
      messageId: "message-123",
      reason: "okta_reconnect",
    })
  })
})
