import { afterEach, describe, expect, it, vi } from "vitest"
import { submitSessionPrompt } from "./session-prompt"

describe("submitSessionPrompt", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("preserves the selected runtime model in the prompt API payload", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal("fetch", fetchMock)

    await submitSessionPrompt({
      sessionId: "session-1",
      content: "Hello, what model are you?",
      model: "litellm/gpt-5.6-terra",
      reasoningEffort: "high",
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/session-1/prompt",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          content: "Hello, what model are you?",
          model: "litellm/gpt-5.6-terra",
          reasoningEffort: "high",
        }),
      }),
    )
  })
})
