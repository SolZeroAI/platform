import type { AgentSkillParams, AgentSkillPreferencePayload } from "@solzero/api"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { AgentSkillStore, listEffectiveGlobalSkills } from "../../../background/skills/catalog"
import {
  ControlPlaneFailure,
  describeError,
  json,
  requirePrincipalUserId,
  runControlPlane,
  type ControlPlaneContext,
} from "../shared/control-plane"

function skillFailure(cause: unknown): ControlPlaneFailure {
  const tag = Option.fromNullishOr(cause).pipe(
    Option.filter(
      (candidate): candidate is { _tag: unknown } =>
        typeof candidate === "object" && "_tag" in candidate,
    ),
    Option.map((tagged) => String(tagged._tag)),
    Option.getOrElse(() => ""),
  )
  const status = Match.value(tag).pipe(
    Match.when("AgentSkillNotFoundError", () => 404),
    Match.orElse(() => 500),
  )
  return new ControlPlaneFailure({ payload: { error: describeError(cause) }, status })
}

const listForUser = Effect.fn("skills.listForUser")(function* (
  context: ControlPlaneContext,
  userId: string,
) {
  const skills = yield* Effect.tryPromise({
    try: () => listEffectiveGlobalSkills({ db: context.db, userId }),
    catch: skillFailure,
  })
  return json({ skills })
})

export function list() {
  return runControlPlane(
    Effect.fn("skills.list")(function* (context: ControlPlaneContext) {
      const userId = yield* requirePrincipalUserId(context.request, context.principal)
      return yield* listForUser(context, userId)
    }),
  )
}

export function setPreference({
  params,
  payload,
}: {
  params: AgentSkillParams
  payload: AgentSkillPreferencePayload
}) {
  return runControlPlane(
    Effect.fn("skills.setPreference")(function* (context: ControlPlaneContext) {
      const userId = yield* requirePrincipalUserId(context.request, context.principal)
      yield* new AgentSkillStore(context.db)
        .setPreference(userId, params.skillId, payload.enabled)
        .pipe(Effect.mapError(skillFailure))
      return yield* listForUser(context, userId)
    }),
  )
}

export function clearPreference({ params }: { params: AgentSkillParams }) {
  return runControlPlane(
    Effect.fn("skills.clearPreference")(function* (context: ControlPlaneContext) {
      const userId = yield* requirePrincipalUserId(context.request, context.principal)
      yield* new AgentSkillStore(context.db)
        .clearPreference(userId, params.skillId)
        .pipe(Effect.mapError(skillFailure))
      return yield* listForUser(context, userId)
    }),
  )
}
