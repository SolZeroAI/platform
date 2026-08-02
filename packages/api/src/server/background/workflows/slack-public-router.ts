import { generateId } from "../auth/crypto"
import { describeError, toError } from "../../lib/effect-errors"
import { getLinkedUserIdByProviderAccountId } from "../../lib/better-auth"
import {
  createWorkflowSlackAppStoreFromD1,
  type WorkflowSlackAppRecord,
  type WorkflowSlackAppStorePromise,
} from "../db/workflow-slack-apps"
import { createWorkflowStoreFromD1, type WorkflowRecord } from "../db/workflows"
import type { Env } from "../types"
import { WorkflowLifecycle } from "./lifecycle"
import { getWorkflowSlackAppSecrets } from "./slack-apps"
import {
  computeRegistrationMatchDetails,
  eventPayloadRequiresSlackUser,
  matchesRegistration,
  payloadRequiresSlackUser,
  registrationFilteredLogFields,
} from "./slack-public-router/matching"
import { log } from "./slack-public-router/log"
import {
  buildSetupUrl,
  hydrateChannelName,
  json,
  normalizeSlackCommand,
  normalizeSlackEvent,
  normalizeSlackInteraction,
  readRouteMatch,
  verifySlackSignature,
  type NormalizedSlackPayload,
  type NormalizedSlackResult,
  type ProcessDeliveryParams,
  type ProcessSlackRegistrationInput,
  type SlackAppContext,
  type SlackRegistration,
  type SlackRequestOptions,
  type SlackRouteMatch,
  type SlackRunResult,
  type SlackSurface,
  type SlackWorkflowActor,
  type SlackWorkflowActorResolution,
} from "./slack-public-router/normalization"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"

const resolveLinkedSlackActor = Effect.fn("workflows.slack.resolveLinkedActor")(function* (
  env: Env,
  slackUserId: string,
) {
  const linkedUserId = yield* getLinkedUserIdByProviderAccountId(env, "slack", slackUserId)
  return yield* Option.match(Option.fromNullishOr(linkedUserId), {
    onNone: () =>
      Effect.succeed({
        _tag: "setup_required",
        slackUserId,
        setupUrl: buildSetupUrl(env, slackUserId),
      } satisfies SlackWorkflowActorResolution),
    onSome: (userId) =>
      Effect.succeed({
        _tag: "slack_user",
        userId,
        oktaUserId: null,
      } satisfies SlackWorkflowActorResolution),
  })
})

const resolveSlackWorkflowActor = Effect.fn("workflows.slack.resolveActor")(function* (input: {
  env: Env
  payload: NormalizedSlackPayload
}) {
  return yield* Match.value(payloadRequiresSlackUser(input.payload)).pipe(
    Match.when(false, () =>
      Effect.succeed({ _tag: "workflow_owner" } satisfies SlackWorkflowActorResolution),
    ),
    Match.orElse(() =>
      Option.match(Option.fromNullishOr(input.payload.userId), {
        onNone: () =>
          Effect.succeed({ _tag: "missing_slack_user" } satisfies SlackWorkflowActorResolution),
        onSome: (slackUserId) => resolveLinkedSlackActor(input.env, slackUserId),
      }),
    ),
  )
})

function resolveRunIdentity(input: { workflow: WorkflowRecord; actor: SlackWorkflowActor }): {
  userId: string
  oktaUserId: string | null
} {
  return Match.value(input.actor).pipe(
    Match.tag("slack_user", (actor) => ({
      userId: actor.userId,
      oktaUserId: actor.oktaUserId,
    })),
    Match.orElse(() => ({
      userId: input.workflow.user_id,
      oktaUserId: null,
    })),
  )
}

