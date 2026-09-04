import type { WorkflowManifest, WorkflowManifestNode } from "@solzero/shared"
import { generateId } from "../auth/crypto"
import { parseJson } from "../../lib/json"
import { toError } from "../../lib/effect-errors"
import { createGlobalSecretsStoreFromD1 } from "../db/repo-secrets"
import { makeControlPlaneFromEnv } from "../../effect/db/control-plane-db"
import {
  createWorkflowSlackAppStoreFromD1,
  type UpsertWorkflowSlackTriggerRegistrationInput,
  type WorkflowSlackAppRecord,
  type WorkflowSlackTriggerRegistrationRecord,
  type WorkflowSlackTriggerSurface,
} from "../db/workflow-slack-apps"
import type { WorkflowRecord } from "../db/workflows"
import type { Env } from "../types"
import { getString } from "./nodes/common"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

const WORKFLOW_SLACK_SECRET_PREFIX = "workflow_slack_apps"
const DEFAULT_SLACK_EVENT_TYPES = ["app_mention", "message"]
const DEFAULT_DEDUPE_WINDOW_SECONDS = 300
const SLACK_MESSAGE_BOT_EVENT_TYPES = [
  "message.channels",
  "message.groups",
  "message.im",
  "message.mpim",
] as const
const BASE_SLACK_BOT_SCOPES = [
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "chat:write",
  "channels:join",
  "channels:read",
  "groups:read",
  "reactions:write",
] as const
const SLACK_EVENT_REQUIRED_BOT_SCOPES: Record<string, readonly string[]> = {
  app_mention: ["app_mentions:read"],
  channel_created: ["channels:read"],
  "message.channels": ["channels:history"],
  "message.groups": ["groups:history"],
  "message.im": ["im:history"],
  "message.mpim": ["mpim:history"],
}

/**
 * Recoverable failure raised while provisioning or resolving a workflow Slack app (missing
 * encryption key, missing app, missing bot token). Tagged so callers can `catchTag` precisely while
 * surfacing the `message` on the run.
 */
export class WorkflowSlackAppError extends Schema.TaggedError<WorkflowSlackAppError>()(
  "WorkflowSlackAppError",
  {
    message: Schema.String,
  },
) {}

const slackAppFail = (message: string) => Effect.fail(new WorkflowSlackAppError({ message }))

type WorkflowSlackAppStore = ReturnType<typeof createWorkflowSlackAppStoreFromD1>

interface ManifestValidationParts {
  errors: string[]
  warnings: string[]
}

export interface WorkflowSlackRequestUrls {
  events: string
  interactions: string
  commands: Record<string, string>
}

export interface WorkflowSlackManifestValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface WorkflowSlackAppSetup {
  app: WorkflowSlackAppRecord
  requestUrls: WorkflowSlackRequestUrls
  manifest: Record<string, unknown>
  validation: WorkflowSlackManifestValidation
  registrations: WorkflowSlackTriggerRegistrationRecord[]
  status: {
    hasSigningSecret: boolean
    hasBotToken: boolean
  }
}

export interface NormalizedSlackTriggerNode {
  node: WorkflowManifestNode
  surface: WorkflowSlackTriggerSurface
  commandName: string | null
  commandDescription: string
  eventTypes: string[]
  channelNamePattern: string | null
  keywordRules: string[]
  actionIds: string[]
  cooldownSeconds: number
  dedupeWindowSeconds: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return Match.value(isRecord(value)).pipe(
    Match.when(true, () => value as Record<string, unknown>),
    Match.orElse(() => ({}) as Record<string, unknown>),
  )
}

function readString(value: unknown, fallback = ""): string {
  return Option.getOrElse(getString(value), () => fallback)
}

function readStringArray(value: unknown): string[] {
  return Match.value(Array.isArray(value)).pipe(
    Match.when(true, () =>
      Arr.filterMap(value as readonly unknown[], (item) =>
        Result.fromOption(
          Option.filter(getString(item), (stringValue) => stringValue.length > 0),
          () => undefined,
        ),
      ),
    ),
    Match.orElse((): string[] => []),
  )
}

