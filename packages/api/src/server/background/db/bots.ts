import {
  BotRoutineKindSchema,
  BotStatusSchema,
  normalizeCreateBotInput,
  normalizeCreateBotRoutineInput,
  parseStoredBotRoutineCadence,
  parseStoredBotRoutineWatch,
  type BotRoutineKind,
  type BotRoutineSummary,
  type BotStatus,
  type BotSummary,
  type CreateBotInput,
  type CreateBotRoutineInput,
} from "@solzero/shared"
import { and, desc, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { stringifyJson } from "../../lib/json"
import {
  resolveControlPlaneHandle,
  type AppDrizzleDatabase,
  type AppSchema,
  type ControlPlaneDb,
} from "../../effect/db/control-plane-db"
import { generateId } from "../auth/crypto"
import { BotNotFoundError, BotRoutineNotFoundError, d1Error, type D1Error } from "./errors"

function newPrefixedId(prefix: string): string {
  return `${prefix}${generateId()}`
}

function requireBotStatus(value: string): BotStatus {
  return Option.getOrElse(Schema.decodeUnknownOption(BotStatusSchema)(value), () => "active")
}

function requireBotRoutineKind(value: string): BotRoutineKind {
  return Schema.decodeUnknownSync(BotRoutineKindSchema)(value)
}

function toBotSummary(row: AppSchema["bots"]["$inferSelect"]): BotSummary {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    instructions: row.instructions,
    sessionId: row.sessionId,
    status: requireBotStatus(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toRoutineSummary(row: AppSchema["botRoutines"]["$inferSelect"]): BotRoutineSummary {
  return {
    id: row.id,
    botId: row.botId,
    userId: row.userId,
    name: row.name,
    kind: requireBotRoutineKind(row.kind),
    cadence: parseStoredBotRoutineCadence(row.cadenceJson),
    prompt: row.prompt,
    until: row.until,
    watch: parseStoredBotRoutineWatch(row.watchJson),
    status: "active",
    lastRunAt: row.lastRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class BotStore {
  private readonly drizzle
  private readonly schema

  constructor(db: AppDrizzleDatabase | ControlPlaneDb) {
    const handle = resolveControlPlaneHandle(db)
    this.drizzle = handle.drizzle
    this.schema = handle.schema
  }

  create(userId: string, input: CreateBotInput) {
    const normalized = normalizeCreateBotInput(input)
    const now = Date.now()
    const record: BotSummary = {
      id: newPrefixedId("bot_"),
      userId,
      name: normalized.name,
      instructions: normalized.instructions,
      sessionId: null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    }
    return Effect.tryPromise({
      try: () =>
        this.drizzle.insert(this.schema.bots).values({
          id: record.id,
          userId: record.userId,
          name: record.name,
          instructions: record.instructions,
          sessionId: record.sessionId,
          status: record.status,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        }),
      catch: d1Error("bots.create"),
    }).pipe(Effect.map(() => record))
  }

  list(userId: string) {
    return Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.bots)
          .where(eq(this.schema.bots.userId, userId))
          .orderBy(desc(this.schema.bots.updatedAt)),
      catch: d1Error("bots.list"),
    }).pipe(Effect.map((rows) => rows.map(toBotSummary)))
  }

  getOwned(userId: string, botId: string) {
    return Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.bots)
          .where(and(eq(this.schema.bots.id, botId), eq(this.schema.bots.userId, userId)))
          .limit(1),
      catch: d1Error("bots.getOwned"),
    }).pipe(
      Effect.flatMap((rows) =>
        Option.match(Option.fromNullishOr(rows[0]), {
          onNone: () =>
            Effect.fail(new BotNotFoundError({ message: `Bot ${botId} was not found` })),
          onSome: (row) => Effect.succeed(toBotSummary(row)),
        }),
      ),
    )
  }

  getBySessionId(sessionId: string) {
    return Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.bots)
          .where(eq(this.schema.bots.sessionId, sessionId))
          .limit(1),
      catch: d1Error("bots.getBySessionId"),
    }).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]).pipe(Option.map(toBotSummary))))
  }

  attachSession(userId: string, botId: string, sessionId: string) {
    const now = Date.now()
    return this.getOwned(userId, botId).pipe(
      Effect.flatMap((bot) =>
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .update(this.schema.bots)
              .set({ sessionId, updatedAt: now })
              .where(and(eq(this.schema.bots.id, botId), eq(this.schema.bots.userId, userId))),
          catch: d1Error("bots.attachSession"),
        }).pipe(Effect.map(() => ({ ...bot, sessionId, updatedAt: now }))),
      ),
    )
  }

  createRoutine(userId: string, botId: string, input: CreateBotRoutineInput) {
    const normalized = normalizeCreateBotRoutineInput(input)
    const now = Date.now()
    return this.getOwned(userId, botId).pipe(
      Effect.map((bot) => ({
        id: newPrefixedId("routine_"),
        botId: bot.id,
        userId,
        name: normalized.name,
        kind: normalized.kind,
        cadence: normalized.cadence,
        prompt: normalized.prompt,
        until: normalized.until,
        watch: normalized.watch,
        status: "active" as const,
        lastRunAt: null,
        createdAt: now,
        updatedAt: now,
      })),
      Effect.tap((record) =>
        Effect.tryPromise({
          try: () =>
            this.drizzle.insert(this.schema.botRoutines).values({
              id: record.id,
              botId: record.botId,
              userId: record.userId,
              name: record.name,
              kind: record.kind,
              cadenceJson: stringifyJson(record.cadence),
              prompt: record.prompt,
              until: record.until,
              watchJson: stringifyJson(record.watch),
              status: record.status,
              lastRunAt: record.lastRunAt,
              createdAt: record.createdAt,
              updatedAt: record.updatedAt,
            }),
          catch: d1Error("bots.createRoutine"),
        }),
      ),
    )
  }

  listRoutines(userId: string, botId: string) {
    return this.getOwned(userId, botId).pipe(
      Effect.flatMap(() =>
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .select()
              .from(this.schema.botRoutines)
              .where(
                and(
                  eq(this.schema.botRoutines.botId, botId),
                  eq(this.schema.botRoutines.userId, userId),
                ),
              )
              .orderBy(desc(this.schema.botRoutines.updatedAt)),
          catch: d1Error("bots.listRoutines"),
        }),
      ),
      Effect.map((rows) => rows.map(toRoutineSummary)),
    )
  }

  getRoutine(userId: string, botId: string, routineId: string) {
    return Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.botRoutines)
          .where(
            and(
              eq(this.schema.botRoutines.id, routineId),
              eq(this.schema.botRoutines.botId, botId),
              eq(this.schema.botRoutines.userId, userId),
            ),
          )
          .limit(1),
      catch: d1Error("bots.getRoutine"),
    }).pipe(
      Effect.flatMap((rows) =>
        Option.match(Option.fromNullishOr(rows[0]), {
          onNone: () =>
            Effect.fail(
              new BotRoutineNotFoundError({ message: `Routine ${routineId} was not found` }),
            ),
          onSome: (row) => Effect.succeed(toRoutineSummary(row)),
        }),
      ),
    )
  }

  getRoutineById(routineId: string) {
    return Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.botRoutines)
          .where(eq(this.schema.botRoutines.id, routineId))
          .limit(1),
      catch: d1Error("bots.getRoutineById"),
    }).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]).pipe(Option.map(toRoutineSummary))))
  }

  markRoutineRun(routineId: string, lastRunAt: number) {
    return Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(this.schema.botRoutines)
          .set({ lastRunAt, updatedAt: lastRunAt })
          .where(eq(this.schema.botRoutines.id, routineId)),
      catch: d1Error("bots.markRoutineRun"),
    })
  }

  deleteRoutine(userId: string, botId: string, routineId: string) {
    return this.getRoutine(userId, botId, routineId).pipe(
      Effect.tap(() =>
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .delete(this.schema.botRoutines)
              .where(
                and(
                  eq(this.schema.botRoutines.id, routineId),
                  eq(this.schema.botRoutines.botId, botId),
                  eq(this.schema.botRoutines.userId, userId),
                ),
              ),
          catch: d1Error("bots.deleteRoutine"),
        }),
      ),
    )
  }

  deleteRoutineById(routineId: string) {
    return Effect.tryPromise({
      try: () =>
        this.drizzle
          .delete(this.schema.botRoutines)
          .where(eq(this.schema.botRoutines.id, routineId)),
      catch: d1Error("bots.deleteRoutineById"),
    }).pipe(Effect.map(() => undefined))
  }
}

export type BotStoreError = D1Error | BotNotFoundError | BotRoutineNotFoundError
