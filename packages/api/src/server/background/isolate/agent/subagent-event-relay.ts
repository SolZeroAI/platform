import type { StreamCallback } from "@cloudflare/think"
import type { AgentToolEventMessage, RunAgentToolResult } from "agents"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { stringifyJson } from "../../../lib/json"

export interface OrderedSubagentEventRelayTarget {
  getCallback(message: AgentToolEventMessage): Option.Option<StreamCallback>
  resolveMessageId(message: AgentToolEventMessage): Option.Option<string>
  persist(
    messageId: string,
    message: AgentToolEventMessage,
    lifecycleTimestampMs?: number,
  ): Promise<void>
  onCallbackFailure(cause: unknown, message: AgentToolEventMessage): void
  onRelayFailure(cause: unknown, message: AgentToolEventMessage): void
}

/**
 * Serializes the app-level relay independently from the SDK's own broadcast.
 * The prompt callback remains primary; direct SessionDO persistence is used
 * only when that callback is unavailable or rejects.
 */
export class OrderedSubagentEventRelay {
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly target: OrderedSubagentEventRelayTarget) {}

  enqueue(message: AgentToolEventMessage): void {
    this.tail = this.tail
      .then(() => this.deliver(message))
      .catch((cause) => this.target.onRelayFailure(cause, message))
  }

  flush(): Promise<void> {
    return this.tail
  }

  /**
   * Persist an SDK lifecycle frame before its best-effort broadcast relay.
   * Hooks use this path because the run registry owns the authoritative
   * started/completed timestamps while wire frames intentionally omit them.
   */
  persistLifecycle(message: AgentToolEventMessage, lifecycleTimestampMs: number): Promise<void> {
    return this.persist(message, lifecycleTimestampMs)
  }

  reset(): void {
    this.tail = Promise.resolve()
  }

  private deliver(message: AgentToolEventMessage): Promise<void> {
    return Option.match(this.target.getCallback(message), {
      onNone: () => this.persist(message),
      onSome: (callback) =>
        Promise.resolve()
          .then(() => callback.onEvent(stringifyJson(message)))
          .catch((cause) => this.fallbackAfterCallback(cause, message)),
    })
  }

  private fallbackAfterCallback(cause: unknown, message: AgentToolEventMessage): Promise<void> {
    this.target.onCallbackFailure(cause, message)
    return this.persist(message)
  }

  private persist(message: AgentToolEventMessage, lifecycleTimestampMs?: number): Promise<void> {
    return Option.match(this.target.resolveMessageId(message), {
      onNone: () =>
        Promise.reject(new Error("Unable to resolve a parent message for sub-agent event")),
      onSome: (messageId) =>
        Option.match(Option.fromNullishOr(lifecycleTimestampMs), {
          onNone: () => this.target.persist(messageId, message),
          onSome: (timestamp) => this.target.persist(messageId, message, timestamp),
        }),
    })
  }
}

export function cancelInterruptedSubagentStillRunning<Output>(
  runId: string,
  result: RunAgentToolResult<Output>,
  cancel: (runId: string, reason: string) => Promise<void>,
): Promise<RunAgentToolResult<Output>> {
  return Match.value(result).pipe(
    Match.when({ status: "interrupted", childStillRunning: true }, () =>
      cancelAndReturnInterrupted(runId, result, cancel),
    ),
    Match.orElse((terminal) => Promise.resolve(terminal)),
  )
}

async function cancelAndReturnInterrupted<Output>(
  runId: string,
  result: RunAgentToolResult<Output>,
  cancel: (runId: string, reason: string) => Promise<void>,
): Promise<RunAgentToolResult<Output>> {
  await cancel(runId, "Awaited Isolate sub-agent was interrupted while still running")
  return result
}
