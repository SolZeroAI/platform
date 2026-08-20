import { and, desc, eq, gte, ne, type SQL } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { stringifyJson } from "../../lib/json"
import { makeD1Drizzle, type D1DrizzleDatabase } from "../../effect/db/d1-drizzle"
import {
  workflowSlackApps,
  workflowSlackDeliveries,
  workflowSlackTriggerRegistrations,
} from "../../effect/db/schema"
import { d1Error, WorkflowSlackDeliveryError, type D1Error } from "./errors"

export type WorkflowSlackTriggerSurface = "event" | "command" | "interaction"
export type WorkflowSlackDeliveryStatus = "received" | "started" | "ignored" | "failed"

export interface WorkflowSlackAppRecord {
  id: string
  workflow_id: string
  user_id: string
  app_name: string
  signing_secret_key: string
  bot_token_secret_key: string
  created_at: number
  updated_at: number
}

export interface WorkflowSlackTriggerRegistrationRecord {
  id: string
  slack_app_id: string
  workflow_id: string
  workflow_version: number
  node_id: string
  surface: WorkflowSlackTriggerSurface
  command_name: string | null
  event_types_json: string
  channel_name_pattern: string | null
  keyword_rules_json: string
  action_ids_json: string
  cooldown_seconds: number
  dedupe_window_seconds: number
  enabled: boolean
  created_at: number
  updated_at: number
}

export interface WorkflowSlackDeliveryRecord {
  id: string
  slack_app_id: string
  workflow_id: string
  node_id: string
  delivery_key: string
  surface: WorkflowSlackTriggerSurface
  run_id: string | null
  status: WorkflowSlackDeliveryStatus
  error: string | null
  created_at: number
  updated_at: number
}

export interface WorkflowSlackDeliveryUpsert {
  created: boolean
  delivery: WorkflowSlackDeliveryRecord
}

export interface UpsertWorkflowSlackTriggerRegistrationInput {
  id: string
  slackAppId: string
  workflowId: string
  workflowVersion: number
  nodeId: string
  surface: WorkflowSlackTriggerSurface
  commandName?: string | null
  eventTypes: string[]
  channelNamePattern?: string | null
  keywordRules: string[]
  actionIds: string[]
  cooldownSeconds: number
  dedupeWindowSeconds: number
}

const DELIVERY_DEDUPE_MISSING_MESSAGE = "Workflow Slack delivery dedupe row was not found"

export class WorkflowSlackAppStore {
  private readonly drizzle

  constructor(drizzle: D1DrizzleDatabase) {
    this.drizzle = drizzle
  }

  private toAppRecord(row: typeof workflowSlackApps.$inferSelect): WorkflowSlackAppRecord {
    return {
      id: row.id,
      workflow_id: row.workflowId,
      user_id: row.userId,
      app_name: row.appName,
      signing_secret_key: row.signingSecretKey,
      bot_token_secret_key: row.botTokenSecretKey,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }
  }

  private toTriggerRegistrationRecord(
    row: typeof workflowSlackTriggerRegistrations.$inferSelect,
  ): WorkflowSlackTriggerRegistrationRecord {
    return {
      id: row.id,
      slack_app_id: row.slackAppId,
      workflow_id: row.workflowId,
      workflow_version: row.workflowVersion,
      node_id: row.nodeId,
      surface: row.surface as WorkflowSlackTriggerSurface,
      command_name: row.commandName,
      event_types_json: row.eventTypesJson,
      channel_name_pattern: row.channelNamePattern,
      keyword_rules_json: row.keywordRulesJson,
      action_ids_json: row.actionIdsJson,
      cooldown_seconds: row.cooldownSeconds,
      dedupe_window_seconds: row.dedupeWindowSeconds,
      enabled: row.enabled === 1,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }
  }

  private toDeliveryRecord(
    row: typeof workflowSlackDeliveries.$inferSelect,
  ): WorkflowSlackDeliveryRecord {
    return {
      id: row.id,
      slack_app_id: row.slackAppId,
      workflow_id: row.workflowId,
      node_id: row.nodeId,
      delivery_key: row.deliveryKey,
      surface: row.surface as WorkflowSlackTriggerSurface,
      run_id: row.runId,
      status: row.status as WorkflowSlackDeliveryStatus,
      error: row.error,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }
  }

