import * as Effect from "effect/Effect"
import type { IdParams } from "@c0/api"
import {
  getSessionStub,
  InternalRequests,
  requireSessionAccess,
  runControlPlane,
} from "../../shared/control-plane"

export function stop({ params }: { params: IdParams }) {
  return runControlPlane(
    Effect.fn("sessions.stop")(function* ({ request, env, principal }) {
      yield* requireSessionAccess(request, env, principal, params.id)
      const stub = getSessionStub(env, params.id)
      const internalRequests = yield* InternalRequests
      return yield* internalRequests.fetch(stub, "http://internal/internal/stop", {
        method: "POST",
      })
    }),
  )
}
