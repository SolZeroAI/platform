import { and, asc, desc, eq, gte, ne, or, sql, type AnyColumn, type SQL } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { makeD1Drizzle } from "../../effect/db/d1-drizzle"
import {
  resolveControlPlaneHandle,
  type AppDrizzleDatabase,
  type AppSchema,
  type ControlPlaneDb,
} from "../../effect/db/control-plane-db"
import { stringifyJson } from "../../lib/json"
import { d1Error, type D1Error } from "./errors"

export type WorkflowStatus = "active" | "disabled" | "archived"
export type WorkflowRunStatus = "queued" | "running" | "completed" | "failed"
export type WorkflowRunTriggerKind = "manual" | "webhook" | "datetime" | "cron" | "slack"
export type WorkflowRunEventLevel = "info" | "warn" | "error"
export type WorkflowListSortBy =
  | "name"
  | "status"
  | "manifestVersion"
  | "webhookId"
  | "createdAt"
  | "updatedAt"

function workflowSortColumns(schema: AppSchema) {
  return {
    name: schema.workflows.name,
    status: schema.workflows.status,
    manifestVersion: schema.workflows.manifestVersion,
    webhookId: schema.workflows.webhookId,
    createdAt: schema.workflows.createdAt,
    updatedAt: schema.workflows.updatedAt,
  } satisfies Record<string, AnyColumn>
}

function workflowRunSortColumns(schema: AppSchema) {
  return {
    id: schema.workflowRuns.id,
    workflowVersion: schema.workflowRuns.workflowVersion,
    triggerKind: schema.workflowRuns.triggerKind,
    status: schema.workflowRuns.status,
    startedAt: schema.workflowRuns.startedAt,
    completedAt: schema.workflowRuns.completedAt,
    updatedAt: schema.workflowRuns.updatedAt,
  } satisfies Record<string, AnyColumn>
}

function addLikeFilter(conditions: SQL[], value: string | undefined, columns: AnyColumn[]) {
  Option.match(Option.fromNullishOr(value?.trim().toLowerCase()).pipe(Option.filter(Boolean)), {
    onNone: () => undefined,
    onSome: (trimmed) => {
      const pattern = `%${trimmed}%`
      const condition = or(
        ...columns.map((column) => sql`lower(coalesce(${column}, '')) LIKE ${pattern}`),
      )
      Option.match(Option.fromNullishOr(condition), {
        onNone: () => undefined,
        onSome: (resolved) => {
          conditions.push(resolved)
        },
      })
    },
  })
}

function resolveSortColumn<T extends Record<string, AnyColumn>>(
  columns: T,
  sortBy: string | undefined,
  fallback: keyof T,
): AnyColumn {
  return Option.match(
    Option.fromNullishOr(sortBy).pipe(
      Option.filter((key) => Object.prototype.hasOwnProperty.call(columns, key)),
    ),
    {
      onNone: () => columns[fallback],
      onSome: (key) => columns[key],
    },
  )
}

function orderBy(
  columns: Record<string, AnyColumn>,
  query: { sortBy?: string; sortDir?: string },
  fallback: string,
): SQL {
  const column = resolveSortColumn(columns, query.sortBy, fallback)
  return Match.value(query.sortDir === "asc").pipe(
    Match.when(true, () => asc(column)),
    Match.orElse(() => desc(column)),
  )
}

export interface WorkflowRecord {
  id: string
  user_id: string
  name: string
  status: WorkflowStatus
  manifest_version: number
  manifest_key: string
  code_key: string
  webhook_id: string
  created_at: number
  updated_at: number
}

export interface WorkflowRunRecord {
  id: string
  workflow_id: string
  workflow_version: number
  workflow_instance_id: string | null
  user_id: string
  trigger_kind: WorkflowRunTriggerKind
  trigger_node_id: string | null
  status: WorkflowRunStatus
  input_json: string
  output_json: string | null
  error: string | null
  started_at: number
  completed_at: number | null
  updated_at: number
}

export interface WorkflowRunEventRecord {
  id: string
  workflow_id: string
  run_id: string
  sequence: number
  node_id: string | null
  event_type: string
  level: WorkflowRunEventLevel
  message: string
  data_json: string
  created_at: number
}

