import type { IdParams } from "@solzero/api"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type { ControlPlaneDb } from "../../../../db/control-plane-db"
import { SessionIndexStore } from "../../../../../background/db/session-index"
import { stringifyJson } from "../../../../../lib/json"
import {
  getSessionStub,
  InternalRequests,
  json,
  requireSessionAccess,
  runControlPlane,
} from "../../../shared/control-plane"

const handleStaleSessionIndex = Effect.fn("sessions.unarchive.stale")(function* (
  db: ControlPlaneDb,
  sessionId: string,
  response: Response,
) {
  const store = new SessionIndexStore(db)
  const deleted = yield* store.delete(sessionId)

  return Match.value(deleted).pipe(
    Match.when(true, () => json({ status: "deleted", sessionId, reason: "stale_session_index" })),
    Match.orElse(() => response),
  )
})

const activateUnarchivedSession = Effect.fn("sessions.unarchive.activate")(function* (
  db: ControlPlaneDb,
  sessionId: string,
  response: Response,
) {
  const store = new SessionIndexStore(db)
  const activate = store.updateStatus(sessionId, "active")
  const guard = Effect.succeed(response.ok)
  yield* Effect.when(activate, guard)

  return response
})

const handleUnarchiveResponse = Effect.fn("sessions.unarchive.handle")(function* (
  db: ControlPlaneDb,
  sessionId: string,
  response: Response,
) {
  return yield* Match.value(response.status === 404).pipe(
    Match.when(true, () => handleStaleSessionIndex(db, sessionId, response)),
    Match.orElse(() => activateUnarchivedSession(db, sessionId, response)),
  )
})

export function unarchive({ params }: { params: IdParams }) {
  return runControlPlane(
    Effect.fn("sessions.unarchive")(function* ({ request, env, principal, db }) {
      const access = yield* requireSessionAccess(request, env, principal, params.id)
      const stub = getSessionStub(env, params.id)
      const internalRequests = yield* InternalRequests

      const response = yield* internalRequests.fetch(stub, "http://internal/internal/unarchive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyJson({ userId: access.userId }),
      })

      return yield* handleUnarchiveResponse(db, params.id, response)
    }),
  )
}
