import type { ApiEnv } from "infra/types/env"
import type { IdParams, UpdateSessionToolsPayload } from "@solzero/api"
import type { OpenCodeMcpServers, SessionToolSpec, SubagentMode } from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import { SessionIndexStore } from "../../../../../background/db/session-index"
import { stringifyJson } from "../../../../../lib/json"
import {
  ControlPlaneFailure,
  describeError,
  getSessionStub,
  InternalRequests,
  json,
  requireSessionAccess,
  resolveRequestedCustomMcpServers,
  resolveRequestedSessionTools,
  runControlPlane,
  validateRequestedAiSearchSessionTools,
  validateRequestedMcpcfSessionTools,
} from "../../../shared/control-plane"

const finalizeToolsUpdate = Effect.fn("sessions.tools.finalize")(function* (
  env: ApiEnv,
  sessionId: string,
  response: Response,
) {
  const data = yield* Effect.tryPromise(
    () =>
      response.json() as Promise<{
        repoOwner: string
        repoName: string
        tools?: SessionToolSpec[]
        customMcpServers?: unknown
        isolateStepLimit?: number
        subagents?: SubagentMode
        updatedAt: number
      }>,
  )
  const store = new SessionIndexStore(env.DB)
  yield* store.updateTooling({
    id: sessionId,
    repoOwner: data.repoOwner,
    repoName: data.repoName,
    tools: data.tools,
    customMcpServers: data.customMcpServers as OpenCodeMcpServers | undefined,
    isolateStepLimit: data.isolateStepLimit,
    subagents: data.subagents,
    updatedAt: data.updatedAt,
  })
  return json(data)
})

export function tools({
  params,
  payload,
}: {
  params: IdParams
  payload: UpdateSessionToolsPayload
}) {
  return runControlPlane(
    Effect.fn("sessions.tools")(function* ({ request, env, principal }) {
      const access = yield* requireSessionAccess(request, env, principal, params.id)

      const resolved = yield* Effect.try({
        try: () => ({
          requestedTools: resolveRequestedSessionTools(request, payload),
          requestedCustomMcpServers: resolveRequestedCustomMcpServers(payload),
        }),
        catch: (cause) =>
          new ControlPlaneFailure({ payload: { error: describeError(cause) }, status: 400 }),
      })
      yield* validateRequestedAiSearchSessionTools(env, resolved.requestedTools)
      yield* validateRequestedMcpcfSessionTools(env, resolved.requestedTools, {
        userId: access.userId,
      })

      const stub = getSessionStub(env, params.id)
      const internalRequests = yield* InternalRequests
      const response = yield* internalRequests.fetch(stub, "http://internal/internal/tools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: stringifyJson({
          userId: access.userId,
          tools: resolved.requestedTools,
          customMcpServers: resolved.requestedCustomMcpServers,
          isolateStepLimit: payload.isolateStepLimit ?? null,
          subagents: payload.subagents ?? null,
        }),
      })

      return yield* Match.value(response.ok).pipe(
        Match.when(false, () => Effect.succeed(response)),
        Match.orElse(() => finalizeToolsUpdate(env, params.id, response)),
      )
    }),
  )
}
