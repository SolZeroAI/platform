import { createWorkflowStoreFromD1, type WorkflowRecord } from "../db/workflows"
import { makeControlPlaneFromEnv } from "../../effect/db/control-plane-db"
import { resolveOktaUserId } from "../../lib/better-auth"
import { toError } from "../../lib/effect-errors"
import type { RequestLogger } from "../../effect/services/observability"
import type { Env } from "../types"
import { WorkflowLifecycle } from "./lifecycle"
import type { WorkflowTriggerPayload } from "./runner"
import { handleWorkflowSlackAppRequest } from "./slack-public-router"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"

const WEBHOOK_PATTERN = /^\/workflows\/webhooks\/(?<webhookId>[^/]+)$/

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

function headersToRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries())
}

function appendQueryValue(
  existing: string | string[] | undefined,
  value: string,
): string | string[] {
  return Option.match(
    Option.liftPredicate(
      existing,
      (resolved: string | string[] | undefined): resolved is string[] => Array.isArray(resolved),
    ),
    {
      onNone: () =>
        Match.value(existing).pipe(
          Match.when(Match.string, (existingValue) => [existingValue, value]),
          Match.orElse(() => value),
        ),
      onSome: (values) => [...values, value],
    },
  )
}

function queryToRecord(searchParams: URLSearchParams): Record<string, string | string[]> {
  return Array.from(searchParams.entries()).reduce<Record<string, string | string[]>>(
    (result, [key, value]) => ({
      ...result,
      [key]: appendQueryValue(result[key], value),
    }),
    {},
  )
}

function readWebhookBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? ""
  return Match.value(contentType.includes("application/json")).pipe(
    Match.when(true, () =>
      Effect.tryPromise({
        try: () => request.json().catch(() => null),
        catch: toError,
      }),
    ),
    Match.orElse(() => Effect.tryPromise({ try: () => request.text(), catch: toError })),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function recordKeyCount(value: unknown): number {
  return Match.value(isRecord(value)).pipe(
    Match.when(true, () => Object.keys(value as Record<string, unknown>).length),
    Match.orElse(() => 0),
  )
}

function bodyKind(value: unknown): string {
  return Match.value(Array.isArray(value)).pipe(
    Match.when(true, () => "array"),
    Match.orElse(() => typeof value),
  )
}

type WorkflowPublicRequestOptions = {
  setUserIdentity?: (identity: { userId: string; oktaUserId: string | null }) => void
  setRouteBranch?: (branch: string) => void
  log?: RequestLogger
}

type WebhookWorkflowDecision =
  | { _tag: "reject"; response: Response }
  | { _tag: "accept"; workflow: WorkflowRecord }

function logRejectedWebhook(
  options: WorkflowPublicRequestOptions,
  webhookId: string,
  workflow: WorkflowRecord | null,
) {
  options.log?.warn("workflowWebhookRejected", {
    webhookId,
    workflowFound: Boolean(workflow),
    workflowStatus: workflow?.status ?? null,
  })
  return null
}

function rejectWebhookDecision(
  options: WorkflowPublicRequestOptions,
  webhookId: string,
  workflow: WorkflowRecord | null,
): WebhookWorkflowDecision {
  logRejectedWebhook(options, webhookId, workflow)
  return {
    _tag: "reject",
    response: json({ error: "Workflow webhook not found" }, 404),
  }
}

function resolveWebhookWorkflowDecision(
  options: WorkflowPublicRequestOptions,
  webhookId: string,
  workflow: WorkflowRecord | null,
): WebhookWorkflowDecision {
  return Option.match(
    Option.filter(Option.fromNullishOr(workflow), (candidate) => candidate.status === "active"),
    {
      onNone: () => rejectWebhookDecision(options, webhookId, workflow),
      onSome: (activeWorkflow) => ({
        _tag: "accept",
        workflow: activeWorkflow,
      }),
    },
  )
}

function runWebhookWorkflowDecision(
  decision: WebhookWorkflowDecision,
  request: Request,
  env: Env,
  options: WorkflowPublicRequestOptions,
  url: URL,
  webhookId: string,
) {
  return Match.value(decision).pipe(
    Match.when({ _tag: "reject" }, ({ response }) => Effect.succeed(response)),
    Match.orElse(({ workflow }) =>
      acceptWebhookPublicRequest(request, env, options, url, webhookId, workflow),
    ),
  )
}

const continueAfterSlackRouter = Effect.fn("workflows.handleWebhookPublicRequest")(function* (
  request: Request,
  env: Env,
  options: WorkflowPublicRequestOptions,
) {
  const slackResponse = yield* Effect.tryPromise({
    try: () => handleWorkflowSlackAppRequest(request, env, options),
    catch: toError,
  })
  return yield* Option.match(Option.fromNullishOr(slackResponse), {
    onNone: () => handleWebhookPublicRequest(request, env, options),
    onSome: Effect.succeed,
  })
})

const handleWebhookPublicRequest = Effect.fn("workflows.handleWebhookPublicRequest")(function* (
  request: Request,
  env: Env,
  options: WorkflowPublicRequestOptions,
) {
  const url = new URL(request.url)
  const match = url.pathname.match(WEBHOOK_PATTERN)
  const webhookId = yield* Option.match(Option.fromNullishOr(match?.groups?.webhookId), {
    onNone: () => Effect.succeed(null),
    onSome: Effect.succeed,
  })
  const response = yield* Option.match(Option.fromNullishOr(webhookId), {
    onNone: () => Effect.succeed(null),
    onSome: (resolvedWebhookId) =>
      runWebhookPublicRequest(request, env, options, url, resolvedWebhookId),
  })
  return response
})

const runWebhookPublicRequest = Effect.fn("workflows.runWebhookPublicRequest")(function* (
  request: Request,
  env: Env,
  options: WorkflowPublicRequestOptions,
  url: URL,
  webhookId: string,
) {
  options.setRouteBranch?.("workflow-public")

  const store = createWorkflowStoreFromD1(makeControlPlaneFromEnv(env))
  const workflow = yield* Effect.tryPromise({
    try: () => store.getWorkflowByWebhookId(webhookId),
    catch: toError,
  })
  const decision = resolveWebhookWorkflowDecision(options, webhookId, workflow)
  const response = yield* runWebhookWorkflowDecision(
    decision,
    request,
    env,
    options,
    url,
    webhookId,
  )
  return response
})

const acceptWebhookPublicRequest = Effect.fn("workflows.acceptWebhookPublicRequest")(function* (
  request: Request,
  env: Env,
  options: WorkflowPublicRequestOptions,
  url: URL,
  webhookId: string,
  workflow: WorkflowRecord,
) {
  const userId = workflow.user_id
  const oktaUserId = yield* resolveOktaUserId(env, workflow.user_id).pipe(
    Effect.orElseSucceed(() => null),
  )
  options.setUserIdentity?.({ userId, oktaUserId })
  options.log?.set({
    workflowId: workflow.id,
    webhookId,
    workflowVersion: workflow.manifest_version,
  })

  const trigger: WorkflowTriggerPayload = {
    kind: "webhook",
    payload: {
      body: yield* readWebhookBody(request),
      headers: headersToRecord(request.headers),
      query: queryToRecord(url.searchParams),
    },
  }
  const payload = trigger.payload ?? {}
  options.log?.info("workflowWebhookAccepted", {
    workflowId: workflow.id,
    webhookId,
    workflowVersion: workflow.manifest_version,
    triggerKind: trigger.kind,
    bodyKind: bodyKind(payload.body),
    headerCount: recordKeyCount(payload.headers),
    queryKeyCount: recordKeyCount(payload.query),
    hasOktaUserId: Boolean(oktaUserId),
  })
  const run = yield* new WorkflowLifecycle(env).startWorkflowRun({
    workflow,
    trigger,
    userId,
    oktaUserId,
    log: options.log,
  })
  options.log?.info("workflowWebhookRunStarted", {
    workflowId: workflow.id,
    webhookId,
    workflowVersion: run.workflow_version,
    runId: run.id,
    workflowInstanceId: run.workflow_instance_id,
    runStatus: run.status,
  })
  return json(
    {
      runId: run.id,
      workflowId: workflow.id,
      status: run.status,
    },
    202,
  )
})

const handleWorkflowPublicRequestEffect = Effect.fn("workflows.handlePublicRequest")(
  (request: Request, env: Env, options: WorkflowPublicRequestOptions = {}) =>
    Match.value(request.method).pipe(
      Match.when("POST", () => continueAfterSlackRouter(request, env, options)),
      Match.orElse(() => Effect.succeed(null)),
    ),
)

export function handleWorkflowPublicRequest(
  request: Request,
  env: Env,
  options: WorkflowPublicRequestOptions = {},
): Promise<Response | null> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Worker public-router boundary bridging the Effect webhook handler to the Promise-based request entrypoint.
  return Effect.runPromise(handleWorkflowPublicRequestEffect(request, env, options))
}
