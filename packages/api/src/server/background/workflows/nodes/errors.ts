import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

/**
 * Recoverable failure raised by workflow node executors (HTTP, storage, session, Slack,
 * notification). Carries a human-readable `message` so the runtime can surface it on the run while
 * keeping the Effect failure channel tagged for precise `catchTag` handling.
 */
export class WorkflowNodeError extends Schema.TaggedErrorClass<WorkflowNodeError>()(
  "WorkflowNodeError",
  {
    message: Schema.String,
  },
) {}

/** Fail the current node executor with a tagged {@link WorkflowNodeError}. */
export const workflowNodeFail = (message: string) => Effect.fail(new WorkflowNodeError({ message }))

/**
 * Guard helper that fails the current node executor with a {@link WorkflowNodeError} only when
 * `condition` holds, otherwise completes without effect. Replaces imperative validation guards while
 * keeping the failure on the tagged channel.
 */
export function workflowNodeFailWhen(condition: boolean, message: string) {
  const conditionEffect = Effect.succeed(condition)
  return workflowNodeFail(message).pipe(Effect.when(conditionEffect))
}
