import { generateId } from "../../auth/crypto"
import { createWorkflowStoreFromD1 } from "../../db/workflows"
import { makeControlPlaneFromEnv } from "../../../effect/db/control-plane-db"
import { toError } from "../../../lib/effect-errors"
import type { WorkflowNodeExecutionInput } from "./common"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

export interface WorkflowNodeRunEvent {
  eventType: string
  level?: "info" | "warn" | "error"
  message: string
  data?: Record<string, unknown>
}

function identityEventData(input: WorkflowNodeExecutionInput): Record<string, string> {
  return Option.fromNullishOr(input.oktaUserId).pipe(
    Option.match({
      onNone: () => ({ userId: input.userId }),
      onSome: (oktaUserId) => ({ userId: input.userId, oktaUserId }),
    }),
  )
}

function logNodeRunEventError(
  input: WorkflowNodeExecutionInput,
  event: WorkflowNodeRunEvent,
  error: unknown,
) {
  const normalizedError = toError(error)
  input.log?.error(normalizedError, {
    workflowId: input.workflowId,
    runId: input.runId,
    nodeId: input.node.id,
    nodeType: input.node.type,
    eventType: event.eventType,
  })
  return normalizedError
}

export const recordWorkflowNodeRunEvent = Effect.fn("workflows.recordNodeRunEvent")(function* (
  input: WorkflowNodeExecutionInput,
  event: WorkflowNodeRunEvent,
) {
  yield* Effect.tryPromise({
    try: () =>
      createWorkflowStoreFromD1(makeControlPlaneFromEnv(input.env)).addRunEvent({
        id: `wfe_${generateId(12)}`,
        workflowId: input.workflowId,
        runId: input.runId,
        nodeId: input.node.id,
        eventType: event.eventType,
        level: event.level,
        message: event.message,
        data: {
          nodeType: input.node.type,
          ...event.data,
          ...identityEventData(input),
        },
        createdAt: Date.now(),
      }),
    catch: (error: unknown) => logNodeRunEventError(input, event, error),
  }).pipe(Effect.catch(() => Effect.void))
})
