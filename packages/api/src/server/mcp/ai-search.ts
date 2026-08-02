import { createMcpHandler } from "agents/mcp"
import * as Effect from "effect/Effect"
import { INTERNAL_AI_SEARCH_MCP_ROUTE } from "../background/session/mcp-config"
import type { Env } from "../background/types"
import { toError } from "../lib/effect-errors"
import {
  createAiSearchMcpServer,
  normalizeAiSearchMcpRequest,
  resolveAllowedAiSearchSources,
} from "./ai-search-server"
import type { AiSearchMcpRuntimeContext } from "./ai-search-runtime"

const handleAiSearchMcpRequestEffect = Effect.fn("mcp.aiSearch.handle")(function* (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  runtimeContext: AiSearchMcpRuntimeContext,
) {
  const normalized = normalizeAiSearchMcpRequest(request)
  const allowedSources = yield* Effect.tryPromise({
    try: () => resolveAllowedAiSearchSources(normalized, env),
    catch: toError,
  })
  const server = createAiSearchMcpServer(env, allowedSources, runtimeContext)
  return yield* Effect.tryPromise({
    try: () =>
      createMcpHandler(server, {
        route: INTERNAL_AI_SEARCH_MCP_ROUTE,
      })(normalized, env, ctx),
    catch: toError,
  })
})

export function handleAiSearchMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  runtimeContext: AiSearchMcpRuntimeContext,
): Promise<Response> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Worker entry boundary: apps/api index is non-Effect and runs this Effect at the Promise edge.
  return Effect.runPromise(handleAiSearchMcpRequestEffect(request, env, ctx, runtimeContext))
}