const startWorkflowForRegistration = Effect.fn("workflows.slack.startWorkflowForRegistration")(
  function* (input: {
    env: Env
    workflow: WorkflowRecord
    payload: NormalizedSlackPayload
    nodeId: string
    deliveryId: string
    store: WorkflowSlackAppStorePromise
    actor: SlackWorkflowActor
    setUserIdentity?: (identity: { userId: string; oktaUserId: string | null }) => void
  }) {
    const identity = resolveRunIdentity({ workflow: input.workflow, actor: input.actor })
    input.setUserIdentity?.(identity)
    return yield* new WorkflowLifecycle(input.env)
      .startWorkflowRun({
        workflow: input.workflow,
        trigger: {
          kind: "slack",
          nodeId: input.nodeId,
          payload: {
            teamId: input.payload.teamId,
            channelId: input.payload.channelId,
            channelName: input.payload.channelName,
            userId: input.payload.userId,
            text: input.payload.text,
            eventType: input.payload.eventType,
            command: input.payload.command,
            messageTs: input.payload.messageTs,
            threadTs: input.payload.threadTs,
            triggerId: input.payload.triggerId,
            actionId: input.payload.actionId,
            responseUrl: input.payload.responseUrl,
            rawPayload: input.payload.rawPayload,
          },
        },
        userId: identity.userId,
        oktaUserId: identity.oktaUserId,
      })
      .pipe(
        Effect.tap((run) =>
          Effect.tryPromise({
            try: () =>
              input.store.updateDelivery({
                id: input.deliveryId,
                runId: run.id,
                status: "started",
                updatedAt: Date.now(),
              }),
            catch: toError,
          }),
        ),
        Effect.map(
          (run): SlackRunResult => ({
            runId: run.id,
            workflowId: input.workflow.id,
            nodeId: input.nodeId,
            status: run.status,
          }),
        ),
        Effect.catch((error) =>
          Effect.gen(function* () {
            const message = describeError(error)
            yield* Effect.tryPromise({
              try: () =>
                input.store.updateDelivery({
                  id: input.deliveryId,
                  status: "failed",
                  error: message,
                  updatedAt: Date.now(),
                }),
              catch: toError,
            })
            return {
              workflowId: input.workflow.id,
              nodeId: input.nodeId,
              status: "failed",
            } satisfies SlackRunResult
          }),
        ),
      )
  },
)

function duplicateDeliveryResult(params: ProcessDeliveryParams): SlackRunResult {
  return {
    runId: params.delivery.delivery.run_id ?? undefined,
    workflowId: params.input.registration.workflow_id,
    nodeId: params.input.registration.node_id,
    status: "duplicate",
  }
}

const markCooldownDelivery = Effect.fn("workflows.slack.markCooldownDelivery")(function* (
  params: ProcessDeliveryParams,
) {
  yield* Effect.tryPromise({
    try: () =>
      params.slackStore.updateDelivery({
        id: params.delivery.delivery.id,
        status: "ignored",
        error: "Slack trigger cooldown is active",
        updatedAt: Date.now(),
      }),
    catch: toError,
  })
  return Option.some({
    workflowId: params.input.registration.workflow_id,
    nodeId: params.input.registration.node_id,
    status: "cooldown",
  } satisfies SlackRunResult)
})

const checkRecentDelivery = Effect.fn("workflows.slack.checkRecentDelivery")(function* (
  params: ProcessDeliveryParams,
) {
  const recent = yield* Effect.tryPromise({
    try: () =>
      params.slackStore.getRecentDeliveryForNode({
        slackAppId: params.input.appId,
        nodeId: params.input.registration.node_id,
        since: params.now - params.input.registration.cooldown_seconds * 1000,
        excludeDeliveryId: params.delivery.delivery.id,
      }),
    catch: toError,
  })
  return yield* Option.match(Option.fromNullishOr(recent), {
    onNone: () => Effect.succeed(Option.none<SlackRunResult>()),
    onSome: () => markCooldownDelivery(params),
  })
})

const checkCooldown = Effect.fn("workflows.slack.checkCooldown")(function* (
  params: ProcessDeliveryParams,
) {
  return yield* Match.value(params.input.registration.cooldown_seconds > 0).pipe(
    Match.when(false, () => Effect.succeed(Option.none<SlackRunResult>())),
    Match.orElse(() => checkRecentDelivery(params)),
  )
})

const markInactiveWorkflow = Effect.fn("workflows.slack.markInactiveWorkflow")(function* (
  params: ProcessDeliveryParams,
) {
  yield* Effect.tryPromise({
    try: () =>
      params.slackStore.updateDelivery({
        id: params.delivery.delivery.id,
        status: "ignored",
        error: "Workflow is not active",
        updatedAt: Date.now(),
      }),
    catch: toError,
  })
  return {
    workflowId: params.input.registration.workflow_id,
    nodeId: params.input.registration.node_id,
    status: "ignored",
  } satisfies SlackRunResult
})

