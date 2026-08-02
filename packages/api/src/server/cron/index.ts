import * as Effect from "effect/Effect"
import type { ApiEnv } from "infra/types/env"
import {
  LITELLM_MODEL_SYNC_CRONS,
  runScheduledLitellmSync,
} from "../background/ai-providers/litellm"

function logCron(message: string, annotations?: Record<string, unknown>) {
  return Effect.logInfo(message).pipe(Effect.annotateLogs(annotations ?? {}))
}

const cronEffect = Effect.fn("cron.scheduled")(function* (
  controller: ScheduledController,
  env: ApiEnv,
  ctx: ExecutionContext,
) {
  yield* logCron("Executing cron job", { cron: controller.cron })

  yield* runCronByExpression(controller, env, ctx)

  yield* logCron("Cron job completed", { cron: controller.cron })
})

const cron = (controller: ScheduledController, env: ApiEnv, ctx: ExecutionContext) =>
  // oxlint-disable-next-line effect/effect-run-in-body -- Cloudflare scheduled-handler boundary expects a Promise-returning handler.
  Effect.runPromise(cronEffect(controller, env, ctx))

type CronJobEffect = (
  controller: ScheduledController,
  env: ApiEnv,
  ctx: ExecutionContext,
  // oxlint-disable-next-line c0-lint/no-manual-effect-channels -- Cron dispatch stores heterogeneous Effect jobs in one static map.
) => Effect.Effect<unknown, unknown>

const CRON_JOBS: Record<string, readonly CronJobEffect[]> = {
  ...Object.fromEntries(
    LITELLM_MODEL_SYNC_CRONS.map((cronExpression) => [
      cronExpression,
      [
        (controller: ScheduledController, env: ApiEnv) =>
          runScheduledLitellmSync(env, {
            cron: controller.cron,
            scheduledTime: controller.scheduledTime,
          }).pipe(Effect.annotateLogs({ jobId: "litellm-model-sync" })),
      ] satisfies readonly CronJobEffect[],
    ]),
  ),
}

export const runCronByExpression = Effect.fn("cron.runByExpression")(function* (
  controller: ScheduledController,
  env: ApiEnv,
  ctx: ExecutionContext,
) {
  const jobs = CRON_JOBS[controller.cron] ?? []
  const shouldLogMissing = Effect.succeed(jobs.length === 0)
  const logMissing = logCron("No cron jobs registered", { cron: controller.cron })
  yield* Effect.when(logMissing, shouldLogMissing)
  return yield* Effect.forEach(jobs, (job) => job(controller, env, ctx), {
    concurrency: 1,
  })
})

export default cron
