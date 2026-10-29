import type { AgentToolEventMessage } from "agents"
import * as Option from "effect/Option"
import type { Env } from "../../types"

// The session Durable Object's RPC surface used here. Importing SessionDO would create a
// session<->isolate module cycle.
interface SessionSubagentEventTarget extends Rpc.DurableObjectBranded {
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

  /* SAFETY: env.SESSION is the SessionDO namespace binding, and SessionDO implements persistIsolateSubagentToolEvent. */
  const sessions = namespace as DurableObjectNamespace<SessionSubagentEventTarget>

  const stub = sessions.get(sessions.idFromName(sessionId))

  return stub.persistIsolateSubagentToolEvent(messageId, message, lifecycleTimestampMs)
}
