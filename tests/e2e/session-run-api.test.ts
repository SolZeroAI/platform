import { describe, expect, it } from "vitest"

const runE2E = process.env.RUN_E2E === "1"
const testE2E = runE2E ? it : it.skip

const BASE_URL = process.env.BACKGROUND_BASE_URL ?? "http://localhost:1337"
const TEST_MODEL = "litellm/gpt-5.4-mini"
const TEST_PROMPT = "relevant operational runbooks for the coordinator"
const EMPTY_RESULT_PATTERNS = [
  /I couldn't retrieve any relevant documents/i,
  /No documents were retrieved/i,
  /unable to provide an answer based on the content of matched documents/i,
] as const

function getAiSearchTestSourceId(): string {
  const sourceId = process.env.AI_SEARCH_E2E_SOURCE_ID?.trim()
  if (!sourceId) {
    throw new Error("AI_SEARCH_E2E_SOURCE_ID must be set to run the session-run e2e test")
  }
  return sourceId
}

function buildHeaders(): HeadersInit {
  const apiKey = process.env.C0_API_KEY?.trim()
  if (!apiKey) {
    throw new Error("C0_API_KEY must be set to run the session-run e2e test")
  }

  return {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  expect(response.ok).toBe(true)
  return (await response.json()) as T
}

async function readResponseText(response: Response): Promise<string> {
  return response.text()
}

async function expectSessionRun(args: {
  headers: HeadersInit
  path: string
  expectedSessionKind: "isolate" | "sandbox"
  sessionKind?: "isolate" | "sandbox"
}): Promise<void> {
  const aiSearchTestSourceId = getAiSearchTestSourceId()
  const response = await fetch(`${BASE_URL}${args.path}`, {
    method: "POST",
    headers: args.headers,
    body: JSON.stringify({
      title: "Coordinator runbooks",
      content: TEST_PROMPT,
      sessionKind: args.sessionKind,
      tools: [
        {
          kind: "ai_search",
          sourceId: aiSearchTestSourceId,
        },
      ],
      model: TEST_MODEL,
    }),
  })

  const responseText = await response.text()
  if (response.status !== 200) {
    throw new Error(`Expected 200 from ${args.path}, received ${response.status}: ${responseText}`)
  }
  const result = JSON.parse(responseText) as {
    sessionId: string
    sessionKind: "isolate" | "sandbox"
    createdSession: boolean
    messageId: string
    status: string
    output: string | null
    error?: string
  }

  expect(result.createdSession).toBe(true)
  expect(result.sessionId).toBeTruthy()
  expect(result.sessionKind).toBe(args.expectedSessionKind)
  expect(result.messageId).toBeTruthy()
  expect(result.status).toBe("completed")
  expect(result.output).toBeTruthy()
  expect(result.error).toBeUndefined()
  expect(result.output ?? "").toContain("Coordinator")
  for (const pattern of EMPTY_RESULT_PATTERNS) {
    expect(result.output ?? "").not.toMatch(pattern)
  }

  const state = await fetchJson<{
    sessionKind: "isolate" | "sandbox"
    tools?: Array<{ kind: string; sourceId?: string }>
    sandbox?: { status?: string | null } | null
  }>(`${BASE_URL}/sessions/${result.sessionId}`, {
    headers: args.headers,
  })

  expect(state.sessionKind).toBe(args.expectedSessionKind)
  expect(state.tools).toEqual([
    {
      kind: "ai_search",
      sourceId: aiSearchTestSourceId,
    },
  ])
  expect(state.sandbox?.status).toBe("ready")

  const eventsPayload = await fetchJson<{
    events: Array<{
      data: {
        type: string
        tool?: string
        success?: boolean
      }
    }>
  }>(`${BASE_URL}/sessions/${result.sessionId}/events?limit=200`, {
    headers: args.headers,
  })

  expect(eventsPayload.events.some((event) => event.data.type === "token")).toBe(true)
  expect(
    eventsPayload.events.some(
      (event) => event.data.type === "execution_complete" && event.data.success === true,
    ),
  ).toBe(true)
}

describe("session run API (local e2e)", () => {
  testE2E("defaults the base run route to isolate sessions", { timeout: 240_000 }, async () => {
    const headers = buildHeaders()
    await expectSessionRun({
      headers,
      path: "/sessions/run",
      expectedSessionKind: "isolate",
    })
  })

  testE2E("supports explicit sandbox run sessions", { timeout: 240_000 }, async () => {
    const headers = buildHeaders()
    await expectSessionRun({
      headers,
      path: "/sessions/run",
      expectedSessionKind: "sandbox",
      sessionKind: "sandbox",
    })
  })

  testE2E("streams isolate responses and persists tool events", { timeout: 240_000 }, async () => {
    const headers = buildHeaders()
    const aiSearchTestSourceId = getAiSearchTestSourceId()
    const response = await fetch(`${BASE_URL}/sessions/run?stream=1`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Streamed isolate docs run",
        content:
          "Use the docs_search tool exactly once, then answer briefly: what should I check first for a coordinator issue?",
        tools: [
          {
            kind: "ai_search",
            sourceId: aiSearchTestSourceId,
          },
        ],
        model: TEST_MODEL,
      }),
    })

    const output = await readResponseText(response)
    if (response.status !== 200) {
      throw new Error(
        `Expected 200 from /sessions/run?stream=1, received ${response.status}: ${output}`,
      )
    }

    const sessionId = response.headers.get("x-session-id")
    expect(sessionId).toBeTruthy()
    expect(response.headers.get("x-session-kind")).toBe("isolate")
    expect(output).toBeTruthy()
    expect(output).not.toContain("Isolate sessions are ready for lightweight docs")

    const eventsPayload = await fetchJson<{
      events: Array<{
        data: {
          type: string
          tool?: string
          success?: boolean
        }
      }>
    }>(`${BASE_URL}/sessions/${sessionId}/events?limit=200`, {
      headers,
    })

    expect(eventsPayload.events.some((event) => event.data.type === "tool_call")).toBe(true)
    expect(eventsPayload.events.some((event) => event.data.type === "tool_result")).toBe(true)
    expect(eventsPayload.events.some((event) => event.data.type === "token")).toBe(true)
    expect(
      eventsPayload.events.some(
        (event) => event.data.type === "execution_complete" && event.data.success === true,
      ),
    ).toBe(true)
  })
})
