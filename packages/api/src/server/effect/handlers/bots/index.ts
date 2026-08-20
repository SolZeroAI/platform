import type {
  BotIdParams,
  BotRoutineParams,
  CreateBotPayload,
  CreateBotRoutinePayload,
  OpenBotPayload,
} from "@solzero/api"
import { BotRoutineValidationError } from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { BotRoutineService } from "../../../background/bots/service"
import { BotNotFoundError, BotRoutineNotFoundError } from "../../../background/db/errors"
import {
  ControlPlaneFailure,
  describeError,
  json,
  failUnless,
  requirePrincipalUserId,
  runControlPlane,
  type ControlPlaneContext,
} from "../shared/control-plane"

function botFailure(cause: unknown): ControlPlaneFailure {
  const tag = Option.fromNullishOr(cause).pipe(
    Option.filter(
      (candidate): candidate is { _tag: unknown } =>
        typeof candidate === "object" && "_tag" in candidate,
    ),
    Option.map((tagged) => String(tagged._tag)),
    Option.getOrElse(() => ""),
  )
  const status = Match.value(tag).pipe(
    Match.when("BotNotFoundError", () => 404),
    Match.when("BotRoutineNotFoundError", () => 404),
    Match.orElse(() =>
      Match.value(cause instanceof BotRoutineValidationError).pipe(
        Match.when(true, () => 400),
        Match.orElse(() => 500),
      ),
    ),
  )
  return new ControlPlaneFailure({ payload: { error: describeError(cause) }, status })
}

function service(context: ControlPlaneContext) {
  return new BotRoutineService(context.env)
}

export function list() {
  return runControlPlane(
    Effect.fn("bots.list")(function* (context) {
      const userId = yield* requirePrincipalUserId(context.request, context.principal)
      const bots = yield* service(context).listBots(userId).pipe(Effect.mapError(botFailure))
      return json({ bots })
    }),
  )
}

export function create({ payload }: { payload: CreateBotPayload }) {
  return runControlPlane(
    Effect.fn("bots.create")(function* (context) {
      const userId = yield* requirePrincipalUserId(context.request, context.principal)
      const bot = yield* service(context)
        .createBot(userId, payload)
        .pipe(Effect.mapError(botFailure))
      return json({ bot })
    }),
  )
}

export function get({ params }: { params: BotIdParams }) {
  return runControlPlane(
    Effect.fn("bots.get")(function* (context) {
      const userId = yield* requirePrincipalUserId(context.request, context.principal)
      const bot = yield* service(context)
        .getBot(userId, params.id)
        .pipe(Effect.mapError(botFailure))
      return json({ bot })
    }),
  )
}

export function open({ params, payload }: { params: BotIdParams; payload: OpenBotPayload }) {
  return runControlPlane(
    Effect.fn("bots.open")(function* (context) {
      const userId = yield* requirePrincipalUserId(context.request, context.principal)
      const sessionId = payload.sessionId?.trim() ?? ""
      yield* failUnless(sessionId.length > 0, "sessionId is required", 400)
      const bot = yield* service(context)
        .attachSession(userId, params.id, sessionId)
        .pipe(Effect.mapError(botFailure))
      return json({ bot })
    }),
  )
}

export function listRoutines({ params }: { params: BotIdParams }) {
  return runControlPlane(
    Effect.fn("bots.listRoutines")(function* (context) {
      const userId = yield* requirePrincipalUserId(context.request, context.principal)
      const routines = yield* service(context)
        .listRoutines(userId, params.id)
        .pipe(Effect.mapError(botFailure))
      return json({ routines })
    }),
  )
}

export function createRoutine({
  params,
  payload,
}: {
  params: BotIdParams
  payload: CreateBotRoutinePayload
}) {
  return runControlPlane(
    Effect.fn("bots.createRoutine")(function* (context) {
      const userId = yield* requirePrincipalUserId(context.request, context.principal)
      const routine = yield* service(context)
        .createRoutine(userId, params.id, payload)
        .pipe(Effect.mapError(botFailure))
      return json({ routine })
    }),
  )
}

export function deleteRoutine({ params }: { params: BotRoutineParams }) {
  return runControlPlane(
    Effect.fn("bots.deleteRoutine")(function* (context) {
      const userId = yield* requirePrincipalUserId(context.request, context.principal)
      const routine = yield* service(context)
        .deleteRoutine(userId, params.id, params.routineId)
        .pipe(Effect.mapError(botFailure))
      return json({ status: "deleted", routineId: routine.id })
    }),
  )
}

export function completeRoutine({ params }: { params: BotRoutineParams }) {
  return runControlPlane(
    Effect.fn("bots.completeRoutine")(function* (context) {
      const userId = yield* requirePrincipalUserId(context.request, context.principal)
      const routine = yield* service(context)
        .completeRoutine(userId, params.id, params.routineId)
        .pipe(Effect.mapError(botFailure))
      return json({ status: "deleted", routineId: routine.id })
    }),
  )
}

export { BotNotFoundError, BotRoutineNotFoundError }
