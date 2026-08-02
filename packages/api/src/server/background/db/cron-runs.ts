import { and, desc, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { generateId } from "../auth/crypto"
import { makeD1Drizzle } from "../../effect/db/d1-drizzle"
import { cronRuns } from "../../effect/db/schema"
import { parseJsonRecord, stringifyJson } from "../../lib/json"
import { d1Error } from "./errors"

export type CronRunTrigger = "scheduled" | "manual"
export type CronRunStatus = "success" | "failure" | "skipped"

export interface CronRunRecord {
  id: string
  jobId: string
  cron: string | null
  trigger: CronRunTrigger
  status: CronRunStatus
  startedAt: number
  finishedAt: number
  durationMs: number
  result: Record<string, unknown>
  errorMessage: string | null
  actorUserId: string | null
  actorEmail: string | null
  createdAt: number
}

export interface CronJobStatus {
  jobId: string
  latestRun: CronRunRecord | null
  latestSuccess: CronRunRecord | null
  latestFailure: CronRunRecord | null
}

export interface CronRunInsert {
  jobId: string
  cron?: string | null
  trigger: CronRunTrigger
  status: CronRunStatus
  startedAt: number
  finishedAt: number
  result?: Record<string, unknown> | null
  errorMessage?: string | null
  actorUserId?: string | null
  actorEmail?: string | null
}

function toCronRun(row: typeof cronRuns.$inferSelect): CronRunRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    cron: row.cron,
    trigger: row.trigger as CronRunTrigger,
    status: row.status as CronRunStatus,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    result: parseJsonRecord(row.resultJson),
    errorMessage: row.errorMessage,
    actorUserId: row.actorUserId,
    actorEmail: row.actorEmail,
    createdAt: row.createdAt,
  }
}

export function sanitizeCronErrorMessage(value: unknown): string {
  const message = Match.value(value).pipe(
    Match.when(Match.instanceOf(Error), (error) => error.message),
    Match.orElse((resolved) => String(resolved)),
  )
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]").slice(0, 2000)
}

export class CronRunsStore {
  private readonly drizzle

  constructor(db: D1Database) {
    this.drizzle = makeD1Drizzle(db)
  }

  insertRun = Effect.fn("db.cronRuns.insertRun")(function* (
    this: CronRunsStore,
    input: CronRunInsert,
  ) {
    const durationMs = Math.max(0, input.finishedAt - input.startedAt)
    const createdAt = input.finishedAt
    const row = {
      id: `crn_${generateId(12)}`,
      jobId: input.jobId,
      cron: input.cron ?? null,
      trigger: input.trigger,
      status: input.status,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      durationMs,
      resultJson: stringifyJson(input.result ?? {}),
      errorMessage: input.errorMessage ?? null,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail ?? null,
      createdAt,
    }
    yield* Effect.tryPromise({
      try: () => this.drizzle.insert(cronRuns).values(row),
      catch: d1Error("db.cronRuns.insertRun"),
    })
    return toCronRun(row)
  })

  getJobStatus = Effect.fn("db.cronRuns.getJobStatus")(function* (
    this: CronRunsStore,
    jobId: string,
  ) {
    const [latestRun, latestSuccess, latestFailure] = yield* Effect.all(
      [
        this.getLatestRun(jobId),
        this.getLatestRun(jobId, "success"),
        this.getLatestRun(jobId, "failure"),
      ],
      { concurrency: "unbounded" },
    )
    return {
      jobId,
      latestRun: Option.getOrNull(latestRun),
      latestSuccess: Option.getOrNull(latestSuccess),
      latestFailure: Option.getOrNull(latestFailure),
    } satisfies CronJobStatus
  })

  private getLatestRun = Effect.fn("db.cronRuns.getLatestRun")(function* (
    this: CronRunsStore,
    jobId: string,
    status?: CronRunStatus,
  ) {
    const whereClause = Match.value(Option.fromNullishOr(status)).pipe(
      Match.when(Option.isSome, (resolved) =>
        and(eq(cronRuns.jobId, jobId), eq(cronRuns.status, resolved.value)),
      ),
      Match.orElse(() => eq(cronRuns.jobId, jobId)),
    )
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(cronRuns)
          .where(whereClause)
          .orderBy(desc(cronRuns.createdAt))
          .limit(1),
      catch: d1Error("db.cronRuns.getLatestRun"),
    })
    return Option.map(Option.fromNullishOr(rows[0]), toCronRun)
  })
}
