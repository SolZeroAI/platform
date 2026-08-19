import type { WorkflowManifest } from "@solzero/shared"
import { generateId } from "../auth/crypto"
import {
  createWorkflowStoreFromD1,
  type CreateWorkflowInput,
  type UpdateWorkflowInput,
  type WorkflowRecord,
  type WorkflowRunRecord,
} from "../db/workflows"
import { parseJson } from "../../lib/json"
import { resolveOktaUserId } from "../../lib/better-auth"
import { errorMessageOr, toError } from "../../lib/effect-errors"
import type { RequestLogger } from "../../effect/services/observability"
import type { Env } from "../types"
import { cancelWorkflowDateTriggers, scheduleWorkflowDateTriggers } from "./alarm"
import { readWorkflowManifest, writeWorkflowArtifacts } from "./artifacts"
import { compileWorkflowToJavaScript } from "./compiler"
import {
  migrateWorkflowManifestForSave,
  type WorkflowManifestMigrationResult,
} from "./manifest-migrations"
import { normalizeWorkflowManifest } from "./manifest"
import { startWorkflowRun, type WorkflowTriggerPayload } from "./runner"
import { disableWorkflowSlackTriggers, registerWorkflowSlackTriggers } from "./slack-apps"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

/** Failure raised when a workflow (or run) the caller referenced does not exist. */
export class WorkflowLifecycleNotFoundError extends Schema.TaggedError<WorkflowLifecycleNotFoundError>()(
  "WorkflowLifecycleNotFoundError",
  {
    message: Schema.String,
  },
) {}