const runWorkflowForDelivery = Effect.fn("workflows.slack.runWorkflowForDelivery")(function* (
  params: ProcessDeliveryParams,
) {
  const workflow = yield* Effect.tryPromise({
    try: () => params.workflowStore.getWorkflow(params.input.registration.workflow_id),
    catch: toError,
  })
  return yield* Option.match(
    Option.filter(Option.fromNullishOr(workflow), (resolved) => resolved.status === "active"),
    {
      onNone: () => markInactiveWorkflow(params),
      onSome: (active) =>
        startWorkflowForRegistration({
          env: params.input.env,
          workflow: active,
          payload: params.input.payload,
          nodeId: params.input.registration.node_id,
          deliveryId: params.delivery.delivery.id,
          store: params.slackStore,
          actor: params.input.actor,
          setUserIdentity: params.input.setUserIdentity,
        }),
    },
  )
})

const processCreatedDelivery = Effect.fn("workflows.slack.processCreatedDelivery")(function* (
  params: ProcessDeliveryParams,
) {
  const cooldownResult = yield* checkCooldown(params)
  return yield* Option.match(cooldownResult, {
    onNone: () => runWorkflowForDelivery(params),
    onSome: (result) => Effect.succeed(result),
  })
})

const processSlackRegistration = Effect.fn("workflows.slack.processRegistration")(function* (
  input: ProcessSlackRegistrationInput,
) {
  const slackStore = createWorkflowSlackAppStoreFromD1(input.env.DB)
  const workflowStore = createWorkflowStoreFromD1(input.env.DB)
  const now = Date.now()
  const delivery = yield* Effect.tryPromise({
    try: () =>
      slackStore.createDeliveryIfAbsent({
        id: `wsd_${generateId(12)}`,
        slackAppId: input.appId,
        workflowId: input.registration.workflow_id,
        nodeId: input.registration.node_id,
        deliveryKey: input.payload.deliveryKey,
        surface: input.payload.surface,
        status: "received",
        dedupeWindowSeconds: input.registration.dedupe_window_seconds,
        now,
      }),
    catch: toError,
  })
  const params: ProcessDeliveryParams = { input, slackStore, workflowStore, delivery, now }
  return yield* Match.value(delivery.created).pipe(
    Match.when(false, () => Effect.succeed(duplicateDeliveryResult(params))),
    Match.orElse(() => processCreatedDelivery(params)),
  )
})

function setupRequiredRuns(input: {
  registrations: SlackRegistration[]
  slackUserId: string
  setupUrl: string
}): SlackRunResult[] {
  return Arr.map(input.registrations, (registration) => ({
    workflowId: registration.workflow_id,
    nodeId: registration.node_id,
    status: "setup_required",
    error: "Slack user is not linked to a c0 account",
    slackUserId: input.slackUserId,
    setupUrl: input.setupUrl,
  }))
}

function missingSlackUserRuns(registrations: SlackRegistration[]): SlackRunResult[] {
  return Arr.map(registrations, (registration) => ({
    workflowId: registration.workflow_id,
    nodeId: registration.node_id,
    status: "ignored",
    error: "Slack request did not include a user id",
  }))
}

const processRegistrationsWithActor = Effect.fn("workflows.slack.processRegistrationsWithActor")(
  function* (input: {
    env: Env
    appId: string
    payload: NormalizedSlackPayload
    commandId?: string
    registrations: SlackRegistration[]
    actor: SlackWorkflowActor
    setUserIdentity?: (identity: { userId: string; oktaUserId: string | null }) => void
  }) {
    return yield* Effect.forEach(input.registrations, (registration) =>
      processSlackRegistration({
        env: input.env,
        appId: input.appId,
        payload: input.payload,
        commandId: input.commandId,
        registration,
        actor: input.actor,
        setUserIdentity: input.setUserIdentity,
      }),
    )
  },
)

