import type { WorkflowNodeExecutionInput } from "./common"
import { workflowNodeFail } from "./errors"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"

export type WorkflowNotificationNodeExecutionInput = WorkflowNodeExecutionInput

const workflowNotificationNodeTypes = new Set(["email-notification"])

export function isWorkflowNotificationNodeType(nodeType: string): boolean {
  return workflowNotificationNodeTypes.has(nodeType)
}

export const executeWorkflowNotificationNode = Effect.fn("workflows.executeNotificationNode")(
  function* (input: WorkflowNotificationNodeExecutionInput) {
    return yield* Match.value(input.node.type).pipe(
      Match.when("email-notification", () =>
        workflowNodeFail("Email notifications are coming soon."),
      ),
      Match.orElse((nodeType) =>
        workflowNodeFail(`Unsupported workflow notification node '${nodeType}'`),
      ),
    )
  },
)
