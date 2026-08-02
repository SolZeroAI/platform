import { describe, expect, it } from "vitest"

const runE2E = process.env.RUN_E2E === "1"
const testE2E = runE2E ? it : it.skip
const TEST_USER_ID = process.env.E2E_USER_ID ?? "user-session-run"
const TEST_MODEL = "litellm/gpt-5.4-mini"

function buildHeaders(): HeadersInit {
  const apiKey = process.env.C0_API_KEY?.trim()
  if (!apiKey) {
    throw new Error("C0_API_KEY must be set to run the OpenCode harness e2e test")
  }

  return {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  }
}

describe("opencode harness workflow (local e2e)", () => {
  testE2E(
    "creates session and handles multiple prompts in one session",
    { timeout: 420_000 },
    async () => {
      const baseUrl = process.env.BACKGROUND_BASE_URL ?? "http://localhost:1337"

      const createSession = await fetch(`${baseUrl}/sessions`, {
        method: "POST",
        headers: await buildHeaders(),
        body: JSON.stringify({
          title: "E2E smoke session",
          agentRuntime: "opencode",
          model: TEST_MODEL,
        }),
      })
      expect(createSession.ok).toBe(true)
      const created = (await createSession.json()) as {
        sessionId: string
        sessionKind?: string
        agentRuntime?: string
      }
      expect(created.sessionId).toBeTruthy()
      expect(created.sessionKind).toBe("sandbox")
      expect(created.agentRuntime).toBe("opencode")

      const pollEvents = async () => {
        const eventsResponse = await fetch(
          `${baseUrl}/sessions/${created.sessionId}/events?limit=200`,
          {
            headers: await buildHeaders(),
          },
        )
        expect(eventsResponse.ok).toBe(true)
        return (await eventsResponse.json()) as {
          events: Array<{
            messageId: string
            data: {
              type: string
              success?: boolean
              error?: string
            }
          }>
        }
      }

      const waitForSuccessfulExecution = async (messageId: string) => {
        const deadline = Date.now() + 300_000
        let sawToken = false
        let payload: Awaited<ReturnType<typeof pollEvents>> | null = null

        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 1_000))
          payload = await pollEvents()
          sawToken =
            sawToken ||
            payload.events.some(
              (event) => event.data.type === "token" && event.messageId === messageId,
            )

          const failedExecution = payload.events.find(
            (event) =>
              event.messageId === messageId &&
              ((event.data.type === "execution_complete" && event.data.success === false) ||
                event.data.type === "error"),
          )
          if (failedExecution) {
            throw new Error(failedExecution.data.error ?? "Prompt execution failed")
          }

          const successfulExecution = payload.events.some(
            (event) =>
              event.messageId === messageId &&
              event.data.type === "execution_complete" &&
              event.data.success === true,
          )
          if (successfulExecution) {
            return { sawToken, payload }
          }
        }

        throw new Error(`Timed out waiting for successful prompt execution: ${messageId}`)
      }

      const firstPrompt = await fetch(`${baseUrl}/sessions/${created.sessionId}/prompt`, {
        method: "POST",
        headers: await buildHeaders(),
        body: JSON.stringify({
          content: "Reply with exactly: sandbox smoke ok",
          authorId: TEST_USER_ID,
          source: "web",
        }),
      })
      expect(firstPrompt.ok).toBe(true)
      const firstPromptBody = (await firstPrompt.json()) as { messageId: string }
      expect(firstPromptBody.messageId).toBeTruthy()

      const firstResult = await waitForSuccessfulExecution(firstPromptBody.messageId)
      expect(firstResult.sawToken).toBe(true)
      expect(
        firstResult.payload?.events.some(
          (event) =>
            event.data.type === "execution_complete" &&
            event.data.success === false &&
            event.data.error?.includes("Session not found"),
        ) ?? false,
      ).toBe(false)

      const secondPrompt = await fetch(`${baseUrl}/sessions/${created.sessionId}/prompt`, {
        method: "POST",
        headers: await buildHeaders(),
        body: JSON.stringify({
          content: "Reply with exactly three words: sandbox reuse ok",
          authorId: TEST_USER_ID,
          source: "web",
        }),
      })
      expect(secondPrompt.ok).toBe(true)
      const secondPromptBody = (await secondPrompt.json()) as { messageId: string }
      expect(secondPromptBody.messageId).toBeTruthy()

      const secondResult = await waitForSuccessfulExecution(secondPromptBody.messageId)
      expect(secondResult.sawToken).toBe(true)
      expect(
        secondResult.payload?.events.some(
          (event) =>
            event.data.type === "execution_complete" &&
            event.data.success === false &&
            event.data.error?.includes("Session not found"),
        ) ?? false,
      ).toBe(false)
    },
  )
})
