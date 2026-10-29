import * as Effect from "effect/Effect"
import { runEffectPromise } from "../lib/effect-promise"
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
  runEffectPromise(cronEffect(controller, env, ctx))

// Every cron job gets the scheduled controller, the Worker env, and the execution context.
const litellmModelSyncJob = (
  controller: ScheduledController,
  env: ApiEnv,
  _ctx: ExecutionContext,
) =>
  runScheduledLitellmSync(env, {
    cron: controller.cron,
    scheduledTime: controller.scheduledTime,
  }).pipe(Effect.annotateLogs({ jobId: "litellm-model-sync" }))

const CRON_JOBS = Object.fromEntries(
  LITELLM_MODEL_SYNC_CRONS.map((cronExpression) => [cronExpression, [litellmModelSyncJob]]),
)

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
