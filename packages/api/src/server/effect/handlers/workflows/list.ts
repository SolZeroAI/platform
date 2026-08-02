import * as Effect from "effect/Effect"
import { getInfraServerUrl } from "@c0-agent/shared"
import { WorkflowStore } from "../../../background/db/workflows"
import { json, requirePrincipalUserId, runControlPlane } from "../shared/control-plane"
import { formatWorkflow, parseListNumber } from "./shared"

export function list({
  query,
}: {
  query: {
    limit?: string
    offset?: string
    q?: string
    sortBy?: string
    sortDir?: string
    status?: string
  }
}) {
  return runControlPlane(
    Effect.fn("workflows.list")(function* ({ request, env, db, principal }) {
      const userId = yield* requirePrincipalUserId(request, principal)
      const limit = parseListNumber(query.limit, 50, 100)
      const offset = parseListNumber(query.offset, 0, 10_000)
      const result = yield* new WorkflowStore(db).listWorkflows({
        userId,
        limit,
        offset,
        q: query.q,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
        status: query.status,
      })
      const serverUrl = getInfraServerUrl(env)
      return json({
        workflows: result.workflows.map((workflow) =>
          formatWorkflow(workflow, undefined, serverUrl),
        ),
        total: result.total,
        limit,
        offset,
        hasMore: result.hasMore,
      })
    }),
  )
}
