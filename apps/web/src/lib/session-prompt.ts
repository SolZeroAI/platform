import type { PromptPayload } from "@solzero/api"
import type { AgentRuntime, SessionKind } from "@solzero/shared"
import { runApi } from "@/lib/api-client"

const fallbackPromptErrors = new Map<string, string>()

function promptErrorStorageKey(sessionId: string): string {
  return `s0-prompt-error-${sessionId}`
}

function takeFallbackPromptError(key: string): string | null {
  const fallbackMsg = fallbackPromptErrors.get(key) ?? null

  if (fallbackMsg) {
    fallbackPromptErrors.delete(key)
  }

  return fallbackMsg
}

export function stashSessionPromptError(sessionId: string, message: string): void {
  const key = promptErrorStorageKey(sessionId)

  try {
    sessionStorage.setItem(key, message)
    fallbackPromptErrors.delete(key)
  } catch {
    fallbackPromptErrors.set(key, message)
  }
}

export function takeSessionPromptError(sessionId: string): string | null {
  const key = promptErrorStorageKey(sessionId)

  try {
    const msg = sessionStorage.getItem(key)

    if (msg) {
      sessionStorage.removeItem(key)

      return msg
    }
  } catch {
    return takeFallbackPromptError(key)
  }

  return takeFallbackPromptError(key)
}

export interface SubmitSessionPromptInput {
  sessionId: string
  content: string
  model?: string
  reasoningEffort?: string
}

export interface SubmitSessionResumeInput {
  sessionId: string
  messageId?: string
  reason: "okta_reconnect"
}

export function shouldUsePromptHttpStream(input: {
  agentRuntime?: AgentRuntime | null
  sessionKind?: SessionKind | null
  connected: boolean
}): boolean {
  return (input.agentRuntime === "isolate" || input.sessionKind === "isolate") && !input.connected
}

/** The prompt payload while its optional keys are set. */
interface PromptPayloadDraft {
  content: string
  model?: string
  reasoningEffort?: string
}

function promptPayload(input: SubmitSessionPromptInput): PromptPayload {
  const payload: PromptPayloadDraft = { content: input.content }

  if (input.model !== undefined) payload.model = input.model

  if (input.reasoningEffort !== undefined) payload.reasoningEffort = input.reasoningEffort

  return payload
}

/** Queues a prompt. The reply arrives on the session socket. */
export function submitSessionPrompt(input: SubmitSessionPromptInput) {
  return runApi(
    (client) =>
      client.sessions.prompt({ params: { id: input.sessionId }, payload: promptPayload(input) }),
    { fallbackMessage: "Failed to send prompt" },
  )
}

/**
 * Runs an isolate prompt and streams the reply text in the response body. `S0Api` declares only
 * the queued JSON reply, so this request stays on `fetch`.
 */
export function streamSessionPrompt(input: SubmitSessionPromptInput): Promise<Response> {
  return fetch(`/api/sessions/${input.sessionId}/prompt?stream=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(promptPayload(input)),
  })
}

export function submitSessionResume(input: SubmitSessionResumeInput) {
  return runApi(
    (client) =>
      client.sessions.resume({
        params: { id: input.sessionId },
        payload:
          input.messageId === undefined
            ? { reason: input.reason }
            : { messageId: input.messageId, reason: input.reason },
      }),
    {
      fallbackMessage: "Okta authentication completed, but no resumable failed request was found.",
    },
  )
}