function readNonNegativeInteger(value: unknown, fallback: number): number {
  const numberValue = Match.value(value).pipe(
    Match.when(Match.number, (resolved) => resolved),
    Match.orElse(() =>
      Option.match(getString(value), {
        onNone: () => Number.NaN,
        onSome: (stringValue) => Number(stringValue),
      }),
    ),
  )
  return Match.value(Number.isInteger(numberValue) && numberValue >= 0).pipe(
    Match.when(true, () => numberValue),
    Match.orElse(() => fallback),
  )
}

function normalizeSlackTriggerSurface(value: unknown): WorkflowSlackTriggerSurface {
  return Match.value(value).pipe(
    Match.when("command", () => "command" as const),
    Match.when("interaction", () => "interaction" as const),
    Match.when("event", () => "event" as const),
    Match.orElse(() => "event" as const),
  )
}

function normalizeSlackCommandName(value: unknown): Option.Option<string> {
  const command = readString(value)
  return Match.value(command.length === 0).pipe(
    Match.when(true, () => Option.none<string>()),
    Match.orElse(() =>
      Option.some(
        Match.value(command.startsWith("/")).pipe(
          Match.when(true, () => command),
          Match.orElse(() => `/${command}`),
        ),
      ),
    ),
  )
}

function toSlackManifestBotEventTypes(eventTypes: string[]): string[] {
  const manifestEventTypes = Arr.flatMap(eventTypes, (eventType) =>
    Match.value(eventType).pipe(
      Match.when("message", () => [...SLACK_MESSAGE_BOT_EVENT_TYPES]),
      Match.orElse(() => [eventType]),
    ),
  )
  return Array.from(new Set(manifestEventTypes))
}

function botScopesForManifest(input: {
  eventTypes: string[]
  commandTriggers: NormalizedSlackTriggerNode[]
}): string[] {
  const scopes = new Set<string>(BASE_SLACK_BOT_SCOPES)
  Arr.forEach(
    Arr.flatMap(input.eventTypes, (eventType) => SLACK_EVENT_REQUIRED_BOT_SCOPES[eventType] ?? []),
    (scope) => {
      scopes.add(scope)
    },
  )
  Match.value(input.commandTriggers.length > 0).pipe(
    Match.when(true, () => {
      scopes.add("commands")
    }),
    Match.orElse(() => undefined),
  )
  return Array.from(scopes)
}

function normalizeSlackTriggerNode(node: WorkflowManifestNode): NormalizedSlackTriggerNode {
  const options = recordOrEmpty(node.options)
  const surface = normalizeSlackTriggerSurface(options.surface)
  const eventTypes = Match.value(surface).pipe(
    Match.when("event", () => readStringArray(options.eventTypes)),
    Match.orElse(() => DEFAULT_SLACK_EVENT_TYPES),
  )
  const commandName = Match.value(surface).pipe(
    Match.when("command", () =>
      Option.getOrElse(normalizeSlackCommandName(options.command), () => "/s0"),
    ),
    Match.orElse(() => null),
  )
  const resolvedEventTypes = Match.value(eventTypes.length > 0).pipe(
    Match.when(true, () => eventTypes),
    Match.orElse(() => DEFAULT_SLACK_EVENT_TYPES),
  )
  return {
    node,
    surface,
    commandName,
    commandDescription: readString(options.commandDescription, "Run s0 from Slack"),
    eventTypes: resolvedEventTypes,
    channelNamePattern: readString(options.channelNamePattern) || null,
    keywordRules: readStringArray(options.keywordRules),
    actionIds: readStringArray(options.actionIds),
    cooldownSeconds: readNonNegativeInteger(options.cooldownSeconds, 0),
    dedupeWindowSeconds: readNonNegativeInteger(
      options.dedupeWindowSeconds,
      DEFAULT_DEDUPE_WINDOW_SECONDS,
    ),
  }
}

