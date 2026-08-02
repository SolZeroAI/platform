import type { AgentToolEventMessage } from "agents"
import * as Option from "effect/Option"
import type { Env } from "../../types"

interface SessionSubagentEventStub {
  persistIsolateSubagentToolEvent(
    messageId: string,
    message: AgentToolEventMessage,
    lifecycleTimestampMs?: number,
  ): Promise<void>
}

export function persistSubagentToolEventToSession(
  env: Env,
  sessionId: string,
  messageId: string,
  message: AgentToolEventMessage,
  lifecycleTimestampMs?: number,
): Promise<void> {
  const namespace = Option.getOrThrowWith(
    Option.fromNullishOr(env.SESSION),
    () => new Error("SESSION binding is required for durable sub-agent event relay"),
  )
  // oxlint-disable-next-line effect/avoid-any -- DurableObjectStub<unknown> carries no RPC surface; importing SessionDO here would create a session<->isolate module cycle.
  const stub = namespace.get(namespace.idFromName(sessionId)) as unknown as SessionSubagentEventStub
  return stub.persistIsolateSubagentToolEvent(messageId, message, lifecycleTimestampMs)
}