const startSlackWorkflowRuns = Effect.fn("workflows.slack.startRuns")(function* (input: {
  env: Env
  appId: string
  payload: NormalizedSlackPayload
  commandId?: string
  setUserIdentity?: (identity: { userId: string; oktaUserId: string | null }) => void
}) {
  const slackStore = createWorkflowSlackAppStoreFromD1(input.env.DB)
  const registrations = yield* Effect.tryPromise({
    try: () =>
      slackStore.listEnabledRegistrationsForApp({
        slackAppId: input.appId,
        surface: input.payload.surface,
      }),
    catch: toError,
  })
  yield* log("slack.registrations.listed", {
    appId: input.appId,
    surface: input.payload.surface,
    count: registrations.length,
    nodeIds: registrations.map((r) => r.node_id),
  })
  const registrationDetails = Arr.map(registrations, (registration) =>
    computeRegistrationMatchDetails({
      payload: input.payload,
      registration,
      commandId: input.commandId,
    }),
  )
  const matchingRegistrations = Arr.map(
    Arr.filter(registrationDetails, (details) => details.matched),
    (details) => details.registration,
  )
  yield* Effect.forEach(
    Arr.filter(registrationDetails, (details) => !details.matched),
    (details) =>
      log("slack.registration.filtered", registrationFilteredLogFields(details, input.payload)),
  )
  yield* log("slack.registrations.matched", {
    appId: input.appId,
    count: matchingRegistrations.length,
    nodeIds: matchingRegistrations.map((r) => r.node_id),
  })
  const shouldResolveActor = Effect.succeed(matchingRegistrations.length > 0)
  const actorOption = yield* resolveSlackWorkflowActor({
    env: input.env,
    payload: input.payload,
  }).pipe(Effect.when(shouldResolveActor))
  return yield* Option.match(actorOption, {
    onNone: () => Effect.succeed([] as SlackRunResult[]),
    onSome: (actor) =>
      Match.value(actor).pipe(
        Match.tag("setup_required", (setup) =>
          Effect.succeed(
            setupRequiredRuns({
              registrations: matchingRegistrations,
              slackUserId: setup.slackUserId,
              setupUrl: setup.setupUrl,
            }),
          ),
        ),
        Match.tag("missing_slack_user", () =>
          Effect.succeed(missingSlackUserRuns(matchingRegistrations)),
        ),
        Match.orElse((resolvedActor) =>
          processRegistrationsWithActor({
            env: input.env,
            appId: input.appId,
            payload: input.payload,
            commandId: input.commandId,
            registrations: matchingRegistrations,
            actor: resolvedActor,
            setUserIdentity: input.setUserIdentity,
          }),
        ),
      ),
  })
})

function buildSlackResponse(surface: SlackSurface, runs: SlackRunResult[]): Response {
  const setupRequired = Arr.findFirst(runs, (run) => run.status === "setup_required")
  const matchedText = Option.match(setupRequired, {
    onSome: (run) => `Link your Slack account to c0 before using this workflow: ${run.setupUrl}`,
    onNone: () =>
      Match.value(runs.length > 0).pipe(
        Match.when(true, () => "Queued c0 workflow run."),
        Match.orElse(() => "No c0 workflow matched this request."),
      ),
  })
  const setupFields = Option.match(setupRequired, {
    onNone: () => ({}),
    onSome: (run) => ({
      error: run.error,
      setupUrl: run.setupUrl,
      slackUserId: run.slackUserId,
    }),
  })
  return Match.value(surface === "command" || surface === "interaction").pipe(
    Match.when(true, () =>
      json({
        response_type: "ephemeral",
        text: matchedText,
        ok: true,
        runs,
        ...setupFields,
      }),
    ),
    Match.orElse(() => json({ ok: true, runs, ...setupFields })),
  )
}

const runSlackWorkflowsForPayload = Effect.fn("workflows.slack.runWorkflowsForPayload")(function* (
  ctx: SlackAppContext,
  payload: NormalizedSlackPayload,
) {
  const hydrated = yield* hydrateChannelName({ payload, botToken: ctx.secrets.botToken })
  yield* log("slack.dispatch", {
    appId: ctx.route.appId,
    surface: hydrated.surface,
    eventType: hydrated.eventType,
    channelId: hydrated.channelId,
    channelName: hydrated.channelName,
    hasMatchingPatternExpectations: true,
  })
  const runs = yield* startSlackWorkflowRuns({
    env: ctx.env,
    appId: ctx.route.appId,
    payload: hydrated,
    commandId: ctx.route.commandId,
    setUserIdentity: ctx.options.setUserIdentity,
  })
  yield* log("slack.response", {
    appId: ctx.route.appId,
    runCount: runs.length,
    statuses: runs.map((r) => r.status),
  })
  return buildSlackResponse(ctx.route.surface, runs)
})

