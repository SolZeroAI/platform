import type { AgentToolEventMessage } from "agents"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type { Env } from "../../types"
import {
  claimSubagentDispatch,
  clearSubagentDispatch,
  type ClaimedSubagentDispatch,
} from "./subagent-dispatch-state"
import { persistSubagentToolEventToSession } from "./subagent-session-relay"
import type { IsolateSessionAgentState } from "./types"

export interface SubagentStateHost {
  readonly state: IsolateSessionAgentState
  getEnv(): Env
  getRuntimeId(): string
  setState(state: IsolateSessionAgentState): void
}

export function claimHostSubagentRun(
  host: SubagentStateHost,
  messageId: string,
  runId: string,
): Option.Option<number> {
  return claimSubagentDispatch(host.state.subagentDispatch, messageId, runId).pipe(
    Option.map((claim) => applySubagentClaim(host, claim)),
  )
}

function applySubagentClaim(host: SubagentStateHost, claim: ClaimedSubagentDispatch): number {
  Match.value(claim.changed).pipe(
    Match.when(true, () => host.setState({ ...host.state, subagentDispatch: claim.state })),
    Match.orElse(() => undefined),
  )
  return claim.order
}

export function completeHostSubagentTurn(host: SubagentStateHost, messageId: string): void {
  host.setState({
    ...host.state,
    subagentDispatch: Option.getOrUndefined(
      clearSubagentDispatch(host.state.subagentDispatch, messageId),
    ),
  })
}

export function persistHostSubagentEvent(
  host: SubagentStateHost,
  messageId: string,
  message: AgentToolEventMessage,
  lifecycleTimestampMs?: number,
): Promise<void> {
  return persistSubagentToolEventToSession(
    host.getEnv(),
    host.state.sessionId || host.getRuntimeId(),
    messageId,
    message,
    lifecycleTimestampMs,
  )
}
