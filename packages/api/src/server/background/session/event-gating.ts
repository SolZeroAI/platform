import type { SandboxEvent } from "../types"
import type { MessageRow } from "./types"

export const STOPPED_BY_USER_ERROR = "Stopped by user"

export function getSandboxEventMessageId(event: SandboxEvent): string | null {
  return typeof event.messageId === "string" && event.messageId.length > 0 ? event.messageId : null
}

export function isStoppedByUserMessage(message: MessageRow | null): boolean {
  return message?.status === "failed" && message.error_message === STOPPED_BY_USER_ERROR
}

export function shouldProcessSandboxEventForMessage(input: {
  event: SandboxEvent
  message: MessageRow | null
}): boolean {
  return !getSandboxEventMessageId(input.event) || input.message?.status === "processing"
}
