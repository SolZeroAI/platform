import { generateId } from "../auth/crypto"
import { createWorkflowStoreFromD1 } from "../db/workflows"
import { toError } from "../../lib/effect-errors"
import { resolveOktaUserId } from "../../lib/better-auth"
import type { RequestLogger } from "../../effect/services/observability"
import type { Env } from "../types"
import { executeWorkflowNodeWithAdapters } from "./nodes/registry"
import type { WorkflowActionsEntrypoint, WorkflowTriggerPayload } from "./runner"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"

interface WorkflowNodeExecutionInput {
  workflowId: string
  runId: string
  manifestVersion?: number
  node: {
    id: string
    type: string
    label: string
    options?: Record<string, unknown>
  }
  inputs: Record<string, unknown>
  trigger: WorkflowTriggerPayload
  userId: string
  oktaUserId?: string | null
}

function identityEventData(input: {
  userId: string
  oktaUserId?: string | null
}): Record<string, string> {
  return Option.fromNullishOr(input.oktaUserId).pipe(
    Option.match({
      onNone: () => ({ userId: input.userId }),
      onSome: (oktaUserId) => ({ userId: input.userId, oktaUserId }),
    }),
  )
}

function stringField(
  data: Record<string, unknown> | null | undefined,
  key: string,
): Option.Option<string> {
  const value = data?.[key]
  return Option.liftPredicate(
    value,
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
  )
}

function logActorMismatch(
  log: RequestLogger | undefined,
  input: WorkflowNodeExecutionInput,
  authoritativeUserId: string,
) {
  Match.value(authoritativeUserId !== input.userId).pipe(
    Match.when(true, () =>
      log?.warn("workflow_action.actor_mismatch", {
        workflowId: input.workflowId,
        runId: input.runId,
        suppliedUserId: input.userId,
        authoritativeUserId,
      }),
    ),
    Match.orElse(() => undefined),
  )
  return Effect.void
}

export class WorkflowActionExecutor implements WorkflowActionsEntrypoint {
  constructor(
    private readonly env: Env,
    private readonly log?: RequestLogger,
  ) {}

  executeWorkflowNode(input: WorkflowNodeExecutionInput): Promise<Record<string, unknown>> {
    const store = createWorkflowStoreFromD1(this.env.DB)
    const env = this.env
    const log = this.log
    const execution = Effect.gen(function* () {
      const run = yield* Effect.tryPromise({
        try: () => store.getRun(input.workflowId, input.runId),
        catch: toError,
      }).pipe(
        Effect.filterOrFail(
          (record): record is NonNullable<typeof record> => Boolean(record),
          () => new Error(`Workflow run '${input.runId}' was not found`),
        ),
      )
      yield* Effect.suspend(() => logActorMismatch(log, input, run.user_id))
      const oktaUserId = yield* resolveOktaUserId(env, run.user_id).pipe(
        Effect.orElseSucceed(() => null),
      )
      return yield* Effect.tryPromise({
        try: () =>
          executeWorkflowNodeWithAdapters({
            ...input,
            userId: run.user_id,
            oktaUserId,
            env,
            log,
          }),
        catch: toError,
      })
    })
    // oxlint-disable-next-line effect/effect-run-in-body -- Cloudflare service-binding RPC boundary consumed by dynamic workflow artifacts.
    return Effect.runPromise(execution)
  }

  recordWorkflowEvent(input: {
    workflowId: string
    runId: string
    userId: string
    oktaUserId?: string | null
    nodeId?: string | null
    eventType: string
    level?: "info" | "warn" | "error"
    message: string
    data?: Record<string, unknown> | null
  }): Promise<{ ok: true }> {
    Match.value(input.level).pipe(
      Match.when("error", () =>
        this.log?.error(new Error(input.message), {
          event: "workflowRunEventError",
          workflowId: input.workflowId,
          runId: input.runId,
          nodeId: Option.getOrUndefined(
            Option.orElse(Option.fromNullishOr(input.nodeId), () =>
              stringField(input.data, "nodeId"),
            ),
          ),
          nodeType: Option.getOrUndefined(stringField(input.data, "nodeType")),
          nodeLabel: Option.getOrUndefined(stringField(input.data, "nodeLabel")),
          workflowEventType: input.eventType,
          workflowEventLevel: input.level,
          workflowEventMessage: input.message,
          workflowEventError: Option.getOrUndefined(stringField(input.data, "error")),
        }),
      ),
      Match.orElse(() => undefined),
    )

    const store = createWorkflowStoreFromD1(this.env.DB)
    // oxlint-disable-next-line effect/effect-run-in-body -- Cloudflare service-binding RPC boundary consumed by dynamic workflow artifacts.
    return Effect.runPromise(
      Effect.tryPromise({
        try: () =>
          store.addRunEvent({
            id: `wfe_${generateId(12)}`,
            workflowId: input.workflowId,
            runId: input.runId,
            nodeId: input.nodeId ?? null,
            eventType: input.eventType,
            level: input.level,
            message: input.message,
            data: {
              ...input.data,
              ...identityEventData(input),
            },
            createdAt: Date.now(),
          }),
        catch: toError,
      }).pipe(Effect.map(() => ({ ok: true as const }))),
    )
  }

  completeWorkflowRun(input: {
    workflowId: string
    runId: string
    status: "completed" | "failed"
    output?: Record<string, unknown> | null
    error?: string | null
  }): Promise<{ ok: true }> {
    const store = createWorkflowStoreFromD1(this.env.DB)
    // oxlint-disable-next-line effect/effect-run-in-body -- Cloudflare service-binding RPC boundary consumed by dynamic workflow artifacts.
    return Effect.runPromise(
      Effect.tryPromise({
        try: () =>
          store.completeRun({
            workflowId: input.workflowId,
            runId: input.runId,
            status: input.status,
            output: input.output,
            error: input.error,
            completedAt: Date.now(),
          }),
        catch: toError,
      }).pipe(Effect.map(() => ({ ok: true as const }))),
    )
  }
}
