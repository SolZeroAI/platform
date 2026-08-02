import { createMcpHandler } from "agents/mcp"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import { verifyMcpcfProxyCapabilityRequest } from "../background/auth/mcpcf-capability"
import {
  MCPCF_PROXY_MCP_ROUTE,
  MCPCF_SERVER_HEADER,
  parseAllowedMcpcfServers,
} from "../background/session/mcp-config"
import type { Env } from "../background/types"
import { createJsonRpcErrorResponse } from "./json-rpc-error"
import {
  createMcpcfMcpServer,
  normalizeMcpcfMcpRequest,
  redactMcpcfErrorMessage,
  resolveMcpcfMcpContext,
  type McpcfMcpContext,
  type McpcfMcpRuntimeContext,
} from "./mcpcf-server"

function isOAuthReconnectError(error: Error): boolean {
  return (
    error.name === "LinkedOAuthReconnectRequiredError" ||
    error.name === "OktaAccountReconnectRequiredError" ||
    error.message.includes("Reconnect your configured OAuth account") ||
    error.message.includes("Reconnect Okta")
  )
}

const toError = (cause: unknown): Error =>
  Match.value(cause).pipe(
    Match.when(Match.instanceOf(Error), (error) => error),
    Match.orElse((other) => new Error(String(other))),
  )

const runMcpcfMcpHandler = Effect.fn("mcp.mcpcf.run")(function* (
  context: McpcfMcpContext,
  normalized: Request,
  env: Env,
  ctx: ExecutionContext,
) {
  const server = createMcpcfMcpServer(context)
  return yield* Effect.tryPromise(() =>
    createMcpHandler(server, {
      route: MCPCF_PROXY_MCP_ROUTE,
    })(normalized, env, ctx),
  )
})

const respondMcpcfContextFailure = Effect.fn("mcp.mcpcf.contextFailed")(function* (
  normalized: Request,
  sessionId: string,
  runtimeContext: McpcfMcpRuntimeContext,
  cause: unknown,
) {
  const error = toError(cause)
  runtimeContext.log.error(error, {
    event: "mcp.mcpcf.context.failed",
    boundary: "mcp.mcpcf.context",
    mcpcf: {
      sessionId,
      requestedServerCount: parseAllowedMcpcfServers(normalized).length,
      requestedServerHeaderPresent: normalized.headers.has(MCPCF_SERVER_HEADER),
    },
    _forceKeep: true,
  })
  const reconnectFields = Match.value(isOAuthReconnectError(error)).pipe(
    Match.when(true, () => ({ data: { discoveryReason: "oauth_reconnect_required" as const } })),
    Match.orElse(() => ({})),
  )
  return yield* createJsonRpcErrorResponse(normalized, {
    message: redactMcpcfErrorMessage(cause),
    ...reconnectFields,
  })
})

const handleMcpcfMcpRequestEffect = Effect.fn("mcp.mcpcf.handle")(function* (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  runtimeContext: McpcfMcpRuntimeContext,
) {
  const normalized = normalizeMcpcfMcpRequest(request)
  const sessionId = yield* Effect.tryPromise(() =>
    verifyMcpcfProxyCapabilityRequest(normalized, env.MCPCF_PROXY_SIGNING_SECRET),
  )
  return yield* resolveMcpcfMcpContext(normalized, env, runtimeContext, sessionId).pipe(
    Effect.matchEffect({
      onFailure: (cause) =>
        respondMcpcfContextFailure(normalized, sessionId, runtimeContext, cause),
      onSuccess: (context) => runMcpcfMcpHandler(context, normalized, env, ctx),
    }),
  )
})

export function handleMcpcfMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  runtimeContext: McpcfMcpRuntimeContext,
): Promise<Response> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Worker fetch-entry adapter boundary: the apps/api entrypoint is non-Effect and cannot import Effect without re-gating its imperative routing, so the Effect program is run here.
  return Effect.runPromise(handleMcpcfMcpRequestEffect(request, env, ctx, runtimeContext))
}
