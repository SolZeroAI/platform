import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type { IdParams } from "@solzero/api"
import { SessionIndexStore } from "../../../../../background/db/session-index"
import { stringifyJson } from "../../../../../lib/json"
import {
  getSessionStub,
  InternalRequests,
  json,
  requireSessionAccess,
  runControlPlane,
} from "../../../shared/control-plane"

const handleStaleSessionIndex = Effect.fn("sessions.archive.handleStale")(function* (
  store: SessionIndexStore,
  sessionId: string,
) {
  const deleted = yield* store.delete(sessionId)
  return Match.value(deleted).pipe(
    Match.when(true, () =>
      Option.some(json({ status: "deleted", sessionId, reason: "stale_session_index" })),
    ),
    Match.orElse(() => Option.none<Response>()),
  )
})

export function archive({ params }: { params: IdParams }) {
  return runControlPlane(
    Effect.fn("sessions.archive")(function* ({ request, env, db, principal }) {
      const access = yield* requireSessionAccess(request, env, principal, params.id)
      const stub = getSessionStub(env, params.id)
      const internalRequests = yield* InternalRequests
      const response = yield* internalRequests.fetch(stub, "http://internal/internal/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyJson({ userId: access.userId }),
      })
      const store = new SessionIndexStore(db)
      const staleResponse = yield* Match.value(response.status === 404).pipe(
        Match.when(true, () => handleStaleSessionIndex(store, params.id)),
        Match.orElse(() => Effect.succeed(Option.none<Response>())),
      )
      const updateStatus = store.updateStatus(params.id, "archived")
      const okGuard = Effect.succeed(response.ok)
      yield* Effect.when(updateStatus, okGuard)
      return Option.getOrElse(staleResponse, () => response)
    }),
  )
}
