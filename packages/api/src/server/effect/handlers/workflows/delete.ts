import * as Effect from "effect/Effect"
import { WorkflowLifecycle } from "../../../background/workflows/lifecycle"
import { json, runControlPlane } from "../shared/control-plane"
import { lifecycleFailure, requireWorkflowForUser } from "./shared"

export function deleteWorkflow({ params }: { params: { id: string } }) {
  return runControlPlane(
    Effect.fn("workflows.delete")(function* (context) {
      const { workflow } = yield* requireWorkflowForUser(context, params.id)
      yield* new WorkflowLifecycle(context.env)
        .archiveWorkflow({ workflow })
        .pipe(Effect.mapError(lifecycleFailure))
      return json({ status: "archived", workflowId: params.id })
    }),
  )
}
