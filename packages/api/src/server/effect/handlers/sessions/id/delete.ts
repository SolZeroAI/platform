import * as Effect from "effect/Effect"
import type { IdParams } from "@solzero/api"
import { SessionIndexStore } from "../../../../background/db/session-index"
import { IsolateSessionRuntime } from "../../../../background/isolate/runtime"
import { resolveCloudflareTracing } from "../../../services/observability"
import { json, requireSessionAccess, runControlPlane } from "../../shared/control-plane"

export function deleteSession({ params }: { params: IdParams }) {
  return runControlPlane(
    Effect.fn("sessions.delete")(function* ({ request, env, db, ctx, principal }) {
      const access = yield* requireSessionAccess(request, env, principal, params.id)
      yield* IsolateSessionRuntime.clearSubagentRunsBeforeDelete({
        env,
        tracing: resolveCloudflareTracing(ctx),
        sessionId: params.id,
        agentRuntime: access.session.agent_runtime,
      })
      const store = new SessionIndexStore(db)
      yield* store.delete(params.id)
      return json({ status: "deleted", sessionId: params.id })
    }),
  )
}
