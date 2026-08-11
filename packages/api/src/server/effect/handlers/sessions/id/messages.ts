import * as Effect from "effect/Effect"
import type { IdParams } from "@solzero/api"
import {
  getSessionStub,
  InternalRequests,
  requireSessionAccess,
  runControlPlane,
} from "../../shared/control-plane"

export function messages({ params }: { params: IdParams }) {
  return runControlPlane(
    Effect.fn("sessions.messages")(function* ({ request, env, principal }) {
      yield* requireSessionAccess(request, env, principal, params.id)
      const url = new URL(request.url)
      const stub = getSessionStub(env, params.id)
      const internalRequests = yield* InternalRequests
      return yield* internalRequests.fetch(stub, `http://internal/internal/messages${url.search}`)
    }),
  )
}