export interface CreateWorkflowInput {
  id: string
  userId: string
  name: string
  manifestVersion: number
  manifestKey: string
  codeKey: string
  webhookId: string
  createdAt: number
  updatedAt: number
}

export interface UpdateWorkflowInput {
  id: string
  userId: string
  name: string
  status: WorkflowStatus
  manifestVersion: number
  manifestKey: string
  codeKey: string
  updatedAt: number
}

export interface UpdateWorkflowNameInput {
  id: string
  userId: string
  name: string
  updatedAt: number
}

export interface CreateWorkflowRunInput {
  id: string
  workflowId: string
  workflowVersion: number
  workflowInstanceId?: string | null
  userId: string
  triggerKind: WorkflowRunTriggerKind
  triggerNodeId?: string | null
  input: Record<string, unknown>
  status: WorkflowRunStatus
  startedAt: number
  updatedAt: number
}

export interface AddWorkflowRunEventInput {
  id: string
  workflowId: string
  runId: string
  nodeId?: string | null
  eventType: string
  level?: WorkflowRunEventLevel
  message: string
  data?: Record<string, unknown> | null
  createdAt: number
}

export interface ListWorkflowRunsInput {
  workflowId: string
  limit: number
  offset: number
  q?: string
  status?: string
  triggerKind?: string
  sortBy?: string
  sortDir?: string
}

export class WorkflowStore {
  private readonly drizzle
  private readonly schema

  constructor(db: AppDrizzleDatabase | ControlPlaneDb) {
    const handle = resolveControlPlaneHandle(db)
    this.drizzle = handle.drizzle
    this.schema = handle.schema
  }

  private toWorkflowRecord(row: AppSchema["workflows"]["$inferSelect"]): WorkflowRecord {
    return {
      id: row.id,
      user_id: row.userId,
      name: row.name,
      status: row.status as WorkflowStatus,
      manifest_version: row.manifestVersion,
      manifest_key: row.manifestKey,
      code_key: row.codeKey,
      webhook_id: row.webhookId,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }
  }

  private toRunRecord(row: AppSchema["workflowRuns"]["$inferSelect"]): WorkflowRunRecord {
    return {
      id: row.id,
      workflow_id: row.workflowId,
      workflow_version: row.workflowVersion,
      workflow_instance_id: row.workflowInstanceId,
      user_id: row.userId,
      trigger_kind: row.triggerKind as WorkflowRunTriggerKind,
      trigger_node_id: row.triggerNodeId,
      status: row.status as WorkflowRunStatus,
      input_json: row.inputJson,
      output_json: row.outputJson,
      error: row.error,
      started_at: row.startedAt,
      completed_at: row.completedAt,
      updated_at: row.updatedAt,
    }
  }

  private toRunEventRecord(row: AppSchema["workflowRunEvents"]["$inferSelect"]): WorkflowRunEventRecord {
    return {
      id: row.id,
      workflow_id: row.workflowId,
      run_id: row.runId,
      sequence: row.sequence,
      node_id: row.nodeId,
      event_type: row.eventType,
      level: row.level as WorkflowRunEventLevel,
      message: row.message,
      data_json: row.dataJson,
      created_at: row.createdAt,
    }
  }

