import type { IdParams, ResumeSessionPayload } from "@c0/api"
import * as Effect from "effect/Effect"
import { stringifyJson } from "../../../../../lib/json"
import { EffectRequestLogger } from "../../../../services/observability"
import {
  getSessionStub,
  InternalRequests,
  requireSessionAccess,
  runControlPlane,
} from "../../../shared/control-plane"

export function resume({ params, payload }: { params: IdParams; payload: ResumeSessionPayload }) {
  return runControlPlane(
    Effect.fn("sessions.resume")(function* ({ request, env, principal }) {
      const access = yield* requireSessionAccess(request, env, principal, params.id)

      const log = yield* EffectRequestLogger
      yield* log.set({
        sessionId: params.id,
        sessionKind: access.session.session_kind,
        reason: payload.reason,
        messageId: payload.messageId ?? null,
      })

      const stub = getSessionStub(env, params.id)
      const internalRequests = yield* InternalRequests
      return yield* internalRequests.fetch(stub, "http://internal/internal/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyJson({
          messageId: payload.messageId,
          reason: payload.reason,
        }),
      })
    }),
  )
}
