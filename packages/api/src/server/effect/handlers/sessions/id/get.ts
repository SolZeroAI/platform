import * as Effect from "effect/Effect"
import type { IdParams } from "@solzero/api"
import {
  failUnless,
  getSessionStub,
  InternalRequests,
  requireSessionAccess,
  runControlPlane,
} from "../../shared/control-plane"

export function get({ params }: { params: IdParams }) {
  return runControlPlane(
    Effect.fn("sessions.get")(function* ({ request, env, principal }) {
      yield* requireSessionAccess(request, env, principal, params.id)
      const stub = getSessionStub(env, params.id)
      const internalRequests = yield* InternalRequests
      const response = yield* internalRequests.fetch(stub, "http://internal/internal/state")
      yield* failUnless(response.ok, "Session not found", 404)
      return response
    }),
  )
}