export function getSlackTriggerNodes(manifest: WorkflowManifest): NormalizedSlackTriggerNode[] {
  return Arr.map(
    Arr.filter(manifest.nodes, (node) => node.type === "slack-trigger"),
    (node) => normalizeSlackTriggerNode(node),
  )
}

function signingSecretKey(appId: string): string {
  return `${WORKFLOW_SLACK_SECRET_PREFIX}_${appId}_signing_secret`
}

function botTokenSecretKey(appId: string): string {
  return `${WORKFLOW_SLACK_SECRET_PREFIX}_${appId}_bot_token`
}

export function buildWorkflowSlackRequestUrls(input: {
  serverUrl: string
  appId: string
  commandIds?: string[]
}): WorkflowSlackRequestUrls {
  const appPath = `/workflows/slack-apps/${encodeURIComponent(input.appId)}`

  return {
    events: new URL(`${appPath}/events`, input.serverUrl).toString(),
    interactions: new URL(`${appPath}/interactions`, input.serverUrl).toString(),
    commands: Object.fromEntries(
      Arr.map(input.commandIds ?? [], (commandId) => [
        commandId,
        new URL(`${appPath}/commands/${encodeURIComponent(commandId)}`, input.serverUrl).toString(),
      ]),
    ),
  }
}

export function buildSlackManifest(input: {
  appName: string
  requestUrls: WorkflowSlackRequestUrls
  triggers: NormalizedSlackTriggerNode[]
}): Record<string, unknown> {
  const eventTypes = toSlackManifestBotEventTypes(
    Arr.flatMap(
      Arr.filter(
        input.triggers,
        (trigger: NormalizedSlackTriggerNode) => trigger.surface === "event",
      ),
      (trigger: NormalizedSlackTriggerNode) => trigger.eventTypes,
    ),
  )
  const commandTriggers = Arr.filter(
    input.triggers,
    (trigger: NormalizedSlackTriggerNode) => trigger.surface === "command",
  )
  const hasInteractionTriggers = Arr.some(
    input.triggers,
    (trigger: NormalizedSlackTriggerNode) => trigger.surface === "interaction",
  )
  const features: Record<string, unknown> = {
    bot_user: {
      display_name: input.appName,
      always_online: false,
    },
  }
  Match.value(commandTriggers.length > 0).pipe(
    Match.when(true, () => {
      features.slash_commands = Arr.map(commandTriggers, (trigger) => ({
        command: trigger.commandName ?? "/s0",
        description: trigger.commandDescription,
        url: input.requestUrls.commands[trigger.node.id],
        should_escape: false,
      }))
    }),
    Match.orElse(() => undefined),
  )
  const botScopes = botScopesForManifest({ eventTypes, commandTriggers })
  const settings: Record<string, unknown> = {
    org_deploy_enabled: false,
    socket_mode_enabled: false,
    token_rotation_enabled: false,
  }
  Match.value(eventTypes.length > 0).pipe(
    Match.when(true, () => {
      settings.event_subscriptions = {
        request_url: input.requestUrls.events,
        bot_events: eventTypes,
      }
    }),
    Match.orElse(() => undefined),
  )
  Match.value(hasInteractionTriggers).pipe(
    Match.when(true, () => {
      settings.interactivity = {
        is_enabled: true,
        request_url: input.requestUrls.interactions,
      }
    }),
    Match.orElse(() => undefined),
  )

  return {
    display_information: {
      name: input.appName,
    },
    features,
    oauth_config: {
      scopes: {
        bot: botScopes,
      },
    },
    settings,
  }
}

function readRecord(value: unknown): Option.Option<Record<string, unknown>> {
  return Match.value(isRecord(value)).pipe(
    Match.when(true, () => Option.some(value as Record<string, unknown>)),
    Match.orElse(() => Option.none<Record<string, unknown>>()),
  )
}

