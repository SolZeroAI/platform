import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { verifyMcpcfProxyCapabilityRequest } from "../background/auth/mcpcf-capability"
import {
  INTERNAL_AI_SEARCH_MCP_ROUTE,
  INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE,
  MCPCF_PROXY_MCP_ROUTE,
} from "../background/session/mcp-config"
import { toError } from "../lib/effect-errors"

function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname === `${route}/`
}

export function isC0McpPath(pathname: string): boolean {
  return (
    matchesRoute(pathname, INTERNAL_AI_SEARCH_MCP_ROUTE) ||
    matchesRoute(pathname, INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE)
  )
}

export function isMcpcfProxyMcpPath(pathname: string): boolean {
  return matchesRoute(pathname, MCPCF_PROXY_MCP_ROUTE)
}

export function isMcpPath(pathname: string): boolean {
  return isC0McpPath(pathname) || isMcpcfProxyMcpPath(pathname)
}

const verifyMcpcfCapability = (request: Request, secret: string) =>
  Effect.tryPromise({
    try: () => verifyMcpcfProxyCapabilityRequest(request, secret),
    catch: toError,
  }).pipe(
    Effect.map(() => true),
    Effect.catch(() => Effect.succeed(false)),
  )

const shouldDispatchMcpRequestEffect = Effect.fn("mcp.routes.shouldDispatch")(function* (input: {
  request: Request
  mcpcfProxySigningSecret?: string | null
  workerRouteEnabled: boolean
}) {
  const pathname = new URL(input.request.url).pathname
  return yield* Match.value(pathname).pipe(
    Match.when(isC0McpPath, () => Effect.succeed(input.workerRouteEnabled)),
    Match.when(isMcpcfProxyMcpPath, () =>
      Option.match(Option.fromNullishOr(input.mcpcfProxySigningSecret), {
        onNone: () => Effect.succeed(false),
        onSome: (secret) => verifyMcpcfCapability(input.request, secret),
      }),
    ),
    Match.orElse(() => Effect.succeed(false)),
  )
})

export function shouldDispatchMcpRequest(input: {
  request: Request
  mcpcfProxySigningSecret?: string | null
  workerRouteEnabled: boolean
}): Promise<boolean> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Worker entry boundary: apps/api index is non-Effect and runs this Effect at the Promise edge.
  return Effect.runPromise(shouldDispatchMcpRequestEffect(input))
}