  createApp = Effect.fn("db.workflowSlack.createApp")(function* (
    this: WorkflowSlackAppStore,
    input: {
      id: string
      workflowId: string
      userId: string
      appName: string
      signingSecretKey: string
      botTokenSecretKey: string
      now: number
    },
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .insert(workflowSlackApps)
          .values({
            id: input.id,
            workflowId: input.workflowId,
            userId: input.userId,
            appName: input.appName,
            signingSecretKey: input.signingSecretKey,
            botTokenSecretKey: input.botTokenSecretKey,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning(),
      catch: d1Error("db.workflowSlack.createApp"),
    })
    return this.toAppRecord(rows[0])
  })

  getAppById = Effect.fn("db.workflowSlack.getAppById")(function* (
    this: WorkflowSlackAppStore,
    id: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle.select().from(workflowSlackApps).where(eq(workflowSlackApps.id, id)).limit(1),
      catch: d1Error("db.workflowSlack.getAppById"),
    })
    return Option.map(Option.fromNullishOr(rows[0]), (row) => this.toAppRecord(row))
  })

  getAppByWorkflowId = Effect.fn("db.workflowSlack.getAppByWorkflowId")(function* (
    this: WorkflowSlackAppStore,
    workflowId: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(workflowSlackApps)
          .where(eq(workflowSlackApps.workflowId, workflowId))
          .limit(1),
      catch: d1Error("db.workflowSlack.getAppByWorkflowId"),
    })
    return Option.map(Option.fromNullishOr(rows[0]), (row) => this.toAppRecord(row))
  })

  updateAppMetadata = Effect.fn("db.workflowSlack.updateAppMetadata")(function* (
    this: WorkflowSlackAppStore,
    input: {
      appId: string
      appName?: string
      updatedAt: number
    },
  ) {
    const appNamePatch = Option.match(
      Option.fromNullishOr(input.appName).pipe(Option.filter(Boolean)),
      {
        onNone: () => ({}),
        onSome: (appName) => ({ appName }),
      },
    )
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(workflowSlackApps)
          .set({ ...appNamePatch, updatedAt: input.updatedAt })
          .where(eq(workflowSlackApps.id, input.appId))
          .returning(),
      catch: d1Error("db.workflowSlack.updateAppMetadata"),
    })
    return Option.map(Option.fromNullishOr(rows[0]), (row) => this.toAppRecord(row))
  })

  disableTriggerRegistrations = Effect.fn("db.workflowSlack.disableTriggerRegistrations")(
    function* (this: WorkflowSlackAppStore, workflowId: string, updatedAt: number) {
      yield* Effect.tryPromise({
        try: () =>
          this.drizzle
            .update(workflowSlackTriggerRegistrations)
            .set({ enabled: 0, updatedAt })
            .where(eq(workflowSlackTriggerRegistrations.workflowId, workflowId)),
        catch: d1Error("db.workflowSlack.disableTriggerRegistrations"),
      })
    },
  )

  upsertTriggerRegistrations = Effect.fn("db.workflowSlack.upsertTriggerRegistrations")(function* (
    this: WorkflowSlackAppStore,
    input: {
      workflowId: string
      registrations: UpsertWorkflowSlackTriggerRegistrationInput[]
      now: number
    },
  ) {
    // Disable-then-reinsert must be atomic: readers filter on enabled=1, so a
    // non-transactional gap (or a mid-loop failure) would either drop concurrent
    // Slack deliveries or leave triggers permanently disabled. D1 batches run in a
    // single transaction, so the disable and re-enable commit (or roll back) together.
    const disableStatement = this.drizzle
      .update(workflowSlackTriggerRegistrations)
      .set({ enabled: 0, updatedAt: input.now })
      .where(eq(workflowSlackTriggerRegistrations.workflowId, input.workflowId))

    const upsertStatements = input.registrations.map((registration) =>
      this.drizzle
        .insert(workflowSlackTriggerRegistrations)
        .values({
          id: registration.id,
          slackAppId: registration.slackAppId,
          workflowId: registration.workflowId,
          workflowVersion: registration.workflowVersion,
          nodeId: registration.nodeId,
          surface: registration.surface,
          commandName: registration.commandName ?? null,
          eventTypesJson: stringifyJson(registration.eventTypes),
          channelNamePattern: registration.channelNamePattern ?? null,
          keywordRulesJson: stringifyJson(registration.keywordRules),
          actionIdsJson: stringifyJson(registration.actionIds),
          cooldownSeconds: registration.cooldownSeconds,
          dedupeWindowSeconds: registration.dedupeWindowSeconds,
          enabled: 1,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: [
            workflowSlackTriggerRegistrations.workflowId,
            workflowSlackTriggerRegistrations.nodeId,
          ],
          set: {
            slackAppId: registration.slackAppId,
            workflowVersion: registration.workflowVersion,
            surface: registration.surface,
            commandName: registration.commandName ?? null,
            eventTypesJson: stringifyJson(registration.eventTypes),
            channelNamePattern: registration.channelNamePattern ?? null,
            keywordRulesJson: stringifyJson(registration.keywordRules),
            actionIdsJson: stringifyJson(registration.actionIds),
            cooldownSeconds: registration.cooldownSeconds,
            dedupeWindowSeconds: registration.dedupeWindowSeconds,
            enabled: 1,
            updatedAt: input.now,
          },
        })
        .returning(),
    )

    // An empty registration set still runs the disable batch (results.slice(1) is
    // then empty), reproducing the original disable-only path without branching.
    const results = yield* Effect.tryPromise({
      try: () => this.drizzle.batch([disableStatement, ...upsertStatements]),
      catch: d1Error("db.workflowSlack.upsertTriggerRegistrations"),
    })
    const [, ...upsertResults] = results
    return upsertResults.map((rows) => this.toTriggerRegistrationRecord(rows[0]))
  })

  listEnabledRegistrationsForApp = Effect.fn("db.workflowSlack.listEnabledRegistrationsForApp")(
    function* (
      this: WorkflowSlackAppStore,
      input: {
        slackAppId: string
        surface: WorkflowSlackTriggerSurface
      },
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          this.drizzle
            .select()
            .from(workflowSlackTriggerRegistrations)
            .where(
              and(
                eq(workflowSlackTriggerRegistrations.slackAppId, input.slackAppId),
                eq(workflowSlackTriggerRegistrations.surface, input.surface),
                eq(workflowSlackTriggerRegistrations.enabled, 1),
              ),
            ),
        catch: d1Error("db.workflowSlack.listEnabledRegistrationsForApp"),
      })
      return rows.map((row) => this.toTriggerRegistrationRecord(row))
    },
  )

  listEnabledRegistrationsForWorkflow = Effect.fn(
    "db.workflowSlack.listEnabledRegistrationsForWorkflow",
  )(function* (this: WorkflowSlackAppStore, workflowId: string) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(workflowSlackTriggerRegistrations)
          .where(
            and(
              eq(workflowSlackTriggerRegistrations.workflowId, workflowId),
              eq(workflowSlackTriggerRegistrations.enabled, 1),
            ),
          ),
      catch: d1Error("db.workflowSlack.listEnabledRegistrationsForWorkflow"),
    })
    return rows.map((row) => this.toTriggerRegistrationRecord(row))
  })

  listRegistrationsForWorkflow = Effect.fn("db.workflowSlack.listRegistrationsForWorkflow")(
    function* (this: WorkflowSlackAppStore, workflowId: string) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          this.drizzle
            .select()
            .from(workflowSlackTriggerRegistrations)
            .where(eq(workflowSlackTriggerRegistrations.workflowId, workflowId)),
        catch: d1Error("db.workflowSlack.listRegistrationsForWorkflow"),
      })
      return rows.map((row) => this.toTriggerRegistrationRecord(row))
    },
  )

  createDeliveryIfAbsent = Effect.fn("db.workflowSlack.createDeliveryIfAbsent")(function* (
    this: WorkflowSlackAppStore,
    input: {
      id: string
      slackAppId: string
      workflowId: string
      nodeId: string
      deliveryKey: string
      surface: WorkflowSlackTriggerSurface
      status: WorkflowSlackDeliveryStatus
      dedupeWindowSeconds: number
      now: number
    },
  ) {
    const inserted = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .insert(workflowSlackDeliveries)
          .values({
            id: input.id,
            slackAppId: input.slackAppId,
            workflowId: input.workflowId,
            nodeId: input.nodeId,
            deliveryKey: input.deliveryKey,
            surface: input.surface,
            status: input.status,
            runId: null,
            error: null,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoNothing({
            target: [
              workflowSlackDeliveries.slackAppId,
              workflowSlackDeliveries.nodeId,
              workflowSlackDeliveries.deliveryKey,
            ],
          })
          .returning(),
      catch: d1Error("db.workflowSlack.createDeliveryIfAbsent"),
    })

    return yield* Option.match(Option.fromNullishOr(inserted[0]), {
      onSome: (row) =>
        Effect.succeed<WorkflowSlackDeliveryUpsert>({
          created: true,
          delivery: this.toDeliveryRecord(row),
        }),
      onNone: () => this.resolveExistingDelivery(input),
    })
  })

  private resolveExistingDelivery = Effect.fn("db.workflowSlack.resolveExistingDelivery")(
    function* (
      this: WorkflowSlackAppStore,
      input: {
        slackAppId: string
        workflowId: string
        nodeId: string
        deliveryKey: string
        surface: WorkflowSlackTriggerSurface
        status: WorkflowSlackDeliveryStatus
        dedupeWindowSeconds: number
        now: number
      },
    ) {
      const existingRows = yield* Effect.tryPromise({
        try: () =>
          this.drizzle
            .select()
            .from(workflowSlackDeliveries)
            .where(
              and(
                eq(workflowSlackDeliveries.slackAppId, input.slackAppId),
                eq(workflowSlackDeliveries.nodeId, input.nodeId),
                eq(workflowSlackDeliveries.deliveryKey, input.deliveryKey),
              ),
            )
            .limit(1),
        catch: d1Error("db.workflowSlack.createDeliveryIfAbsent"),
      })

      const existingRow = yield* Option.match(Option.fromNullishOr(existingRows[0]), {
        onNone: () =>
          Effect.fail(new WorkflowSlackDeliveryError({ message: DELIVERY_DEDUPE_MISSING_MESSAGE })),
        onSome: (row) => Effect.succeed(row),
      })
      const existing = this.toDeliveryRecord(existingRow)
      const duplicateWindowActive =
        input.dedupeWindowSeconds > 0 &&
        existing.created_at >= input.now - input.dedupeWindowSeconds * 1000

      return yield* Match.value(duplicateWindowActive).pipe(
        Match.when(true, () =>
          Effect.succeed<WorkflowSlackDeliveryUpsert>({ created: false, delivery: existing }),
        ),
        Match.orElse(() => this.refreshDelivery(input, existing, existingRow)),
      )
    },
  )

  private refreshDelivery = Effect.fn("db.workflowSlack.refreshDelivery")(function* (
    this: WorkflowSlackAppStore,
    input: {
      workflowId: string
      surface: WorkflowSlackTriggerSurface
      status: WorkflowSlackDeliveryStatus
      now: number
    },
    existing: WorkflowSlackDeliveryRecord,
    existingRow: typeof workflowSlackDeliveries.$inferSelect,
  ) {
    const refreshedRows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(workflowSlackDeliveries)
          .set({
            workflowId: input.workflowId,
            surface: input.surface,
            status: input.status,
            runId: null,
            error: null,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(workflowSlackDeliveries.id, existing.id),
              eq(workflowSlackDeliveries.createdAt, existing.created_at),
            ),
          )
          .returning(),
      catch: d1Error("db.workflowSlack.createDeliveryIfAbsent"),
    })

    return yield* Option.match(Option.fromNullishOr(refreshedRows[0]), {
      onSome: (row) =>
        Effect.succeed<WorkflowSlackDeliveryUpsert>({
          created: true,
          delivery: this.toDeliveryRecord(row),
        }),
      onNone: () => this.resolveCurrentDelivery(existing, existingRow),
    })
  })

  private resolveCurrentDelivery = Effect.fn("db.workflowSlack.resolveCurrentDelivery")(function* (
    this: WorkflowSlackAppStore,
    existing: WorkflowSlackDeliveryRecord,
    existingRow: typeof workflowSlackDeliveries.$inferSelect,
  ) {
    const currentRows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(workflowSlackDeliveries)
          .where(eq(workflowSlackDeliveries.id, existing.id))
          .limit(1),
      catch: d1Error("db.workflowSlack.createDeliveryIfAbsent"),
    })
    const row = Option.getOrElse(Option.fromNullishOr(currentRows[0]), () => existingRow)
    return {
      created: false,
      delivery: this.toDeliveryRecord(row),
    } satisfies WorkflowSlackDeliveryUpsert
  })

  updateDelivery = Effect.fn("db.workflowSlack.updateDelivery")(function* (
    this: WorkflowSlackAppStore,
    input: {
      id: string
      runId?: string | null
      status: WorkflowSlackDeliveryStatus
      error?: string | null
      updatedAt: number
    },
  ) {
    yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(workflowSlackDeliveries)
          .set({
            runId: input.runId ?? null,
            status: input.status,
            error: input.error ?? null,
            updatedAt: input.updatedAt,
          })
          .where(eq(workflowSlackDeliveries.id, input.id)),
      catch: d1Error("db.workflowSlack.updateDelivery"),
    })
  })

  getRecentDeliveryForNode = Effect.fn("db.workflowSlack.getRecentDeliveryForNode")(function* (
    this: WorkflowSlackAppStore,
    input: {
      slackAppId: string
      nodeId: string
      since: number
      excludeDeliveryId?: string
    },
  ) {
    const excludeCondition = Option.match(
      Option.fromNullishOr(input.excludeDeliveryId).pipe(Option.filter(Boolean)),
      {
        onNone: () => [] as SQL[],
        onSome: (excludeDeliveryId) => [ne(workflowSlackDeliveries.id, excludeDeliveryId)],
      },
    )
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(workflowSlackDeliveries)
          .where(
            and(
              eq(workflowSlackDeliveries.slackAppId, input.slackAppId),
              eq(workflowSlackDeliveries.nodeId, input.nodeId),
              gte(workflowSlackDeliveries.createdAt, input.since),
              ...excludeCondition,
            ),
          )
          .orderBy(desc(workflowSlackDeliveries.createdAt))
          .limit(1),
      catch: d1Error("db.workflowSlack.getRecentDeliveryForNode"),
    })
    return Option.map(Option.fromNullishOr(rows[0]), (row) => this.toDeliveryRecord(row))
  })
}