function readManifestStringArray(value: unknown): Option.Option<string[]> {
  return Match.value(Array.isArray(value)).pipe(
    Match.when(true, () =>
      Match.value((value as unknown[]).every((item) => typeof item === "string")).pipe(
        Match.when(true, () => Option.some(value as string[])),
        Match.orElse(() => Option.none<string[]>()),
      ),
    ),
    Match.orElse(() => Option.none<string[]>()),
  )
}

function readManifestBotScopes(manifest: Record<string, unknown>): string[] {
  return Option.getOrElse(
    Option.flatMap(
      Option.flatMap(readRecord(manifest.oauth_config), (oauthConfig) =>
        readRecord(oauthConfig.scopes),
      ),
      (scopes) => readManifestStringArray(scopes.bot),
    ),
    () => [],
  )
}

function validateNonEmptySlashCommands(commands: unknown[], botScopeSet: Set<string>): string[] {
  return Match.value(commands.length === 0).pipe(
    Match.when(true, () => [
      "features.slash_commands must be omitted when there are no slash commands.",
    ]),
    Match.orElse(() =>
      Match.value(botScopeSet.has("commands")).pipe(
        Match.when(false, () => ["features.slash_commands requires the commands bot scope."]),
        Match.orElse(() => [] as string[]),
      ),
    ),
  )
}

function validateSlashCommands(
  slashCommands: Option.Option<unknown>,
  botScopeSet: Set<string>,
): string[] {
  return Option.match(slashCommands, {
    onNone: () => [],
    onSome: (value) =>
      Match.value(value).pipe(
        Match.when(
          (candidate: unknown): candidate is unknown[] => Array.isArray(candidate),
          (commands) => validateNonEmptySlashCommands(commands, botScopeSet),
        ),
        Match.orElse(() => ["features.slash_commands must be an array when present."]),
      ),
  })
}

function validateMappedBotEvent(
  eventType: string,
  botScopeSet: Set<string>,
): ManifestValidationParts {
  return Option.match(Option.fromNullishOr(SLACK_EVENT_REQUIRED_BOT_SCOPES[eventType]), {
    onNone: () => ({
      errors: [],
      warnings: [`No local Slack scope mapping for event ${eventType}.`],
    }),
    onSome: (requiredScopes) => ({
      errors: Arr.filterMap(requiredScopes, (requiredScope) =>
        Match.value(botScopeSet.has(requiredScope)).pipe(
          Match.when(false, () =>
            Result.succeed(`Event ${eventType} requires bot scope ${requiredScope}.`),
          ),
          Match.orElse(() => Result.failVoid),
        ),
      ),
      warnings: [],
    }),
  })
}

function validateBotEvent(eventType: string, botScopeSet: Set<string>): ManifestValidationParts {
  return Match.value(eventType).pipe(
    Match.when("message", () => ({
      errors: [
        "settings.event_subscriptions.bot_events cannot include message; use message.channels, message.groups, message.im, or message.mpim.",
      ],
      warnings: [] as string[],
    })),
    Match.orElse(() => validateMappedBotEvent(eventType, botScopeSet)),
  )
}

function aggregateBotEventResults(
  events: string[],
  botScopeSet: Set<string>,
): ManifestValidationParts {
  const results = Arr.map(events, (eventType) => validateBotEvent(eventType, botScopeSet))
  return {
    errors: Arr.flatMap(results, (result) => result.errors),
    warnings: Arr.flatMap(results, (result) => result.warnings),
  }
}

function validatePresentBotEvents(
  events: string[],
  botScopeSet: Set<string>,
): ManifestValidationParts {
  return Match.value(events.length === 0).pipe(
    Match.when(true, () => ({
      errors: ["settings.event_subscriptions.bot_events must be omitted when empty."],
      warnings: [] as string[],
    })),
    Match.orElse(() => aggregateBotEventResults(events, botScopeSet)),
  )
}