/** Failure raised when workflow input (manifest/state) is invalid for the requested operation. */
export class WorkflowLifecycleInputError extends Schema.TaggedError<WorkflowLifecycleInputError>()(
  "WorkflowLifecycleInputError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

/** Failure raised when a workflow run cannot be retried because it lacks a reusable trigger. */
export class WorkflowRetryTriggerError extends Schema.TaggedError<WorkflowRetryTriggerError>()(
  "WorkflowRetryTriggerError",
  {
    message: Schema.String,
  },
) {}

const NOT_FOUND_MESSAGE = "Workflow not found"
const RETRY_TRIGGER_MESSAGE = "Workflow run does not have a reusable trigger"

const workflowNotFound = (message: string = NOT_FOUND_MESSAGE) =>
  new WorkflowLifecycleNotFoundError({ message })

/**
 * Fail with the supplied lifecycle error only when `condition` holds, otherwise complete without
 * effect. Replaces imperative `if (!ok) fail()` guards while keeping the failure tagged.
 */
function failLifecycleWhen<E>(condition: boolean, error: E) {
  const conditionEffect = Effect.succeed(condition)
  return Effect.fail(error).pipe(Effect.when(conditionEffect))
}

function getWorkflowManifestName(input: unknown, fallback: string): string {
  return Option.match(
    Option.liftPredicate(
      input,
      (value: unknown): value is Record<string, unknown> & { name: string } =>
        isRecord(value) && typeof value.name === "string",
    ),
    {
      onNone: () => fallback,
      onSome: (value) => value.name,
    },
  )
}

export interface WorkflowLifecycleStore {
  createWorkflow(input: CreateWorkflowInput): Promise<WorkflowRecord>
  updateWorkflow(input: UpdateWorkflowInput): Promise<WorkflowRecord | null>
  disableWorkflow(id: string, userId: string, updatedAt: number): Promise<boolean>
  enableWorkflow(id: string, userId: string, updatedAt: number): Promise<boolean>
  archiveWorkflow(id: string, userId: string, updatedAt: number): Promise<boolean>
  unarchiveWorkflow(id: string, userId: string, updatedAt: number): Promise<boolean>
  getWorkflow(id: string): Promise<WorkflowRecord | null>
  getRun(workflowId: string, runId: string): Promise<WorkflowRunRecord | null>
}

export interface WorkflowLifecycleAdapters {
  store?: WorkflowLifecycleStore
  now?: () => number
  generateId?: (size: number) => string
  normalizeManifest?: (input: unknown, name: string) => WorkflowManifest
  migrateManifestForSave?: (input: unknown, name: string) => WorkflowManifestMigrationResult
  compileWorkflow?: (manifest: WorkflowManifest) => string
  writeArtifacts?: typeof writeWorkflowArtifacts
  readManifest?: typeof readWorkflowManifest
  scheduleDateTriggers?: typeof scheduleWorkflowDateTriggers
  cancelDateTriggers?: typeof cancelWorkflowDateTriggers
  registerSlackTriggers?: typeof registerWorkflowSlackTriggers
  disableSlackTriggers?: typeof disableWorkflowSlackTriggers
  startRun?: typeof startWorkflowRun
  resolveOktaUserId?: typeof resolveOktaUserId
}

export interface WorkflowLifecycleSaveResult {
  workflow: WorkflowRecord
  manifest: WorkflowManifest
  migration: WorkflowManifestMigrationResult
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isTriggerKind(value: unknown): value is WorkflowTriggerPayload["kind"] {
  return (
    value === "manual" ||
    value === "webhook" ||
    value === "datetime" ||
    value === "cron" ||
    value === "slack"
  )
}

const stringFieldOr = (value: unknown, fallback: string | null) =>
  Match.value(value).pipe(
    Match.when(Match.string, (resolved) => resolved),
    Match.orElse(() => fallback),
  )

export function createWorkflowTrigger(value: unknown): WorkflowTriggerPayload {
  return Match.value(value).pipe(
    Match.when(
      (candidate: unknown): candidate is Record<string, unknown> =>
        isRecord(candidate) && isTriggerKind(candidate.kind),
      (record) => ({
        kind: record.kind as WorkflowTriggerPayload["kind"],
        nodeId: stringFieldOr(record.nodeId, null),
        payload: Match.value(record.payload).pipe(
          Match.when(isRecord, (resolved) => resolved),
          Match.orElse(() => ({})),
        ),
        cron: stringFieldOr(record.cron, null),
        scheduledAt: stringFieldOr(record.scheduledAt, null),
        firedAt: stringFieldOr(record.firedAt, null),
      }),
    ),
    Match.orElse((other) => ({
      kind: "manual" as const,
      payload: Match.value(other).pipe(
        Match.when(isRecord, (resolved) => resolved),
        Match.orElse(() => ({ value: other })),
      ),
    })),
  )
}

function readRetryTrigger(run: WorkflowRunRecord) {
  return Option.fromNullishOr(parseJson(run.input_json)).pipe(
    Option.filter(isRecord),
    Option.flatMap((record) => Option.fromNullishOr(record.trigger)),
    Option.filter(isRecord),
    Option.filter((trigger) => isTriggerKind(trigger.kind)),
    Option.match({
      onNone: () => Effect.fail(new WorkflowRetryTriggerError({ message: RETRY_TRIGGER_MESSAGE })),
      onSome: (trigger) => Effect.succeed(createWorkflowTrigger(trigger)),
    }),
  )
}

function isMissingWorkflowManifestArtifactError(error: unknown, manifestKey: string): boolean {
  return (
    error instanceof Error &&
    error.message === `Workflow manifest artifact '${manifestKey}' was not found`
  )
}

export class WorkflowLifecycle {
  private readonly store: WorkflowLifecycleStore
  private readonly now: () => number
  private readonly createId: (size: number) => string
  private readonly normalizeManifest: (input: unknown, name: string) => WorkflowManifest
  private readonly migrateManifestForSave: (
    input: unknown,
    name: string,
  ) => WorkflowManifestMigrationResult
  private readonly compileWorkflow: (manifest: WorkflowManifest) => string
  private readonly writeArtifacts: typeof writeWorkflowArtifacts
  private readonly readManifest: typeof readWorkflowManifest
  private readonly scheduleDateTriggers: typeof scheduleWorkflowDateTriggers
  private readonly cancelDateTriggers: typeof cancelWorkflowDateTriggers
  private readonly registerSlackTriggers: typeof registerWorkflowSlackTriggers
  private readonly disableSlackTriggers: typeof disableWorkflowSlackTriggers
  private readonly startRunAdapter: typeof startWorkflowRun
  private readonly resolveOktaUserIdAdapter: typeof resolveOktaUserId

  constructor(
    private readonly env: Env,
    adapters: WorkflowLifecycleAdapters = {},
  ) {
    this.store = adapters.store ?? createWorkflowStoreFromD1(env.DB)
    this.now = adapters.now ?? Date.now
    this.createId = adapters.generateId ?? generateId
    this.normalizeManifest = adapters.normalizeManifest ?? normalizeWorkflowManifest
    this.migrateManifestForSave =
      adapters.migrateManifestForSave ??
      ((input, name) => migrateWorkflowManifestForSave(input, name, this.normalizeManifest))
    this.compileWorkflow = adapters.compileWorkflow ?? compileWorkflowToJavaScript
    this.writeArtifacts = adapters.writeArtifacts ?? writeWorkflowArtifacts
    this.readManifest = adapters.readManifest ?? readWorkflowManifest
    this.scheduleDateTriggers = adapters.scheduleDateTriggers ?? scheduleWorkflowDateTriggers
    this.cancelDateTriggers = adapters.cancelDateTriggers ?? cancelWorkflowDateTriggers
    this.registerSlackTriggers = adapters.registerSlackTriggers ?? registerWorkflowSlackTriggers
    this.disableSlackTriggers = adapters.disableSlackTriggers ?? disableWorkflowSlackTriggers
    this.startRunAdapter = adapters.startRun ?? startWorkflowRun
    this.resolveOktaUserIdAdapter = adapters.resolveOktaUserId ?? resolveOktaUserId
  }

  createWorkflow(input: { name: string; manifest: unknown; userId: string }) {
    return Effect.gen({ self: this }, function* () {
      const migration = yield* this.migrateManifest(
        input.manifest,
        getWorkflowManifestName(input.manifest, input.name),
      )
      const manifest = migration.manifest
      const workflowId = `wf_${this.createId(12)}`
      const version = 1
      const code = this.compileWorkflow(manifest)
      const artifacts = yield* this.writeArtifacts({
        env: this.env,
        manifest,
        code,
        userId: input.userId,
        workflowId,
        version,
      })
      const now = this.now()
      const workflow = yield* Effect.tryPromise({
        try: () =>
          this.store.createWorkflow({
            id: workflowId,
            userId: input.userId,
            name: input.name,
            manifestVersion: version,
            manifestKey: artifacts.manifestKey,
            codeKey: artifacts.codeKey,
            webhookId: `wh_${this.createId(16)}`,
            createdAt: now,
            updatedAt: now,
          }),
        catch: toError,
      })

      yield* this.scheduleDateTriggers({
        env: this.env,
        workflowId,
        userId: input.userId,
        nodes: manifest.nodes,
      })
      yield* this.registerSlackTriggers({
        env: this.env,
        workflow,
        manifest,
      })

      return { workflow, manifest, migration }
    })
  }

  updateWorkflow(input: { workflow: WorkflowRecord; name: string; manifest: unknown }) {
    return Effect.gen({ self: this }, function* () {
      const previousManifest = yield* this.readPreviousManifest(input.workflow.manifest_key)
      const migration = yield* this.migrateManifest(
        input.manifest,
        getWorkflowManifestName(input.manifest, input.name),
      )
      const manifest = migration.manifest
      const version = input.workflow.manifest_version + 1
      const code = this.compileWorkflow(manifest)
      const artifacts = yield* this.writeArtifacts({
        env: this.env,
        manifest,
        code,
        userId: input.workflow.user_id,
        workflowId: input.workflow.id,
        version,
      })

      const updated = yield* Effect.tryPromise({
        try: () =>
          this.store.updateWorkflow({
            id: input.workflow.id,
            userId: input.workflow.user_id,
            name: input.name,
            status: input.workflow.status,
            manifestVersion: version,
            manifestKey: artifacts.manifestKey,
            codeKey: artifacts.codeKey,
            updatedAt: this.now(),
          }),
        catch: toError,
      })
      const workflow = yield* Option.match(Option.fromNullishOr(updated), {
        onNone: () => Effect.fail(workflowNotFound()),
        onSome: (resolved) => Effect.succeed(resolved),
      })

      yield* Option.match(previousManifest, {
        onNone: () => Effect.void,
        onSome: (resolved) =>
          this.cancelDateTriggers({
            env: this.env,
            workflowId: input.workflow.id,
            nodes: resolved.nodes,
          }),
      })
      yield* Match.value(workflow.status).pipe(
        Match.when("active", () =>
          Effect.all([
            this.scheduleDateTriggers({
              env: this.env,
              workflowId: input.workflow.id,
              userId: input.workflow.user_id,
              nodes: manifest.nodes,
            }),
            this.registerSlackTriggers({ env: this.env, workflow, manifest }),
          ]),
        ),
        Match.orElse(() =>
          this.disableSlackTriggers({ env: this.env, workflowId: input.workflow.id }),
        ),
      )

      return { workflow, manifest, migration }
    })
  }

  disableWorkflow(input: { workflow: WorkflowRecord }) {
    return Effect.gen({ self: this }, function* () {
      const manifest = yield* this.readManifest(this.env, input.workflow.manifest_key)
      yield* this.cancelDateTriggers({
        env: this.env,
        workflowId: input.workflow.id,
        nodes: manifest.nodes,
      })
      yield* this.disableSlackTriggers({
        env: this.env,
        workflowId: input.workflow.id,
      })
      const updatedAt = this.now()
      const disabled = yield* Effect.tryPromise({
        try: () => this.store.disableWorkflow(input.workflow.id, input.workflow.user_id, updatedAt),
        catch: toError,
      })
      yield* failLifecycleWhen(!disabled, workflowNotFound())
      return { ...input.workflow, status: "disabled" as const, updated_at: updatedAt }
    })
  }

  enableWorkflow(input: { workflow: WorkflowRecord }) {
    return Effect.gen({ self: this }, function* () {
      const manifest = yield* this.readManifest(this.env, input.workflow.manifest_key)
      const updatedAt = this.now()
      const enabled = yield* Effect.tryPromise({
        try: () => this.store.enableWorkflow(input.workflow.id, input.workflow.user_id, updatedAt),
        catch: toError,
      })
      yield* failLifecycleWhen(!enabled, workflowNotFound())
      yield* this.scheduleDateTriggers({
        env: this.env,
        workflowId: input.workflow.id,
        userId: input.workflow.user_id,
        nodes: manifest.nodes,
      })
      yield* this.registerSlackTriggers({
        env: this.env,
        workflow: { ...input.workflow, status: "active", updated_at: updatedAt },
        manifest,
      })
      return { ...input.workflow, status: "active" as const, updated_at: updatedAt }
    })
  }

  archiveWorkflow(input: { workflow: WorkflowRecord }) {
    return Effect.gen({ self: this }, function* () {
      const manifest = yield* this.readManifest(this.env, input.workflow.manifest_key)
      yield* this.cancelDateTriggers({
        env: this.env,
        workflowId: input.workflow.id,
        nodes: manifest.nodes,
      })
      yield* this.disableSlackTriggers({
        env: this.env,
        workflowId: input.workflow.id,
      })
      const archived = yield* Effect.tryPromise({
        try: () =>
          this.store.archiveWorkflow(input.workflow.id, input.workflow.user_id, this.now()),
        catch: toError,
      })
      yield* failLifecycleWhen(!archived, workflowNotFound())
    })
  }

  archiveWorkflowById(workflowId: string) {
    return Effect.gen({ self: this }, function* () {
      const workflow = yield* this.requireWorkflow(workflowId)
      yield* this.archiveWorkflow({ workflow })
      return workflow
    })
  }

  unarchiveWorkflow(input: { workflow: WorkflowRecord }) {
    return Effect.gen({ self: this }, function* () {
      const manifest = yield* this.readManifest(this.env, input.workflow.manifest_key)
      const unarchived = yield* Effect.tryPromise({
        try: () =>
          this.store.unarchiveWorkflow(input.workflow.id, input.workflow.user_id, this.now()),
        catch: toError,
      })
      yield* failLifecycleWhen(!unarchived, workflowNotFound())
      yield* this.scheduleDateTriggers({
        env: this.env,
        workflowId: input.workflow.id,
        userId: input.workflow.user_id,
        nodes: manifest.nodes,
      })
      yield* this.registerSlackTriggers({
        env: this.env,
        workflow: { ...input.workflow, status: "active" },
        manifest,
      })
    })
  }

  unarchiveWorkflowById(workflowId: string) {
    return Effect.gen({ self: this }, function* () {
      const workflow = yield* this.requireWorkflow(workflowId)
      yield* this.unarchiveWorkflow({ workflow })
      return workflow
    })
  }

  startWorkflowRun(input: {
    workflow: WorkflowRecord
    trigger: WorkflowTriggerPayload
    userId?: string
    oktaUserId?: string | null
    log?: RequestLogger
  }) {
    return Effect.gen({ self: this }, function* () {
      yield* failLifecycleWhen(
        input.workflow.status !== "active",
        new WorkflowLifecycleInputError({ message: "Workflow is disabled" }),
      )
      const userId = input.userId ?? input.workflow.user_id
      const oktaUserId = yield* Match.value(input.oktaUserId).pipe(
        Match.when(Match.undefined, () =>
          this.resolveOktaUserIdAdapter(this.env, input.workflow.user_id).pipe(
            Effect.orElseSucceed(() => null),
          ),
        ),
        Match.orElse((resolved) => Effect.succeed(resolved)),
      )
      return yield* Effect.tryPromise({
        try: () =>
          this.startRunAdapter({
            env: this.env,
            workflow: input.workflow,
            trigger: input.trigger,
            userId,
            oktaUserId,
            log: input.log,
          }),
        catch: toError,
      })
    })
  }

  startWorkflowRunById(input: { workflowId: string; trigger: WorkflowTriggerPayload }) {
    return Effect.gen({ self: this }, function* () {
      const workflow = yield* this.requireWorkflow(input.workflowId)
      return yield* this.startWorkflowRun({ workflow, trigger: input.trigger })
    })
  }

  retryWorkflowRun(input: { workflowId: string; runId: string }) {
    return Effect.gen({ self: this }, function* () {
      const workflow = yield* this.requireWorkflow(input.workflowId)
      const run = yield* Effect.tryPromise({
        try: () => this.store.getRun(input.workflowId, input.runId),
        catch: toError,
      })
      const resolvedRun = yield* Option.match(Option.fromNullishOr(run), {
        onNone: () => Effect.fail(workflowNotFound("Workflow run not found")),
        onSome: (resolved) => Effect.succeed(resolved),
      })
      const trigger = yield* readRetryTrigger(resolvedRun)
      return yield* this.startWorkflowRun({ workflow, trigger })
    })
  }

  private migrateManifest(input: unknown, name: string) {
    return Effect.try({
      try: () => this.migrateManifestForSave(input, name),
      catch: (error) =>
        new WorkflowLifecycleInputError({
          message: errorMessageOr(error, "Invalid workflow manifest"),
          cause: error,
        }),
    })
  }

  private readPreviousManifest(manifestKey: string) {
    return this.readManifest(this.env, manifestKey).pipe(
      Effect.map(Option.some<WorkflowManifest>),
      Effect.catch((error) =>
        Match.value(isMissingWorkflowManifestArtifactError(error, manifestKey)).pipe(
          Match.when(true, () => Effect.succeed(Option.none<WorkflowManifest>())),
          Match.orElse(() => Effect.fail(error)),
        ),
      ),
    )
  }

  private requireWorkflow(workflowId: string) {
    return Effect.gen({ self: this }, function* () {
      const workflow = yield* Effect.tryPromise({
        try: () => this.store.getWorkflow(workflowId),
        catch: toError,
      })
      return yield* Option.match(Option.fromNullishOr(workflow), {
        onNone: () => Effect.fail(workflowNotFound()),
        onSome: (resolved) => Effect.succeed(resolved),
      })
    })
  }
}

/**
 * Promise-facing webhook entry that runs a workflow via {@link WorkflowLifecycle} for the
 * non-Effect public router (Worker request entry), which stays Effect-free to keep its imperative
 * request-handling path lint-clean. Runs the underlying Effect at this boundary.
 */
export function startWorkflowRunFromWebhook(
  env: Env,
  input: {
    workflow: WorkflowRecord
    trigger: WorkflowTriggerPayload
    userId?: string
    oktaUserId?: string | null
    log?: RequestLogger
  },
): Promise<WorkflowRunRecord> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary bridging Effect WorkflowLifecycle to the non-Effect public webhook router (Worker request entry).
  return Effect.runPromise(new WorkflowLifecycle(env).startWorkflowRun(input))
}
