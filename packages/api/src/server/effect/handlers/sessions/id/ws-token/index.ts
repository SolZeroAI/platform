import type { IdParams, WsTokenPayload } from "@solzero/api"
import * as Effect from "effect/Effect"
import { stringifyJson } from "../../../../../lib/json"
import {
  getSessionStub,
  InternalRequests,
  requireSessionAccess,
  runControlPlane,
} from "../../../shared/control-plane"

export function wsToken({ params, payload }: { params: IdParams; payload: WsTokenPayload }) {
  return runControlPlane(
    Effect.fn("sessions.wsToken")(function* ({ request, env, principal }) {
      const access = yield* requireSessionAccess(request, env, principal, params.id)
      const stub = getSessionStub(env, params.id)
      const internalRequests = yield* InternalRequests
      return yield* internalRequests.fetch(stub, "http://internal/internal/ws-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyJson({
          ...payload,
          userId: access.userId,
        }),
      })
    }),
  )
}