  createWorkflow = Effect.fn("db.workflows.createWorkflow")(function* (
    this: WorkflowStore,
    input: CreateWorkflowInput,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .insert(this.schema.workflows)
          .values({
            id: input.id,
            userId: input.userId,
            name: input.name,
            status: "active",
            manifestVersion: input.manifestVersion,
            manifestKey: input.manifestKey,
            codeKey: input.codeKey,
            webhookId: input.webhookId,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          })
          .returning(),
      catch: d1Error("db.workflows.createWorkflow"),
    })
    return this.toWorkflowRecord(rows[0])
  })

  updateWorkflow = Effect.fn("db.workflows.updateWorkflow")(function* (
    this: WorkflowStore,
    input: UpdateWorkflowInput,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(this.schema.workflows)
          .set({
            name: input.name,
            status: input.status,
            manifestVersion: input.manifestVersion,
            manifestKey: input.manifestKey,
            codeKey: input.codeKey,
            updatedAt: input.updatedAt,
          })
          .where(and(eq(this.schema.workflows.id, input.id), eq(this.schema.workflows.userId, input.userId)))
          .returning(),
      catch: d1Error("db.workflows.updateWorkflow"),
    })
    return Option.map(Option.fromNullishOr(rows[0]), (row) => this.toWorkflowRecord(row))
  })

  updateWorkflowName = Effect.fn("db.workflows.updateWorkflowName")(function* (
    this: WorkflowStore,
    input: UpdateWorkflowNameInput,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(this.schema.workflows)
          .set({
            name: input.name,
            updatedAt: input.updatedAt,
          })
          .where(and(eq(this.schema.workflows.id, input.id), eq(this.schema.workflows.userId, input.userId)))
          .returning(),
      catch: d1Error("db.workflows.updateWorkflowName"),
    })
    return Option.map(Option.fromNullishOr(rows[0]), (row) => this.toWorkflowRecord(row))
  })

  disableWorkflow = Effect.fn("db.workflows.disableWorkflow")(function* (
    this: WorkflowStore,
    id: string,
    userId: string,
    updatedAt: number,
  ) {
    return yield* this.setWorkflowStatus(
      "db.workflows.disableWorkflow",
      id,
      userId,
      "disabled",
      updatedAt,
    )
  })

  enableWorkflow = Effect.fn("db.workflows.enableWorkflow")(function* (
    this: WorkflowStore,
    id: string,
    userId: string,
    updatedAt: number,
  ) {
    return yield* this.setWorkflowStatus(
      "db.workflows.enableWorkflow",
      id,
      userId,
      "active",
      updatedAt,
    )
  })

  archiveWorkflow = Effect.fn("db.workflows.archiveWorkflow")(function* (
    this: WorkflowStore,
    id: string,
    userId: string,
    updatedAt: number,
  ) {
    return yield* this.setWorkflowStatus(
      "db.workflows.archiveWorkflow",
      id,
      userId,
      "archived",
      updatedAt,
    )
  })

  unarchiveWorkflow = Effect.fn("db.workflows.unarchiveWorkflow")(function* (
    this: WorkflowStore,
    id: string,
    userId: string,
    updatedAt: number,
  ) {
    return yield* this.setWorkflowStatus(
      "db.workflows.unarchiveWorkflow",
      id,
      userId,
      "active",
      updatedAt,
    )
  })

  private setWorkflowStatus = Effect.fn("db.workflows.setWorkflowStatus")(function* (
    this: WorkflowStore,
    operation: string,
    id: string,
    userId: string,
    status: WorkflowStatus,
    updatedAt: number,
  ) {
    const updated = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(this.schema.workflows)
          .set({ status, updatedAt })
          .where(and(eq(this.schema.workflows.id, id), eq(this.schema.workflows.userId, userId)))
          .returning({ id: this.schema.workflows.id }),
      catch: d1Error(operation),
    })
    return updated.length > 0
  })

  getWorkflow = Effect.fn("db.workflows.getWorkflow")(function* (this: WorkflowStore, id: string) {
    const rows = yield* Effect.tryPromise({
      try: () => this.drizzle.select().from(this.schema.workflows).where(eq(this.schema.workflows.id, id)).limit(1),
      catch: d1Error("db.workflows.getWorkflow"),
    })
    return Option.map(Option.fromNullishOr(rows[0]), (row) => this.toWorkflowRecord(row))
  })

  getWorkflowForUser = Effect.fn("db.workflows.getWorkflowForUser")(function* (
    this: WorkflowStore,
    id: string,
    userId: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.workflows)
          .where(and(eq(this.schema.workflows.id, id), eq(this.schema.workflows.userId, userId)))
          .limit(1),
      catch: d1Error("db.workflows.getWorkflowForUser"),
    })
    return Option.map(Option.fromNullishOr(rows[0]), (row) => this.toWorkflowRecord(row))
  })

  getWorkflowByWebhookId = Effect.fn("db.workflows.getWorkflowByWebhookId")(function* (
    this: WorkflowStore,
    webhookId: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle.select().from(this.schema.workflows).where(eq(this.schema.workflows.webhookId, webhookId)).limit(1),
      catch: d1Error("db.workflows.getWorkflowByWebhookId"),
    })
    return Option.map(Option.fromNullishOr(rows[0]), (row) => this.toWorkflowRecord(row))
  })

  listWorkflows = Effect.fn("db.workflows.listWorkflows")(function* (
    this: WorkflowStore,
    input: {
      userId: string
      limit: number
      offset: number
      q?: string
      status?: string
      sortBy?: string
      sortDir?: string
    },
  ) {
    const conditions: SQL[] = [eq(this.schema.workflows.userId, input.userId)]
    Option.match(Option.fromNullishOr(input.status?.trim()).pipe(Option.filter(Boolean)), {
      onNone: () => {
        conditions.push(ne(this.schema.workflows.status, "archived"))
      },
      onSome: (status) => {
        conditions.push(eq(this.schema.workflows.status, status))
      },
    })
    addLikeFilter(conditions, input.q, [this.schema.workflows.name, this.schema.workflows.webhookId])
    const where = and(...conditions)

    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.workflows)
          .where(where)
          .orderBy(orderBy(workflowSortColumns(this.schema), input, "updatedAt"))
          .limit(input.limit + 1)
          .offset(input.offset),
      catch: d1Error("db.workflows.listWorkflows"),
    })

    const countRows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({ total: sql<number>`count(*)` })
          .from(this.schema.workflows)
          .where(where),
      catch: d1Error("db.workflows.listWorkflows"),
    })

    const hasMore = rows.length > input.limit
    const pageRows = Match.value(hasMore).pipe(
      Match.when(true, () => rows.slice(0, input.limit)),
      Match.orElse(() => rows),
    )
    const total = Option.getOrElse(
      Option.map(Option.fromNullishOr(countRows[0]), (row) => row.total),
      () => 0,
    )

    return {
      workflows: pageRows.map((row) => this.toWorkflowRecord(row)),
      total: Number(total),
      hasMore,
    }
  })

  createRun = Effect.fn("db.workflows.createRun")(function* (
    this: WorkflowStore,
    input: CreateWorkflowRunInput,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .insert(this.schema.workflowRuns)
          .values({
            id: input.id,
            workflowId: input.workflowId,
            workflowVersion: input.workflowVersion,
            workflowInstanceId: input.workflowInstanceId ?? null,
            userId: input.userId,
            triggerKind: input.triggerKind,
            triggerNodeId: input.triggerNodeId ?? null,
            status: input.status,
            inputJson: stringifyJson(input.input),
            outputJson: null,
            error: null,
            startedAt: input.startedAt,
            completedAt: null,
            updatedAt: input.updatedAt,
          })
          .returning(),
      catch: d1Error("db.workflows.createRun"),
    })
    return this.toRunRecord(rows[0])
  })

  updateRunInstance = Effect.fn("db.workflows.updateRunInstance")(function* (
    this: WorkflowStore,
    input: {
      runId: string
      workflowInstanceId: string
      status: WorkflowRunStatus
      updatedAt: number
    },
  ) {
    yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(this.schema.workflowRuns)
          .set({
            workflowInstanceId: input.workflowInstanceId,
            status: input.status,
            updatedAt: input.updatedAt,
          })
          .where(eq(this.schema.workflowRuns.id, input.runId)),
      catch: d1Error("db.workflows.updateRunInstance"),
    })
  })

  completeRun = Effect.fn("db.workflows.completeRun")(function* (
    this: WorkflowStore,
    input: {
      runId: string
      workflowId: string
      status: Extract<WorkflowRunStatus, "completed" | "failed">
      output?: Record<string, unknown> | null
      error?: string | null
      completedAt: number
    },
  ) {
    const outputJson = Option.getOrNull(
      Option.map(Option.fromNullishOr(input.output), (output) => stringifyJson(output)),
    )
    yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(this.schema.workflowRuns)
          .set({
            status: input.status,
            outputJson,
            error: input.error ?? null,
            completedAt: input.completedAt,
            updatedAt: input.completedAt,
          })
          .where(
            and(eq(this.schema.workflowRuns.id, input.runId), eq(this.schema.workflowRuns.workflowId, input.workflowId)),
          ),
      catch: d1Error("db.workflows.completeRun"),
    })
  })

  getRun = Effect.fn("db.workflows.getRun")(function* (
    this: WorkflowStore,
    workflowId: string,
    runId: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.workflowRuns)
          .where(and(eq(this.schema.workflowRuns.workflowId, workflowId), eq(this.schema.workflowRuns.id, runId)))
          .limit(1),
      catch: d1Error("db.workflows.getRun"),
    })
    return Option.map(Option.fromNullishOr(rows[0]), (row) => this.toRunRecord(row))
  })

  listRuns = Effect.fn("db.workflows.listRuns")(function* (
    this: WorkflowStore,
    workflowId: string,
    limit = 25,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.workflowRuns)
          .where(eq(this.schema.workflowRuns.workflowId, workflowId))
          .orderBy(desc(this.schema.workflowRuns.updatedAt))
          .limit(limit),
      catch: d1Error("db.workflows.listRuns"),
    })
    return rows.map((row) => this.toRunRecord(row))
  })

  listRunPage = Effect.fn("db.workflows.listRunPage")(function* (
    this: WorkflowStore,
    input: ListWorkflowRunsInput,
  ) {
    const conditions: SQL[] = [eq(this.schema.workflowRuns.workflowId, input.workflowId)]
    Option.match(Option.fromNullishOr(input.status?.trim()).pipe(Option.filter(Boolean)), {
      onNone: () => undefined,
      onSome: (status) => {
        conditions.push(eq(this.schema.workflowRuns.status, status))
      },
    })
    Option.match(Option.fromNullishOr(input.triggerKind?.trim()).pipe(Option.filter(Boolean)), {
      onNone: () => undefined,
      onSome: (triggerKind) => {
        conditions.push(eq(this.schema.workflowRuns.triggerKind, triggerKind))
      },
    })
    addLikeFilter(conditions, input.q, [
      this.schema.workflowRuns.id,
      this.schema.workflowRuns.workflowInstanceId,
      this.schema.workflowRuns.status,
      this.schema.workflowRuns.triggerKind,
      this.schema.workflowRuns.error,
    ])
    const where = and(...conditions)

    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.workflowRuns)
          .where(where)
          .orderBy(orderBy(workflowRunSortColumns(this.schema), input, "updatedAt"))
          .limit(input.limit + 1)
          .offset(input.offset),
      catch: d1Error("db.workflows.listRunPage"),
    })

    const countRows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({ total: sql<number>`count(*)` })
          .from(this.schema.workflowRuns)
          .where(where),
      catch: d1Error("db.workflows.listRunPage"),
    })

    const allCountRows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({ total: sql<number>`count(*)` })
          .from(this.schema.workflowRuns)
          .where(eq(this.schema.workflowRuns.workflowId, input.workflowId)),
      catch: d1Error("db.workflows.listRunPage"),
    })

    const errorCountRows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({ total: sql<number>`count(*)` })
          .from(this.schema.workflowRuns)
          .where(
            and(
              eq(this.schema.workflowRuns.workflowId, input.workflowId),
              eq(this.schema.workflowRuns.status, "failed"),
              gte(this.schema.workflowRuns.updatedAt, Date.now() - 86_400_000),
            ),
          ),
      catch: d1Error("db.workflows.listRunPage"),
    })

    const hasMore = rows.length > input.limit
    const pageRows = Match.value(hasMore).pipe(
      Match.when(true, () => rows.slice(0, input.limit)),
      Match.orElse(() => rows),
    )
    const total = Option.getOrElse(
      Option.map(Option.fromNullishOr(countRows[0]), (row) => row.total),
      () => 0,
    )
    const totalRuns = Option.getOrElse(
      Option.map(Option.fromNullishOr(allCountRows[0]), (row) => row.total),
      () => 0,
    )
    const errorsLast24Hours = Option.getOrElse(
      Option.map(Option.fromNullishOr(errorCountRows[0]), (row) => row.total),
      () => 0,
    )

    return {
      runs: pageRows.map((row) => this.toRunRecord(row)),
      total: Number(total),
      totalRuns: Number(totalRuns),
      errorsLast24Hours: Number(errorsLast24Hours),
      hasMore,
    }
  })

  deleteRun = Effect.fn("db.workflows.deleteRun")(function* (
    this: WorkflowStore,
    workflowId: string,
    runId: string,
  ) {
    yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .delete(this.schema.workflowRunEvents)
          .where(
            and(eq(this.schema.workflowRunEvents.workflowId, workflowId), eq(this.schema.workflowRunEvents.runId, runId)),
          ),
      catch: d1Error("db.workflows.deleteRun"),
    })

    const deletedRuns = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .delete(this.schema.workflowRuns)
          .where(and(eq(this.schema.workflowRuns.workflowId, workflowId), eq(this.schema.workflowRuns.id, runId)))
          .returning({ id: this.schema.workflowRuns.id }),
      catch: d1Error("db.workflows.deleteRun"),
    })

    return deletedRuns.length > 0
  })

  addRunEvent = Effect.fn("db.workflows.addRunEvent")(function* (
    this: WorkflowStore,
    input: AddWorkflowRunEventInput,
  ) {
    const sequenceRows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({ sequence: sql<number>`coalesce(max(${this.schema.workflowRunEvents.sequence}), 0) + 1` })
          .from(this.schema.workflowRunEvents)
          .where(eq(this.schema.workflowRunEvents.runId, input.runId)),
      catch: d1Error("db.workflows.addRunEvent"),
    })
    const sequence = Option.getOrElse(
      Option.map(Option.fromNullishOr(sequenceRows[0]), (row) => row.sequence),
      () => 1,
    )

    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .insert(this.schema.workflowRunEvents)
          .values({
            id: input.id,
            workflowId: input.workflowId,
            runId: input.runId,
            sequence,
            nodeId: input.nodeId ?? null,
            eventType: input.eventType,
            level: input.level ?? "info",
            message: input.message,
            dataJson: stringifyJson(input.data ?? {}),
            createdAt: input.createdAt,
          })
          .onConflictDoNothing({ target: this.schema.workflowRunEvents.id })
          .returning(),
      catch: d1Error("db.workflows.addRunEvent"),
    })
    const existingRows = yield* Match.value(rows.length).pipe(
      Match.when(0, () =>
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .select()
              .from(this.schema.workflowRunEvents)
              .where(eq(this.schema.workflowRunEvents.id, input.id))
              .limit(1),
          catch: d1Error("db.workflows.addRunEvent.readExisting"),
        }),
      ),
      Match.orElse(() => Effect.succeed(rows)),
    )
    return this.toRunEventRecord(
      Option.getOrThrowWith(
        Option.fromNullishOr(existingRows[0]),
        () => new Error(`Workflow run event '${input.id}' was not persisted`),
      ),
    )
  })

  listRunEvents = Effect.fn("db.workflows.listRunEvents")(function* (
    this: WorkflowStore,
    workflowId: string,
    runId: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.workflowRunEvents)
          .where(
            and(eq(this.schema.workflowRunEvents.workflowId, workflowId), eq(this.schema.workflowRunEvents.runId, runId)),
          )
          .orderBy(this.schema.workflowRunEvents.sequence),
      catch: d1Error("db.workflows.listRunEvents"),
    })
    return rows.map((row) => this.toRunEventRecord(row))
  })
}

// oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Promise-boundary bridge: A is the type parameter, so the D1Error channel must be named explicitly here.
function runWorkflowStoreEffect<A>(effect: Effect.Effect<A, D1Error>): Promise<A> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary bridging the Effect WorkflowStore to non-Effect background workflow runtime modules (runner, alarm, routers, nodes, lifecycle).
  return Effect.runPromise(effect)
}

function runWorkflowStoreOption<A>(
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Promise-boundary bridge: A is the type parameter, so the D1Error channel must be named explicitly here.
  effect: Effect.Effect<Option.Option<A>, D1Error>,
): Promise<A | null> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary bridging the Effect WorkflowStore to non-Effect background workflow runtime modules (runner, alarm, routers, nodes, lifecycle).
  return Effect.runPromise(effect.pipe(Effect.map(Option.getOrNull)))
}

/**
 * Promise-facing view of {@link WorkflowStore} for the non-Effect background workflow runtime
 * (durable runner, alarm scheduler, public webhook/Slack routers, workflow nodes, lifecycle).
 * Each method runs the underlying Effect at this boundary and re-surfaces nullable reads as
 * `T | null` so imperative callers keep their previous contracts.
 */
export interface WorkflowStorePromise {
  createWorkflow(input: CreateWorkflowInput): Promise<WorkflowRecord>
  updateWorkflow(input: UpdateWorkflowInput): Promise<WorkflowRecord | null>
  updateWorkflowName(input: UpdateWorkflowNameInput): Promise<WorkflowRecord | null>
  disableWorkflow(id: string, userId: string, updatedAt: number): Promise<boolean>
  enableWorkflow(id: string, userId: string, updatedAt: number): Promise<boolean>
  archiveWorkflow(id: string, userId: string, updatedAt: number): Promise<boolean>
  unarchiveWorkflow(id: string, userId: string, updatedAt: number): Promise<boolean>
  getWorkflow(id: string): Promise<WorkflowRecord | null>
  getWorkflowForUser(id: string, userId: string): Promise<WorkflowRecord | null>
  getWorkflowByWebhookId(webhookId: string): Promise<WorkflowRecord | null>
  listWorkflows(input: {
    userId: string
    limit: number
    offset: number
    q?: string
    status?: string
    sortBy?: string
    sortDir?: string
  }): Promise<{ workflows: WorkflowRecord[]; total: number; hasMore: boolean }>
  createRun(input: CreateWorkflowRunInput): Promise<WorkflowRunRecord>
  updateRunInstance(input: {
    runId: string
    workflowInstanceId: string
    status: WorkflowRunStatus
    updatedAt: number
  }): Promise<void>
  completeRun(input: {
    runId: string
    workflowId: string
    status: Extract<WorkflowRunStatus, "completed" | "failed">
    output?: Record<string, unknown> | null
    error?: string | null
    completedAt: number
  }): Promise<void>
  getRun(workflowId: string, runId: string): Promise<WorkflowRunRecord | null>
  listRuns(workflowId: string, limit?: number): Promise<WorkflowRunRecord[]>
  deleteRun(workflowId: string, runId: string): Promise<boolean>
  addRunEvent(input: AddWorkflowRunEventInput): Promise<WorkflowRunEventRecord>
  listRunEvents(workflowId: string, runId: string): Promise<WorkflowRunEventRecord[]>
}

