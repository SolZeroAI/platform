import * as Effect from "effect/Effect"
import { runApi } from "@/lib/api-client"
import { toWorkflowSummary } from "./api"
import { workflowListQueryParams } from "./index-page"
import { WORKFLOW_DEFAULT_TABLE_STATE, type WorkflowSummary } from "./types"

/** The first workflow list page, and the workflow the URL opens. */
export interface WorkflowsRouteData {
  readonly workflows: WorkflowSummary[]
  readonly total: number
  readonly detail: WorkflowSummary | null
}

/** Loads the first list page with the default table state, and the workflow `workflowId` names. */
export async function loadWorkflowsRouteData(
  workflowId: string | undefined,
  signal: AbortSignal,
): Promise<WorkflowsRouteData> {
  const query = Object.fromEntries(workflowListQueryParams(WORKFLOW_DEFAULT_TABLE_STATE))

  const { list, detail } = await runApi(
    (client) =>
      Effect.all(
        {
          list: client.workflows.list({ query }),
          // The page loads a workflow that is missing here itself, and shows that failure in place.
          detail: workflowId
            ? client.workflows.get({ params: { id: workflowId } }).pipe(
                Effect.map((data) => toWorkflowSummary(data.workflow)),
                Effect.orElseSucceed(() => null),
              )
            : Effect.succeed(null),
        },
        { concurrency: "unbounded" },
      ),
    { signal, fallbackMessage: "Failed to load workflows" },
  )

  return { workflows: list.workflows.map(toWorkflowSummary), total: list.total, detail }
}
