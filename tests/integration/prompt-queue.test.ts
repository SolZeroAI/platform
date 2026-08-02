import { describe, expect, it } from "vitest"
import { BackgroundSessionsClient } from "../../apps/web/src/session-client"
import { mockFetchResponse } from "./fetch-test-helpers"

const TEST_API_KEY = `oiak_11111111_${"b".repeat(48)}`

describe("BackgroundSessionsClient", () => {
  it("authenticates direct control-plane requests with an API key and omits cookies", async () => {
    const fetchSpy = mockFetchResponse(
      new Response(JSON.stringify({ messageId: "m-1", status: "queued" }), {
        status: 200,
      }),
    )

    const client = new BackgroundSessionsClient({
      auth: { kind: "api-key", apiKey: `  ${TEST_API_KEY}  ` },
      baseUrl: "http://localhost:1337",
    })

    const result = await client.prompt("session-1", {
      content: "Fix failing tests",
      model: "litellm/gpt-5.4-mini",
      reasoningEffort: "high",
      attachments: [
        {
          type: "url",
          name: "logs",
          url: "https://example.com/logs",
        },
      ],
    })

    expect(result).toEqual({ messageId: "m-1", status: "queued" })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://localhost:1337/sessions/session-1/prompt")
    expect(init?.method).toBe("POST")
    expect(init?.credentials).toBe("omit")
    expect(headers.get("content-type")).toBe("application/json")
    expect(headers.get("x-api-key")).toBe(TEST_API_KEY)
    expect(headers.get("authorization")).toBeNull()
    const payload = JSON.parse(String(init?.body))
    expect(payload).toMatchObject({
      content: "Fix failing tests",
      model: "litellm/gpt-5.4-mini",
      reasoningEffort: "high",
    })
  })

  it("uses cookies without explicit credentials for same-origin browser sessions", async () => {
    const fetchSpy = mockFetchResponse(Response.json({ sessions: [], total: 0, hasMore: false }))
    const client = new BackgroundSessionsClient({
      auth: { kind: "browser-session" },
      baseUrl: "/api/",
    })

    await client.listSessions()

    const [, init] = fetchSpy.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/sessions?limit=50&offset=0")
    expect(init?.credentials).toBe("include")
    expect(headers.get("authorization")).toBeNull()
    expect(headers.get("x-api-key")).toBeNull()
  })

  it("rejects an empty API key before making a request", () => {
    expect(
      () =>
        new BackgroundSessionsClient({
          auth: { kind: "api-key", apiKey: "  " },
          baseUrl: "http://localhost:1337",
        }),
    ).toThrow("API key must not be empty")
  })
})