function validateBotEvents(
  botEvents: Option.Option<string[]>,
  botScopeSet: Set<string>,
): ManifestValidationParts {
  return Option.match(botEvents, {
    onNone: () => ({
      errors: ["settings.event_subscriptions.bot_events must be a string array."],
      warnings: [],
    }),
    onSome: (events) => validatePresentBotEvents(events, botScopeSet),
  })
}

function validateEventSubscription(
  subscription: Record<string, unknown>,
  botScopeSet: Set<string>,
): ManifestValidationParts {
  const urlErrors = Match.value(readString(subscription.request_url).length === 0).pipe(
    Match.when(true, () => ["settings.event_subscriptions.request_url is required."]),
    Match.orElse(() => [] as string[]),
  )
  const botEventsResult = validateBotEvents(
    readManifestStringArray(subscription.bot_events),
    botScopeSet,
  )
  return {
    errors: [...urlErrors, ...botEventsResult.errors],
    warnings: botEventsResult.warnings,
  }
}

function validateEventSubscriptions(
  eventSubscriptions: Option.Option<Record<string, unknown>>,
  botScopeSet: Set<string>,
): ManifestValidationParts {
  return Option.match(eventSubscriptions, {
    onNone: () => ({ errors: [], warnings: [] }),
    onSome: (subscription) => validateEventSubscription(subscription, botScopeSet),
  })
}

function validateInteractivity(interactivity: Option.Option<Record<string, unknown>>): string[] {
  return Option.match(interactivity, {
    onNone: () => [],
    onSome: (value) =>
      Match.value(readString(value.request_url).length === 0).pipe(
        Match.when(true, () => [
          "settings.interactivity.request_url is required when interactivity is enabled.",
        ]),
        Match.orElse(() => [] as string[]),
      ),
  })
}

export function validateWorkflowSlackManifest(
  manifest: Record<string, unknown>,
): WorkflowSlackManifestValidation {
  const botScopeSet = new Set(readManifestBotScopes(manifest))
  const features = readRecord(manifest.features)
  const settings = readRecord(manifest.settings)
  const slashCommands = Option.flatMap(features, (resolved) =>
    Option.fromNullishOr(resolved.slash_commands),
  )
  const eventSubscriptions = Option.flatMap(settings, (resolved) =>
    readRecord(resolved.event_subscriptions),
  )
  const interactivity = Option.flatMap(settings, (resolved) => readRecord(resolved.interactivity))

  const eventResult = validateEventSubscriptions(eventSubscriptions, botScopeSet)
  const errors = [
    ...validateSlashCommands(slashCommands, botScopeSet),
    ...eventResult.errors,
    ...validateInteractivity(interactivity),
  ]
  const warnings = eventResult.warnings

  return { valid: errors.length === 0, errors, warnings }
}

function requireGlobalSecretsStore(env: Env) {
  return Option.match(Option.fromNullishOr(env.REPO_SECRETS_ENCRYPTION_KEY), {
    onNone: () => slackAppFail("REPO_SECRETS_ENCRYPTION_KEY not configured"),
    onSome: (encryptionKey) =>
      Effect.succeed(createGlobalSecretsStoreFromD1(makeControlPlaneFromEnv(env), encryptionKey)),
  })
}

const updateSlackAppName = Effect.fn("workflows.updateSlackAppName")(function* (
  store: WorkflowSlackAppStore,
  existing: WorkflowSlackAppRecord,
  appName: string,
  now: number,
) {
  const updated = yield* Effect.tryPromise({
    try: () =>
      store.updateAppMetadata({
        appId: existing.id,
        appName,
        updatedAt: now,
      }),
    catch: toError,
  })
  return updated ?? existing
})

