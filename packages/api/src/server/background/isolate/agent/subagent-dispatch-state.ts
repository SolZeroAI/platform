import * as Match from "effect/Match"
import * as Option from "effect/Option"

export const MAX_SUBAGENT_RUNS_PER_TURN = 8

export interface SubagentDispatchState {
  messageId: string
  count: number
  runIds: string[]
}

export interface ClaimedSubagentDispatch {
  state: SubagentDispatchState
  order: number
  changed: boolean
}

export function claimSubagentDispatch(
  current: SubagentDispatchState | undefined,
  messageId: string,
  runId: string,
  limit = MAX_SUBAGENT_RUNS_PER_TURN,
): Option.Option<ClaimedSubagentDispatch> {
  const active = Option.getOrElse(
    Option.fromNullishOr(current).pipe(
      Option.filter((dispatch) => dispatch.messageId === messageId),
    ),
    (): SubagentDispatchState => ({ messageId, count: 0, runIds: [] }),
  )
  const existingIndex = active.runIds.indexOf(runId)

  return Match.value(existingIndex >= 0).pipe(
    Match.when(true, () =>
      Option.some({ state: active, order: existingIndex + 1, changed: false }),
    ),
    Match.orElse(() =>
      Match.value(active.count >= limit).pipe(
        Match.when(true, () => Option.none()),
        Match.orElse(() => Option.some(createSubagentDispatch(active, messageId, runId))),
      ),
    ),
  )
}

export function clearSubagentDispatch(
  current: SubagentDispatchState | undefined,
  messageId: string,
): Option.Option<SubagentDispatchState> {
  return Option.fromNullishOr(current).pipe(
    Option.filter((dispatch) => dispatch.messageId !== messageId),
  )
}

export function resolveSubagentMessageId(
  runId: string,
  current: SubagentDispatchState | undefined,
  activeMessageId?: string,
): Option.Option<string> {
  const claimedMessage = Option.fromNullishOr(current).pipe(
    Option.filter((dispatch) => dispatch.runIds.includes(runId)),
    Option.map((dispatch) => dispatch.messageId),
  )
  const activeMessage = Option.fromNullishOr(activeMessageId).pipe(
    Option.filter((messageId) => runId.startsWith(`${messageId}:`)),
  )
  const separator = runId.indexOf(":")
  const encodedMessage = Option.liftPredicate(separator, (index) => index > 0).pipe(
    Option.map((index) => runId.slice(0, index)),
  )
  return Option.orElse(claimedMessage, () => Option.orElse(activeMessage, () => encodedMessage))
}

function createSubagentDispatch(
  active: SubagentDispatchState,
  messageId: string,
  runId: string,
): ClaimedSubagentDispatch {
  const runIds = [...active.runIds, runId]
  return {
    state: { messageId, count: runIds.length, runIds },
    order: runIds.length,
    changed: true,
  }
}
