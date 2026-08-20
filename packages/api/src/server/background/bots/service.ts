import {
  evaluateRoutineTick,
  type BotRoutineSummary,
  type BotSummary,
  type CreateBotInput,
  type CreateBotRoutineInput,
} from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { BotStore } from "../db/bots"
import type { Env } from "../types"
import { cancelRoutineAlarm, nextCronDate, scheduleRoutineAlarm } from "../workflows/alarm"

export interface BotRoutineScheduleAdapters {
  scheduleRoutineAlarm: typeof scheduleRoutineAlarm
  cancelRoutineAlarm: typeof cancelRoutineAlarm
  nextCronDate: typeof nextCronDate
}

const defaultAdapters: BotRoutineScheduleAdapters = {
  scheduleRoutineAlarm,
  cancelRoutineAlarm,
  nextCronDate,
}

function cadenceCron(routine: BotRoutineSummary): Option.Option<string> {
  return Match.value(routine.cadence).pipe(
    Match.when({ kind: "cron" }, (cadence) => Option.fromNullishOr(cadence.cron)),
    Match.orElse(() => Option.none()),
  )
}

export class BotRoutineService {
  constructor(
    private readonly env: Env,
    private readonly adapters: BotRoutineScheduleAdapters = defaultAdapters,
  ) {}

  private store() {
    return new BotStore(this.env.DB)
  }

  createBot(userId: string, input: CreateBotInput) {
    return this.store().create(userId, input)
  }

  listBots(userId: string) {
    return this.store().list(userId)
  }

  getBot(userId: string, botId: string) {
    return this.store().getOwned(userId, botId)
  }

  getBotBySessionId(sessionId: string) {
    return this.store().getBySessionId(sessionId)
  }

  attachSession(userId: string, botId: string, sessionId: string) {
    return this.store().attachSession(userId, botId, sessionId)
  }

  listRoutines(userId: string, botId: string) {
    return this.store().listRoutines(userId, botId)
  }

  createRoutine(userId: string, botId: string, input: CreateBotRoutineInput) {
    return this.store()
      .createRoutine(userId, botId, input)
      .pipe(Effect.tap((routine) => this.schedule(routine)))
  }

  deleteRoutine(userId: string, botId: string, routineId: string) {
    return this.store()
      .deleteRoutine(userId, botId, routineId)
      .pipe(
        Effect.tap((routine) =>
          this.adapters.cancelRoutineAlarm({ env: this.env, routineId: routine.id }),
        ),
      )
  }

  completeRoutine(userId: string, botId: string, routineId: string) {
    return this.deleteRoutine(userId, botId, routineId)
  }

  private schedule(routine: BotRoutineSummary) {
    const now = Date.now()
    const decision = evaluateRoutineTick({
      kind: routine.kind,
      until: routine.until,
      status: routine.status,
      cadence: routine.cadence,
      now,
      nextCronDate: this.adapters.nextCronDate,
    })
    const nextRunAt = Match.value(decision).pipe(
      Match.when({ action: "run" }, (run) => Option.some(run.nextRunAt)),
      Match.orElse(() => Option.none()),
    )
    return Option.match(nextRunAt, {
      onSome: (scheduledAt) =>
        this.adapters.scheduleRoutineAlarm({
          env: this.env,
          routineId: routine.id,
          userId: routine.userId,
          scheduledAt,
          cron: Option.getOrNull(cadenceCron(routine)),
        }),
      onNone: () => this.store().deleteRoutineById(routine.id),
    }).pipe(Effect.map(() => routine))
  }
}

export type { BotSummary, BotRoutineSummary }