const maybeUpdateSlackApp = Effect.fn("workflows.maybeUpdateSlackApp")(function* (
  input: { appName?: string; now?: number },
  store: WorkflowSlackAppStore,
  existing: WorkflowSlackAppRecord,
) {
  const nextName = input.appName?.trim()
  return yield* Match.value(Boolean(nextName && nextName !== existing.app_name)).pipe(
    Match.when(true, () =>
      updateSlackAppName(store, existing, nextName as string, input.now ?? Date.now()),
    ),
    Match.orElse(() => Effect.succeed(existing)),
  )
})

const createNewSlackApp = Effect.fn("workflows.createNewSlackApp")(function* (
  input: { workflow: WorkflowRecord; appName?: string; now?: number },
  store: WorkflowSlackAppStore,
) {
  const appId = `wsa_${generateId(12)}`
  const appName = input.appName?.trim() || `${input.workflow.name} s0`
  return yield* Effect.tryPromise({
    try: () =>
      store.createApp({
        id: appId,
        workflowId: input.workflow.id,
        userId: input.workflow.user_id,
        appName,
        signingSecretKey: signingSecretKey(appId),
        botTokenSecretKey: botTokenSecretKey(appId),
        now: input.now ?? Date.now(),
      }),
    catch: toError,
  })
})

export const ensureWorkflowSlackApp = Effect.fn("workflows.ensureSlackApp")(function* (input: {
  env: Env
  workflow: WorkflowRecord
  appName?: string
  now?: number
}) {
  const store = createWorkflowSlackAppStoreFromD1(makeControlPlaneFromEnv(input.env))
  const existing = yield* Effect.tryPromise({
    try: () => store.getAppByWorkflowId(input.workflow.id),
    catch: toError,
  })
  return yield* Option.match(Option.fromNullishOr(existing), {
    onNone: () => createNewSlackApp(input, store),
    onSome: (resolved) => maybeUpdateSlackApp(input, store, resolved),
  })
})

const disableTriggerRegistrationsEmpty = Effect.fn("workflows.disableTriggerRegistrationsEmpty")(
  function* (store: WorkflowSlackAppStore, workflowId: string, now: number) {
    yield* Effect.tryPromise({
      try: () => store.disableTriggerRegistrations(workflowId, now),
      catch: toError,
    })
    return [] as WorkflowSlackTriggerRegistrationRecord[]
  },
)

const registerTriggerNodes = Effect.fn("workflows.registerTriggerNodes")(function* (
  input: { env: Env; workflow: WorkflowRecord; manifest: WorkflowManifest; now?: number },
  store: WorkflowSlackAppStore,
  triggerNodes: NormalizedSlackTriggerNode[],
  now: number,
) {
  const app = yield* ensureWorkflowSlackApp({
    env: input.env,
    workflow: input.workflow,
    appName: `${input.manifest.name} s0`,
    now,
  })
  const registrations: UpsertWorkflowSlackTriggerRegistrationInput[] = Arr.map(
    triggerNodes,
    (trigger) => ({
      id: `wstr_${generateId(12)}`,
      slackAppId: app.id,
      workflowId: input.workflow.id,
      workflowVersion: input.workflow.manifest_version,
      nodeId: trigger.node.id,
      surface: trigger.surface,
      commandName: trigger.commandName,
      eventTypes: trigger.eventTypes,
      channelNamePattern: trigger.channelNamePattern,
      keywordRules: trigger.keywordRules,
      actionIds: trigger.actionIds,
      cooldownSeconds: trigger.cooldownSeconds,
      dedupeWindowSeconds: trigger.dedupeWindowSeconds,
    }),
  )
  return yield* Effect.tryPromise({
    try: () =>
      store.upsertTriggerRegistrations({
        workflowId: input.workflow.id,
        registrations,
        now,
      }),
    catch: toError,
  })
})