function runSlackAppStoreEffect<A>(
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Promise-boundary bridge: A is the type parameter, so the error channel must be named explicitly here.
  effect: Effect.Effect<A, D1Error | WorkflowSlackDeliveryError>,
): Promise<A> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary bridging the Effect WorkflowSlackAppStore to the non-Effect Slack registration sync and public Slack router.
  return Effect.runPromise(effect)
}

function runSlackAppStoreOption<A>(
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Promise-boundary bridge: A is the type parameter, so the D1Error channel must be named explicitly here.
  effect: Effect.Effect<Option.Option<A>, D1Error>,
): Promise<A | null> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary bridging the Effect WorkflowSlackAppStore to the non-Effect Slack registration sync and public Slack router.
  return Effect.runPromise(effect.pipe(Effect.map(Option.getOrNull)))
}

/**
 * Promise-facing view of {@link WorkflowSlackAppStore} for the non-Effect Slack integration
 * runtime (trigger registration sync and the public Slack request router). Runs the underlying
 * Effect at this boundary and re-surfaces nullable reads as `T | null`.
 */
export interface WorkflowSlackAppStorePromise {
  createApp(input: {
    id: string
    workflowId: string
    userId: string
    appName: string
    signingSecretKey: string
    botTokenSecretKey: string
    now: number
  }): Promise<WorkflowSlackAppRecord>
  getAppById(id: string): Promise<WorkflowSlackAppRecord | null>
  getAppByWorkflowId(workflowId: string): Promise<WorkflowSlackAppRecord | null>
  updateAppMetadata(input: {
    appId: string
    appName?: string
    updatedAt: number
  }): Promise<WorkflowSlackAppRecord | null>
  disableTriggerRegistrations(workflowId: string, updatedAt: number): Promise<void>
  upsertTriggerRegistrations(input: {
    workflowId: string
    registrations: UpsertWorkflowSlackTriggerRegistrationInput[]
    now: number
  }): Promise<WorkflowSlackTriggerRegistrationRecord[]>
  listEnabledRegistrationsForApp(input: {
    slackAppId: string
    surface: WorkflowSlackTriggerSurface
  }): Promise<WorkflowSlackTriggerRegistrationRecord[]>
  listEnabledRegistrationsForWorkflow(
    workflowId: string,
  ): Promise<WorkflowSlackTriggerRegistrationRecord[]>
  listRegistrationsForWorkflow(
    workflowId: string,
  ): Promise<WorkflowSlackTriggerRegistrationRecord[]>
  createDeliveryIfAbsent(input: {
    id: string
    slackAppId: string
    workflowId: string
    nodeId: string
    deliveryKey: string
    surface: WorkflowSlackTriggerSurface
    status: WorkflowSlackDeliveryStatus
    dedupeWindowSeconds: number
    now: number
  }): Promise<WorkflowSlackDeliveryUpsert>
  updateDelivery(input: {
    id: string
    runId?: string | null
    status: WorkflowSlackDeliveryStatus
    error?: string | null
    updatedAt: number
  }): Promise<void>
  getRecentDeliveryForNode(input: {
    slackAppId: string
    nodeId: string
    since: number
    excludeDeliveryId?: string
  }): Promise<WorkflowSlackDeliveryRecord | null>
}