export function createWorkflowStoreFromD1(db: D1Database): WorkflowStorePromise {
  const store = new WorkflowStore(makeD1Drizzle(db))
  return {
    createWorkflow: (input) => runWorkflowStoreEffect(store.createWorkflow(input)),
    updateWorkflow: (input) => runWorkflowStoreOption(store.updateWorkflow(input)),
    updateWorkflowName: (input) => runWorkflowStoreOption(store.updateWorkflowName(input)),
    disableWorkflow: (id, userId, updatedAt) =>
      runWorkflowStoreEffect(store.disableWorkflow(id, userId, updatedAt)),
    enableWorkflow: (id, userId, updatedAt) =>
      runWorkflowStoreEffect(store.enableWorkflow(id, userId, updatedAt)),
    archiveWorkflow: (id, userId, updatedAt) =>
      runWorkflowStoreEffect(store.archiveWorkflow(id, userId, updatedAt)),
    unarchiveWorkflow: (id, userId, updatedAt) =>
      runWorkflowStoreEffect(store.unarchiveWorkflow(id, userId, updatedAt)),
    getWorkflow: (id) => runWorkflowStoreOption(store.getWorkflow(id)),
    getWorkflowForUser: (id, userId) =>
      runWorkflowStoreOption(store.getWorkflowForUser(id, userId)),
    getWorkflowByWebhookId: (webhookId) =>
      runWorkflowStoreOption(store.getWorkflowByWebhookId(webhookId)),
    listWorkflows: (input) => runWorkflowStoreEffect(store.listWorkflows(input)),
    createRun: (input) => runWorkflowStoreEffect(store.createRun(input)),
    updateRunInstance: (input) => runWorkflowStoreEffect(store.updateRunInstance(input)),
    completeRun: (input) => runWorkflowStoreEffect(store.completeRun(input)),
    getRun: (workflowId, runId) => runWorkflowStoreOption(store.getRun(workflowId, runId)),
    listRuns: (workflowId, limit) => runWorkflowStoreEffect(store.listRuns(workflowId, limit)),
    deleteRun: (workflowId, runId) => runWorkflowStoreEffect(store.deleteRun(workflowId, runId)),
    addRunEvent: (input) => runWorkflowStoreEffect(store.addRunEvent(input)),
    listRunEvents: (workflowId, runId) =>
      runWorkflowStoreEffect(store.listRunEvents(workflowId, runId)),
  }
}