export const registerWorkflowSlackTriggers = Effect.fn("workflows.registerSlackTriggers")(
  function* (input: {
    env: Env
    workflow: WorkflowRecord
    manifest: WorkflowManifest
    now?: number
  }) {
    const triggerNodes = getSlackTriggerNodes(input.manifest)
    const store = createWorkflowSlackAppStoreFromD1(makeControlPlaneFromEnv(input.env))
    const now = input.now ?? Date.now()
    return yield* Match.value(triggerNodes.length === 0).pipe(
      Match.when(true, () => disableTriggerRegistrationsEmpty(store, input.workflow.id, now)),
      Match.orElse(() => registerTriggerNodes(input, store, triggerNodes, now)),
    )
  },
)

export const disableWorkflowSlackTriggers = Effect.fn("workflows.disableSlackTriggers")(
  function* (input: { env: Env; workflowId: string; now?: number }) {
    yield* Effect.tryPromise({
      try: () =>
        createWorkflowSlackAppStoreFromD1(
          makeControlPlaneFromEnv(input.env),
        ).disableTriggerRegistrations(input.workflowId, input.now ?? Date.now()),
      catch: toError,
    })
  },
)

const disableAndListRegistrations = Effect.fn("workflows.disableAndListRegistrations")(
  function* (input: { env: Env; workflow: WorkflowRecord }) {
    yield* disableWorkflowSlackTriggers({
      env: input.env,
      workflowId: input.workflow.id,
    })
    return yield* Effect.tryPromise({
      try: () =>
        createWorkflowSlackAppStoreFromD1(
          makeControlPlaneFromEnv(input.env),
        ).listRegistrationsForWorkflow(input.workflow.id),
      catch: toError,
    })
  },
)

export const getWorkflowSlackAppSetup = Effect.fn("workflows.getSlackAppSetup")(function* (input: {
  env: Env
  workflow: WorkflowRecord
  manifest: WorkflowManifest
  serverUrl: string
}) {
  const triggers = getSlackTriggerNodes(input.manifest)
  const app = yield* ensureWorkflowSlackApp({
    env: input.env,
    workflow: input.workflow,
    appName: `${input.manifest.name} s0`,
  })
  const requestUrls = buildWorkflowSlackRequestUrls({
    serverUrl: input.serverUrl,
    appId: app.id,
    commandIds: Arr.map(
      Arr.filter(triggers, (trigger) => trigger.surface === "command"),
      (trigger) => trigger.node.id,
    ),
  })
  const manifest = buildSlackManifest({
    appName: app.app_name,
    requestUrls,
    triggers,
  })
  const validation = validateWorkflowSlackManifest(manifest)
  const registrations = yield* Match.value(input.workflow.status).pipe(
    Match.when("active", () =>
      registerWorkflowSlackTriggers({
        env: input.env,
        workflow: input.workflow,
        manifest: input.manifest,
      }),
    ),
    Match.orElse(() => disableAndListRegistrations(input)),
  )
  const secretsStore = yield* requireGlobalSecretsStore(input.env)
  const secretKeys = yield* Effect.tryPromise({
    try: () =>
      secretsStore.listSecretKeys({
        userId: input.workflow.user_id,
      }),
    catch: toError,
  })
  const secretKeySet = new Set(secretKeys)
  return {
    app,
    requestUrls,
    manifest,
    validation,
    registrations,
    status: {
      hasSigningSecret: secretKeySet.has(app.signing_secret_key),
      hasBotToken: secretKeySet.has(app.bot_token_secret_key),
    },
  }
})

function buildSecretEntry(key: string, value?: string): Record<string, string> {
  return Option.match(
    Option.filter(
      Option.map(Option.fromNullishOr(value), (resolved) => resolved.trim()),
      (trimmed) => trimmed.length > 0,
    ),
    {
      onNone: () => ({}),
      onSome: (trimmed) => ({ [key]: trimmed }),
    },
  )
}

