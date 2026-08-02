import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { Effect } from "effect"
import { makeC0ApiClient } from "../../packages/api/src/client"

const textDecoder = new TextDecoder()
let fetchHandler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function getFetchUrl(call: [input: RequestInfo | URL, init?: RequestInit]): string {
  return String(call[0])
}

function getFetchInit(call: [input: RequestInfo | URL, init?: RequestInit]): RequestInit {
  return call[1] ?? {}
}

function decodeFetchBody(body: BodyInit | null | undefined): unknown {
  if (body instanceof Uint8Array) {
    return JSON.parse(textDecoder.decode(body)) as unknown
  }
  if (typeof body === "string") {
    return JSON.parse(body) as unknown
  }
  throw new Error("Expected JSON request body")
}

describe("Slack API client", () => {
  beforeAll(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => fetchHandler(input, init))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  async function createClient() {
    return Effect.runPromise(
      makeC0ApiClient({
        baseUrl: "http://localhost:1337/",
        bearerToken: "oiak_test_user-secret",
      }),
    )
  }

  it("queues a Slack prompt through the /slack API group", async () => {
    fetchHandler = async () => {
      return new Response(
        JSON.stringify({
          session: {
            sessionId: "session-123",
            sessionKind: "isolate",
            agentRuntime: "isolate",
            status: "created",
          },
          prompt: {
            messageId: "message-456",
            status: "queued",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    const fetchSpy = vi.mocked(globalThis.fetch)

    const callbackContext = {
      channel: "C123",
      threadTs: "1710000000.000100",
      repoFullName: "example-org/c0",
      model: "litellm/gpt-5.4-mini",
    }
    const client = await createClient()

    const result = await Effect.runPromise(
      client.slack.queuePrompt({
        payload: {
          session: {
            slackUserId: "U123",
            title: "Slack request",
            sessionKind: "isolate",
            model: "litellm/gpt-5.4-mini",
          },
          prompt: {
            content: "Fix the failing tests",
            model: "litellm/gpt-5.4-mini",
            callbackContext,
          },
        },
      }),
    )

    expect(result).toEqual({
      session: {
        sessionId: "session-123",
        sessionKind: "isolate",
        agentRuntime: "isolate",
        status: "created",
      },
      prompt: {
        messageId: "message-456",
        status: "queued",
      },
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const queueCall = fetchSpy.mock.calls[0]!
    const queueInit = getFetchInit(queueCall)

    expect(getFetchUrl(queueCall)).toBe("http://localhost:1337/slack/sessions/queue")
    expect(queueInit.method).toBe("POST")
    expect(queueInit.headers).toMatchObject({
      "content-type": "application/json",
      authorization: expect.any(String),
    })

    expect(decodeFetchBody(queueInit.body)).toMatchObject({
      session: {
        slackUserId: "U123",
        sessionKind: "isolate",
      },
      prompt: {
        content: "Fix the failing tests",
        callbackContext,
      },
    })
  })

  it("decodes Slack setup links from the /slack create-session endpoint", async () => {
    fetchHandler = async () => {
      return new Response(
        JSON.stringify({
          error: "Slack user is not linked to a c0 account",
          setupUrl: "http://localhost:3000/settings?slackUserId=U123",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      )
    }
    const fetchSpy = vi.mocked(globalThis.fetch)
    const client = await createClient()

    await expect(
      Effect.runPromise(
        client.slack.createSession({
          payload: {
            slackUserId: "U123",
            sessionKind: "isolate",
          },
        }),
      ),
    ).rejects.toMatchObject({
      error: "Slack user is not linked to a c0 account",
      setupUrl: "http://localhost:3000/settings?slackUserId=U123",
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(getFetchUrl(fetchSpy.mock.calls[0]!)).toBe("http://localhost:1337/slack/sessions")
  })

  it("runs the Slack session API with the API-key principal", async () => {
    fetchHandler = async () => {
      return new Response(
        JSON.stringify({
          sessionId: "session-789",
          sessionKind: "isolate",
          agentRuntime: "isolate",
          createdSession: true,
          messageId: "message-789",
          status: "completed",
          output: "Done",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    const fetchSpy = vi.mocked(globalThis.fetch)
    const client = await createClient()

    const result = await Effect.runPromise(
      client.slack.run({
        payload: {
          content: "Summarize this thread",
          sessionKind: "isolate",
          model: "litellm/gpt-5.4-mini",
        },
      }),
    )

    expect(result).toMatchObject({
      sessionId: "session-789",
      messageId: "message-789",
      status: "completed",
      output: "Done",
    })
    const runCall = fetchSpy.mock.calls[0]!
    const init = getFetchInit(runCall)
    expect(getFetchUrl(runCall)).toBe("http://localhost:1337/slack/sessions/run")
    expect(init.method).toBe("POST")
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      authorization: expect.any(String),
    })
    expect(new Headers(init.headers).has("x-user-id")).toBe(false)
    expect(decodeFetchBody(init.body)).toMatchObject({
      content: "Summarize this thread",
      sessionKind: "isolate",
      model: "litellm/gpt-5.4-mini",
    })
  })
})
