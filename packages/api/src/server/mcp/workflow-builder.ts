import { createMcpHandler } from "agents/mcp"
import * as Effect from "effect/Effect"
import { INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE } from "../background/session/mcp-config"
import type { Env } from "../background/types"
import { toError } from "../lib/effect-errors"
import {
  createWorkflowBuilderMcpServer,
  normalizeWorkflowBuilderMcpRequest,
  resolveWorkflowBuilderContext,
} from "./workflow-builder/server"

const handleWorkflowBuilderMcpRequestEffect = Effect.fn("mcp.workflowBuilder.handle")(function* (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) {
  const normalized = normalizeWorkflowBuilderMcpRequest(request)
  const context = yield* Effect.tryPromise({
    try: () => resolveWorkflowBuilderContext(normalized, env),
    catch: toError,
  })
  const server = createWorkflowBuilderMcpServer(context)
  return yield* Effect.tryPromise({
    try: () =>
      createMcpHandler(server, {
        route: INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE,
      })(normalized, env, ctx),
    catch: toError,
  })
})

export function handleWorkflowBuilderMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Worker entry boundary: apps/api index is non-Effect and runs this Effect at the Promise edge.
  return Effect.runPromise(handleWorkflowBuilderMcpRequestEffect(request, env, ctx))
}