const persistSlackSecrets = Effect.fn("workflows.persistSlackSecrets")(function* (
  input: { env: Env; workflow: WorkflowRecord },
  secrets: Record<string, string>,
) {
  const secretsStore = yield* requireGlobalSecretsStore(input.env)
  yield* Effect.tryPromise({
    try: () =>
      secretsStore.setSecrets(secrets, {
        userId: input.workflow.user_id,
      }),
    catch: toError,
  })
})

export const storeWorkflowSlackAppCredentials = Effect.fn("workflows.storeSlackAppCredentials")(
  function* (input: {
    env: Env
    workflow: WorkflowRecord
    app?: WorkflowSlackAppRecord
    signingSecret?: string
    botToken?: string
  }) {
    const app =
      input.app ??
      (yield* ensureWorkflowSlackApp({
        env: input.env,
        workflow: input.workflow,
      }))
    const secrets: Record<string, string> = {
      ...buildSecretEntry(app.signing_secret_key, input.signingSecret),
      ...buildSecretEntry(app.bot_token_secret_key, input.botToken),
    }
    const hasSecretsToPersist = Effect.succeed(Object.keys(secrets).length > 0)
    yield* persistSlackSecrets(input, secrets).pipe(Effect.when(hasSecretsToPersist))
    const secretsStore = yield* requireGlobalSecretsStore(input.env)
    const secretKeys = new Set(
      yield* Effect.tryPromise({
        try: () =>
          secretsStore.listSecretKeys({
            userId: input.workflow.user_id,
          }),
        catch: toError,
      }),
    )
    return {
      hasSigningSecret: secretKeys.has(app.signing_secret_key),
      hasBotToken: secretKeys.has(app.bot_token_secret_key),
    }
  },
)

export const getWorkflowSlackAppSecrets = Effect.fn("workflows.getSlackAppSecrets")(
  function* (input: { env: Env; app: WorkflowSlackAppRecord }) {
    const secretsStore = yield* requireGlobalSecretsStore(input.env)
    const secrets = yield* Effect.tryPromise({
      try: () =>
        secretsStore.getDecryptedSecrets({
          userId: input.app.user_id,
        }),
      catch: toError,
    })
    return {
      signingSecret: readString(secrets[input.app.signing_secret_key]) || null,
      botToken: readString(secrets[input.app.bot_token_secret_key]) || null,
    }
  },
)

const resolveSlackBotTokenForApp = Effect.fn("workflows.resolveSlackBotTokenForApp")(function* (
  env: Env,
  app: WorkflowSlackAppRecord,
) {
  const { botToken } = yield* getWorkflowSlackAppSecrets({ env, app })
  return yield* Option.match(Option.fromNullishOr(botToken), {
    onNone: () => slackAppFail("Workflow Slack app bot token is not configured"),
    onSome: (token) => Effect.succeed(token),
  })
})

const resolveStoredSlackBotToken = Effect.fn("workflows.resolveStoredSlackBotToken")(
  function* (input: { env: Env; workflowId: string }) {
    const app = yield* Effect.tryPromise({
      try: () =>
        createWorkflowSlackAppStoreFromD1(makeControlPlaneFromEnv(input.env)).getAppByWorkflowId(
          input.workflowId,
        ),
      catch: toError,
    })
    return yield* Option.match(Option.fromNullishOr(app), {
      onNone: () =>
        slackAppFail(`Workflow Slack app for workflow '${input.workflowId}' was not found`),
      onSome: (resolved) => resolveSlackBotTokenForApp(input.env, resolved),
    })
  },
)

export const resolveWorkflowSlackBotToken = Effect.fn("workflows.resolveSlackBotToken")(
  function* (input: { env: Env; workflowId: string; token?: string | null }) {
    const explicitToken = readString(input.token)
    return yield* Match.value(explicitToken.length > 0).pipe(
      Match.when(true, () => Effect.succeed(explicitToken)),
      Match.orElse(() => resolveStoredSlackBotToken(input)),
    )
  },
)

export function parseSlackRegistrationStringArray(value: string): string[] {
  return readStringArray(parseJson(value))
}
