import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type { SessionsListQuery } from "@c0/api"
import { resolveStoredSessionTools } from "@c0-agent/shared"
import { SessionIndexStore } from "../../../background/db/session-index"
import {
  formatSessionListResponse,
  json,
  requirePrincipalUserId,
  resolveSessionListToolAvailability,
  runControlPlane,
} from "../shared/control-plane"

export function list({ query }: { query: SessionsListQuery }) {
  return runControlPlane(
    Effect.fn("sessions.list")(function* ({ request, env, principal }) {
      const userId = yield* requirePrincipalUserId(request, principal)

      const limit = parsePositiveInt(query.limit, 50, 100)
      const offset = parseNonNegativeInt(query.offset)
      const store = new SessionIndexStore(env.DB)
      const result = yield* store.list({
        userId,
        status: query.status,
        excludeStatus: query.excludeStatus,
        includeIncognito: parseBooleanQuery(query.includeIncognito),
        q: query.q,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
        sessionKind: query.sessionKind,
        agentRuntime: query.agentRuntime,
        source: query.source,
        repoOwner: query.repoOwner,
        repoName: query.repoName,
        limit,
        offset,
      })
      const storedSessionTools = result.sessions.map((session) =>
        resolveStoredSessionTools(session.tools_json),
      )
      const resolvedSessionTools = yield* resolveSessionListToolAvailability(
        env,
        storedSessionTools,
      )
      return json(formatSessionListResponse(result, resolvedSessionTools))
    }),
  )
}

function parseBooleanQuery(value: string | undefined): boolean {
  return Option.match(Option.fromNullishOr(value?.trim().toLowerCase()), {
    onNone: () => false,
    onSome: (normalized) => normalized === "1" || normalized === "true" || normalized === "yes",
  })
}

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Match.value(Number.isFinite(parsed) && parsed > 0).pipe(
    Match.when(true, () => Math.min(parsed, max)),
    Match.orElse(() => fallback),
  )
}

function parseNonNegativeInt(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Match.value(Number.isFinite(parsed) && parsed >= 0).pipe(
    Match.when(true, () => parsed),
    Match.orElse(() => 0),
  )
}
