import type { IdParams } from "@solzero/api"
import * as Effect from "effect/Effect"
import {
  getSessionStub,
  InternalRequests,
  requireSessionAccess,
  runControlPlane,
} from "../../shared/control-plane"

export function sandboxActivity({ params }: { params: IdParams }) {
  return runControlPlane(
    Effect.fn("sessions.sandboxActivity")(function* ({ request, env, principal }) {
      yield* requireSessionAccess(request, env, principal, params.id)
      const url = new URL(request.url)
      const stub = getSessionStub(env, params.id)
      const internalRequests = yield* InternalRequests
      return yield* internalRequests.fetch(
        stub,
        `http://internal/internal/sandbox/activity${url.search}`,
      )
    }),
  )
}