const dispatchSlackPayload = Effect.fn("workflows.slack.dispatchPayload")(function* (
  ctx: SlackAppContext,
  payload: NormalizedSlackPayload | null,
) {
  return yield* Option.match(Option.fromNullishOr(payload), {
    onNone: () => Effect.succeed(json({ ok: true })),
    onSome: (resolved) => runSlackWorkflowsForPayload(ctx, resolved),
  })
})

const normalizeSlackRequest = Effect.fn("workflows.slack.normalizeRequest")(function* (
  ctx: SlackAppContext,
  body: string,
) {
  const normalized: NormalizedSlackResult = yield* Match.value(ctx.route.surface).pipe(
    Match.when("event", () => normalizeSlackEvent(body)),
    Match.when("command", () => normalizeSlackCommand(body, ctx.route.commandId)),
    Match.orElse(() => normalizeSlackInteraction(body)),
  )
  return yield* Option.match(Option.fromNullishOr(normalized.response), {
    onSome: (response) => Effect.succeed(response),
    onNone: () => dispatchSlackPayload(ctx, normalized.payload),
  })
})

const verifySlackRequest = Effect.fn("workflows.slack.verifyRequest")(function* (
  ctx: SlackAppContext,
  signingSecret: string,
) {
  const body = yield* Effect.tryPromise({
    try: () => ctx.request.text(),
    catch: toError,
  })
  const signatureError = yield* verifySlackSignature({
    request: ctx.request,
    body,
    signingSecret,
  })
  return yield* Option.match(Option.fromNullishOr(signatureError), {
    onNone: () => normalizeSlackRequest(ctx, body),
    onSome: (error) => Effect.succeed(error),
  })
})

const loadSlackSecrets = Effect.fn("workflows.slack.loadSecrets")(function* (
  request: Request,
  env: Env,
  options: SlackRequestOptions,
  route: SlackRouteMatch,
  app: WorkflowSlackAppRecord,
) {
  const secrets = yield* getWorkflowSlackAppSecrets({ env, app })
  const ctx: SlackAppContext = { request, env, options, route, secrets }
  return yield* Option.match(Option.fromNullishOr(secrets.signingSecret), {
    onNone: () =>
      Effect.succeed(json({ error: "Workflow Slack app signing secret is not configured" }, 500)),
    onSome: (signingSecret) => verifySlackRequest(ctx, signingSecret),
  })
})

const loadSlackApp = Effect.fn("workflows.slack.loadApp")(function* (
  request: Request,
  env: Env,
  options: SlackRequestOptions,
  route: SlackRouteMatch,
) {
  const app = yield* Effect.tryPromise({
    try: () => createWorkflowSlackAppStoreFromD1(env.DB).getAppById(route.appId),
    catch: toError,
  })
  return yield* Option.match(Option.fromNullishOr(app), {
    onNone: () => Effect.succeed(json({ error: "Workflow Slack app not found" }, 404)),
    onSome: (resolved) => loadSlackSecrets(request, env, options, route, resolved),
  })
})

const routeSlackRequest = Effect.fn("workflows.slack.routeRequest")(function* (
  request: Request,
  env: Env,
  options: SlackRequestOptions,
) {
  const url = new URL(request.url)
  return yield* Option.match(readRouteMatch(url.pathname), {
    onNone: () => Effect.succeed(null as Response | null),
    onSome: (route) => loadSlackApp(request, env, options, route),
  })
})

const handleWorkflowSlackAppRequestEffect = Effect.fn("workflows.slack.handleRequest")(function* (
  request: Request,
  env: Env,
  options: SlackRequestOptions = {},
) {
  return yield* Match.value(request.method === "POST").pipe(
    Match.when(false, () => Effect.succeed(null as Response | null)),
    Match.orElse(() => routeSlackRequest(request, env, options)),
  )
})

export function handleWorkflowSlackAppRequest(
  request: Request,
  env: Env,
  options: {
    setUserIdentity?: (identity: { userId: string; oktaUserId: string | null }) => void
  } = {},
): Promise<Response | null> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Worker public-router boundary bridging the Effect Slack handler to the Promise-based request entrypoint.
  return Effect.runPromise(handleWorkflowSlackAppRequestEffect(request, env, options))
}
