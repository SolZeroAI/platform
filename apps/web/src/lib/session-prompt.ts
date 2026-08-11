import type { AgentRuntime, SessionKind } from "@solzero/shared"

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
  stream?: boolean
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

export async function submitSessionPrompt(input: SubmitSessionPromptInput): Promise<Response> {
  const searchParams = new URLSearchParams()
  if (input.stream) {
    searchParams.set("stream", "1")
  }

  const path =
    searchParams.size > 0
      ? `/api/sessions/${input.sessionId}/prompt?${searchParams.toString()}`
      : `/api/sessions/${input.sessionId}/prompt`

  return fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: input.content,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
    }),
  })
}

export async function submitSessionResume(input: SubmitSessionResumeInput): Promise<Response> {
  return fetch(`/api/sessions/${input.sessionId}/resume`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messageId: input.messageId,
      reason: input.reason,
    }),
  })
}