export function createWorkflowSlackAppStoreFromD1(db: D1Database): WorkflowSlackAppStorePromise {
  const store = new WorkflowSlackAppStore(makeD1Drizzle(db))
  return {
    createApp: (input) => runSlackAppStoreEffect(store.createApp(input)),
    getAppById: (id) => runSlackAppStoreOption(store.getAppById(id)),
    getAppByWorkflowId: (workflowId) =>
      runSlackAppStoreOption(store.getAppByWorkflowId(workflowId)),
    updateAppMetadata: (input) => runSlackAppStoreOption(store.updateAppMetadata(input)),
    disableTriggerRegistrations: (workflowId, updatedAt) =>
      runSlackAppStoreEffect(store.disableTriggerRegistrations(workflowId, updatedAt)),
    upsertTriggerRegistrations: (input) =>
      runSlackAppStoreEffect(store.upsertTriggerRegistrations(input)),
    listEnabledRegistrationsForApp: (input) =>
      runSlackAppStoreEffect(store.listEnabledRegistrationsForApp(input)),
    listEnabledRegistrationsForWorkflow: (workflowId) =>
      runSlackAppStoreEffect(store.listEnabledRegistrationsForWorkflow(workflowId)),
    listRegistrationsForWorkflow: (workflowId) =>
      runSlackAppStoreEffect(store.listRegistrationsForWorkflow(workflowId)),
    createDeliveryIfAbsent: (input) => runSlackAppStoreEffect(store.createDeliveryIfAbsent(input)),
    updateDelivery: (input) => runSlackAppStoreEffect(store.updateDelivery(input)),
    getRecentDeliveryForNode: (input) =>
      runSlackAppStoreOption(store.getRecentDeliveryForNode(input)),
  }
}
