import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type { D1Error } from "../db/errors"
import type { SessionIndexRecord } from "../db/session-index"

export type SessionAccessRole = "owner"

export interface SessionAccessGrant {
  session: SessionIndexRecord
  userId: string
  role: SessionAccessRole
}

export interface SessionAccessStore {
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Minimal store contract (decoupled from SessionIndexStore so tests can supply a fake); the D1Error channel must be named explicitly here.
  getById(id: string): Effect.Effect<Option.Option<SessionIndexRecord>, D1Error>
}

/**
 * Centralize session access decisions so future sharing can extend this
 * without touching every route handler again.
 *
 * Notes for the next agent:
 * - Keep `sessions.user_id` as the canonical owner field.
 * - Add session sharing here via explicit grants instead of weakening route checks.
 * - Prefer capability checks (`view`, `interact`, `manage`) over ad hoc role checks
 *   in route handlers.
 * - Session-scoped REST routes and ws-token issuance should
 *   all continue to flow through this helper so they share one authorization model.
 */
export const resolveSessionAccess = Effect.fn("session.resolveSessionAccess")(function* (
  store: SessionAccessStore,
  sessionId: string,
  userId: string,
) {
  const session = yield* store.getById(sessionId)
  return Option.flatMap(session, (record) =>
    Match.value(record.user_id === userId).pipe(
      Match.when(true, () =>
        Option.some<SessionAccessGrant>({ session: record, userId, role: "owner" }),
      ),
      // Future session sharing can add additional grants here.
      Match.orElse(() => Option.none<SessionAccessGrant>()),
    ),
  )
})

/**
 * Promise bridge for non-Effect callers: resolves to
 * the access grant or `null` so imperative request plumbing can branch without importing Effect.
 */
export function resolveSessionAccessPromise(
  store: SessionAccessStore,
  sessionId: string,
  userId: string,
): Promise<SessionAccessGrant | null> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary bridging the Effect session-access policy to the non-Effect preview-proxy router.
  return Effect.runPromise(
    resolveSessionAccess(store, sessionId, userId).pipe(Effect.map(Option.getOrNull)),
  )
}
