import type { AdminListQuery, AdminWorkflowListQuery } from "@solzero/api"
import { resolveAgentRuntime } from "@solzero/shared"
import { and, asc, desc, eq, lt, or, sql, type AnyColumn, type SQL } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { parseJsonOrText } from "../../lib/json"
import {
  controlPlaneSql,
  resolveControlPlaneHandle,
  type AppDrizzleDatabase,
  type AppSchema,
  type ControlPlaneDb,
} from "../../effect/db/control-plane-db"
import { asFiniteNumber } from "../../effect/db/dialect"
import { d1Error } from "./errors"

export interface AdminStatusCount {
  status: string
  count: number
}

export interface AdminAttentionItem {
  id: string
  severity: "warn" | "error"
  label: string
  detail: string
  targetType: string
  targetId: string
  status?: string
  updatedAt?: number
}

export interface AdminSessionRecord {
  id: string
  userId: string
  userName: string | null
  userEmail: string | null
  sessionKind: string
  agentRuntime: string
  source: string
  title: string | null
  repoOwner: string
  repoName: string
  model: string
  reasoningEffort: string | null
  status: string
  createdAt: number
  updatedAt: number
}

export interface AdminWorkflowRunRecord {
  id: string
  workflowId: string
  workflowVersion: number
  workflowInstanceId: string | null
  userId: string
  triggerKind: string
  triggerNodeId: string | null
  status: string
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  error: string | null
  startedAt: number
  completedAt: number | null
  updatedAt: number
}

export interface AdminWorkflowRunEvent {
  id: string
  workflowId: string
  runId: string
  sequence: number
  nodeId: string | null
  eventType: string
  level: string
  message: string
  data: Record<string, unknown>
  createdAt: number
}

export interface AdminWorkflowRecord {
  id: string
  userId: string
  userName: string | null
  userEmail: string | null
  name: string
  status: string
  manifestVersion: number
  manifestKey: string
  codeKey: string
  webhookId: string
  createdAt: number
  updatedAt: number
  latestRun: AdminWorkflowRunRecord | null
  runCounts: AdminStatusCount[]
}

export interface AdminGitHubAccountCleanupPreview {
  affectedUsers: number
  linkedAccounts: number
}

export interface AdminGitHubAccountCleanupResult extends AdminGitHubAccountCleanupPreview {
  userIds: string[]
}

interface SessionSelectRow {
  id: string
  userId: string
  userName: string | null
  userEmail: string | null
  sessionKind: string
  agentRuntime: string | null
  source: string
  title: string | null
  repoOwner: string
  repoName: string
  model: string
  reasoningEffort: string | null
  status: string
  createdAt: number
  updatedAt: number
}

interface WorkflowSelectRow {
  id: string
  userId: string
  userName: string | null
  userEmail: string | null
  name: string
  status: string
  manifestVersion: number
  manifestKey: string
  codeKey: string
  webhookId: string
  createdAt: number
  updatedAt: number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

function sessionSelect(schema: AppSchema) {
  return {
    id: schema.sessions.id,
    userId: schema.sessions.userId,
    userName: schema.user.name,
    userEmail: schema.user.email,
    sessionKind: schema.sessions.sessionKind,
    agentRuntime: schema.sessions.agentRuntime,
    source: schema.sessions.source,
    title: schema.sessions.title,
    repoOwner: schema.sessions.repoOwner,
    repoName: schema.sessions.repoName,
    model: schema.sessions.model,
    reasoningEffort: schema.sessions.reasoningEffort,
    status: schema.sessions.status,
    createdAt: schema.sessions.createdAt,
    updatedAt: schema.sessions.updatedAt,
  }
}

function workflowSelect(schema: AppSchema) {
  return {
    id: schema.workflows.id,
    userId: schema.workflows.userId,
    userName: schema.user.name,
    userEmail: schema.user.email,
    name: schema.workflows.name,
    status: schema.workflows.status,
    manifestVersion: schema.workflows.manifestVersion,
    manifestKey: schema.workflows.manifestKey,
    codeKey: schema.workflows.codeKey,
    webhookId: schema.workflows.webhookId,
    createdAt: schema.workflows.createdAt,
    updatedAt: schema.workflows.updatedAt,
  }
}

function sessionSortColumns(schema: AppSchema) {
  return {
    id: schema.sessions.id,
    title: schema.sessions.title,
    userId: schema.sessions.userId,
    userEmail: schema.user.email,
    sessionKind: schema.sessions.sessionKind,
    agentRuntime: schema.sessions.agentRuntime,
    source: schema.sessions.source,
    repoOwner: schema.sessions.repoOwner,
    repoName: schema.sessions.repoName,
    model: schema.sessions.model,
    status: schema.sessions.status,
    createdAt: schema.sessions.createdAt,
    updatedAt: schema.sessions.updatedAt,
  } satisfies Record<string, AnyColumn>
}

function workflowSortColumns(schema: AppSchema) {
  return {
    id: schema.workflows.id,
    name: schema.workflows.name,
    userId: schema.workflows.userId,
    userEmail: schema.user.email,
    status: schema.workflows.status,
    manifestVersion: schema.workflows.manifestVersion,
    webhookId: schema.workflows.webhookId,
    createdAt: schema.workflows.createdAt,
    updatedAt: schema.workflows.updatedAt,
  } satisfies Record<string, AnyColumn>
}

function parseListNumber(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value)
  return Match.value(!Number.isFinite(parsed) || parsed < 0).pipe(
    Match.when(true, () => fallback),
    Match.orElse(() => Math.min(Math.floor(parsed), max)),
  )
}

// `parseJsonOrText` returns the original string unchanged when it is not valid JSON, which lets us
// surface a parse-error record without a try/catch boundary.
function classifyParsedRecord(
  parsed: unknown,
  raw: string,
): Option.Option<Record<string, unknown>> {
  return Match.value(parsed === raw).pipe(
    Match.when(true, () =>
      Option.some({ parseError: "Invalid JSON", raw } as Record<string, unknown>),
    ),
    Match.orElse(() =>
      Match.value(Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed)).pipe(
        Match.when(true, () => Option.some(parsed as Record<string, unknown>)),
        Match.orElse(() => Option.some({} as Record<string, unknown>)),
      ),
    ),
  )
}

function parseRecordOption(value: string | null): Option.Option<Record<string, unknown>> {
  return Option.flatMap(Option.fromNullishOr(value).pipe(Option.filter(Boolean)), (raw) =>
    classifyParsedRecord(parseJsonOrText(raw), raw),
  )
}

function toStatusCount(row: { status: string; count: unknown }): AdminStatusCount {
  return {
    status: row.status,
    count: asFiniteNumber(row.count),
  }
}

function toSession(row: SessionSelectRow): AdminSessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    userEmail: row.userEmail,
    sessionKind: row.sessionKind,
    agentRuntime: resolveAgentRuntime({
      agentRuntime: row.agentRuntime,
      sessionKind: row.sessionKind,
    }),
    source: row.source,
    title: row.title,
    repoOwner: row.repoOwner,
    repoName: row.repoName,
    model: row.model,
    reasoningEffort: row.reasoningEffort,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toWorkflowRun(row: AppSchema["workflowRuns"]["$inferSelect"]): AdminWorkflowRunRecord {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowVersion: row.workflowVersion,
    workflowInstanceId: row.workflowInstanceId,
    userId: row.userId,
    triggerKind: row.triggerKind,
    triggerNodeId: row.triggerNodeId,
    status: row.status,
    input: Option.getOrElse(
      parseRecordOption(row.inputJson),
      () => ({}) as Record<string, unknown>,
    ),
    output: Option.getOrNull(parseRecordOption(row.outputJson)),
    error: row.error,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  }
}

function toWorkflow(
  row: WorkflowSelectRow,
  input: {
    latestRun: AdminWorkflowRunRecord | null
    runCounts: AdminStatusCount[]
  },
): AdminWorkflowRecord {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    userEmail: row.userEmail,
    name: row.name,
    status: row.status,
    manifestVersion: row.manifestVersion,
    manifestKey: row.manifestKey,
    codeKey: row.codeKey,
    webhookId: row.webhookId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    latestRun: input.latestRun,
    runCounts: input.runCounts,
  }
}

function toWorkflowRunEvent(
  row: AppSchema["workflowRunEvents"]["$inferSelect"],
): AdminWorkflowRunEvent {
  return {
    id: row.id,
    workflowId: row.workflowId,
    runId: row.runId,
    sequence: row.sequence,
    nodeId: row.nodeId,
    eventType: row.eventType,
    level: row.level,
    message: row.message,
    data: Option.getOrElse(parseRecordOption(row.dataJson), () => ({}) as Record<string, unknown>),
    createdAt: row.createdAt,
  }
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

function addExactFilter(conditions: SQL[], column: AnyColumn, value: string | undefined) {
  Option.match(Option.fromNullishOr(value?.trim()).pipe(Option.filter(Boolean)), {
    onNone: () => undefined,
    onSome: (trimmed) => {
      conditions.push(eq(column, trimmed))
    },
  })
}

function combineConditions(conditions: SQL[]) {
  return Match.value(conditions.length > 0).pipe(
    Match.when(true, () => and(...conditions)),
    Match.orElse(() => undefined),
  )
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

export class AdminStore {
  private readonly drizzle
  private readonly schema
  private readonly sql

  constructor(db: AppDrizzleDatabase | ControlPlaneDb) {
    const handle = resolveControlPlaneHandle(db)
    this.drizzle = handle.drizzle
    this.schema = handle.schema
    this.sql = controlPlaneSql(handle)
  }

  getSummary = Effect.fn("db.admin.getSummary")(function* (this: AdminStore, now = Date.now()) {
    const [sessions, workflows, runs, attention] = yield* Effect.all(
      [
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .select({ status: this.schema.sessions.status, count: this.sql.countStar() })
              .from(this.schema.sessions)
              .groupBy(this.schema.sessions.status)
              .orderBy(asc(this.schema.sessions.status)),
          catch: d1Error("db.admin.getSummary"),
        }),
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .select({ status: this.schema.workflows.status, count: this.sql.countStar() })
              .from(this.schema.workflows)
              .groupBy(this.schema.workflows.status)
              .orderBy(asc(this.schema.workflows.status)),
          catch: d1Error("db.admin.getSummary"),
        }),
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .select({ status: this.schema.workflowRuns.status, count: this.sql.countStar() })
              .from(this.schema.workflowRuns)
              .groupBy(this.schema.workflowRuns.status)
              .orderBy(asc(this.schema.workflowRuns.status)),
          catch: d1Error("db.admin.getSummary"),
        }),
        this.listAttentionItems(now),
      ],
      { concurrency: "unbounded" },
    )

    return {
      sessions: sessions.map(toStatusCount),
      workflows: workflows.map(toStatusCount),
      workflowRuns: runs.map(toStatusCount),
      attention,
    }
  })

  listSessions = Effect.fn("db.admin.listSessions")(function* (
    this: AdminStore,
    query: AdminListQuery,
  ) {
    const limit = parseListNumber(query.limit, DEFAULT_LIMIT, MAX_LIMIT)
    const offset = parseListNumber(query.offset, 0, Number.MAX_SAFE_INTEGER)
    const conditions: SQL[] = []

    addLikeFilter(conditions, query.q, [
      this.schema.sessions.id,
      this.schema.sessions.title,
      this.schema.sessions.repoOwner,
      this.schema.sessions.repoName,
      this.schema.user.name,
      this.schema.user.email,
    ])
    addExactFilter(conditions, this.schema.sessions.status, query.status)
    addExactFilter(conditions, this.schema.sessions.agentRuntime, query.agentRuntime)
    addExactFilter(conditions, this.schema.sessions.sessionKind, query.kind)
    addExactFilter(conditions, this.schema.sessions.source, query.source)
    addExactFilter(conditions, this.schema.sessions.userId, query.userId)
    addExactFilter(conditions, this.schema.sessions.repoOwner, query.repoOwner)
    addExactFilter(conditions, this.schema.sessions.repoName, query.repoName)

    const where = combineConditions(conditions)
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select(sessionSelect(this.schema))
          .from(this.schema.sessions)
          .leftJoin(this.schema.user, eq(this.schema.user.id, this.schema.sessions.userId))
          .where(where)
          .orderBy(orderBy(sessionSortColumns(this.schema), query, "updatedAt"))
          .limit(limit + 1)
          .offset(offset),
      catch: d1Error("db.admin.listSessions"),
    })

    const countRows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({ total: this.sql.countStar() })
          .from(this.schema.sessions)
          .leftJoin(this.schema.user, eq(this.schema.user.id, this.schema.sessions.userId))
          .where(where),
      catch: d1Error("db.admin.listSessions"),
    })

    const hasMore = rows.length > limit
    const pageRows = Match.value(hasMore).pipe(
      Match.when(true, () => rows.slice(0, limit)),
      Match.orElse(() => rows),
    )

    return {
      sessions: pageRows.map(toSession),
      total: asFiniteNumber(countRows[0]?.total),
      limit,
      offset,
      hasMore,
    }
  })

  getSession = Effect.fn("db.admin.getSession")(function* (this: AdminStore, id: string) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select(sessionSelect(this.schema))
          .from(this.schema.sessions)
          .leftJoin(this.schema.user, eq(this.schema.user.id, this.schema.sessions.userId))
          .where(eq(this.schema.sessions.id, id))
          .limit(1),
      catch: d1Error("db.admin.getSession"),
    })
    return Option.map(Option.fromNullishOr(rows[0]), toSession)
  })

  listWorkflows = Effect.fn("db.admin.listWorkflows")(function* (
    this: AdminStore,
    query: AdminWorkflowListQuery,
  ) {
    const limit = parseListNumber(query.limit, DEFAULT_LIMIT, MAX_LIMIT)
    const offset = parseListNumber(query.offset, 0, Number.MAX_SAFE_INTEGER)
    const conditions: SQL[] = []

    addLikeFilter(conditions, query.q, [
      this.schema.workflows.id,
      this.schema.workflows.name,
      this.schema.workflows.webhookId,
      this.schema.user.name,
      this.schema.user.email,
    ])
    addExactFilter(conditions, this.schema.workflows.status, query.status)
    addExactFilter(conditions, this.schema.workflows.userId, query.userId)

    const where = combineConditions(conditions)
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select(workflowSelect(this.schema))
          .from(this.schema.workflows)
          .leftJoin(this.schema.user, eq(this.schema.user.id, this.schema.workflows.userId))
          .where(where)
          .orderBy(orderBy(workflowSortColumns(this.schema), query, "updatedAt"))
          .limit(limit + 1)
          .offset(offset),
      catch: d1Error("db.admin.listWorkflows"),
    })

    const countRows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({ total: this.sql.countStar() })
          .from(this.schema.workflows)
          .leftJoin(this.schema.user, eq(this.schema.user.id, this.schema.workflows.userId))
          .where(where),
      catch: d1Error("db.admin.listWorkflows"),
    })

    const hasMore = rows.length > limit
    const pageRows = Match.value(hasMore).pipe(
      Match.when(true, () => rows.slice(0, limit)),
      Match.orElse(() => rows),
    )

    const workflows = yield* Effect.forEach(pageRows, (row) => this.buildWorkflowRecord(row), {
      concurrency: "unbounded",
    })

    return {
      workflows,
      total: asFiniteNumber(countRows[0]?.total),
      limit,
      offset,
      hasMore,
    }
  })

  getWorkflow = Effect.fn("db.admin.getWorkflow")(function* (this: AdminStore, id: string) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select(workflowSelect(this.schema))
          .from(this.schema.workflows)
          .leftJoin(this.schema.user, eq(this.schema.user.id, this.schema.workflows.userId))
          .where(eq(this.schema.workflows.id, id))
          .limit(1),
      catch: d1Error("db.admin.getWorkflow"),
    })
    return yield* Option.match(Option.fromNullishOr(rows[0]), {
      onNone: () => Effect.succeed(Option.none<AdminWorkflowRecord>()),
      onSome: (row) => this.buildWorkflowRecordOption(row),
    })
  })

  private buildWorkflowRecordOption = Effect.fn("db.admin.buildWorkflowRecordOption")(function* (
    this: AdminStore,
    row: WorkflowSelectRow,
  ) {
    const record = yield* this.buildWorkflowRecord(row)
    return Option.some(record)
  })

  private buildWorkflowRecord = Effect.fn("db.admin.buildWorkflowRecord")(function* (
    this: AdminStore,
    row: WorkflowSelectRow,
  ) {
    const latestRun = yield* this.getLatestWorkflowRun(row.id)
    const runCounts = yield* this.getWorkflowRunCounts(row.id)
    return toWorkflow(row, { latestRun: Option.getOrNull(latestRun), runCounts })
  })

  listWorkflowRuns = Effect.fn("db.admin.listWorkflowRuns")(function* (
    this: AdminStore,
    workflowId: string,
    limit = 50,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.workflowRuns)
          .where(eq(this.schema.workflowRuns.workflowId, workflowId))
          .orderBy(desc(this.schema.workflowRuns.updatedAt))
          .limit(limit),
      catch: d1Error("db.admin.listWorkflowRuns"),
    })
    return rows.map(toWorkflowRun)
  })

  getWorkflowRun = Effect.fn("db.admin.getWorkflowRun")(function* (
    this: AdminStore,
    workflowId: string,
    runId: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.workflowRuns)
          .where(
            and(
              eq(this.schema.workflowRuns.workflowId, workflowId),
              eq(this.schema.workflowRuns.id, runId),
            ),
          )
          .limit(1),
      catch: d1Error("db.admin.getWorkflowRun"),
    })
    return Option.map(Option.fromNullishOr(rows[0]), toWorkflowRun)
  })

  listWorkflowRunEvents = Effect.fn("db.admin.listWorkflowRunEvents")(function* (
    this: AdminStore,
    workflowId: string,
    runId: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.workflowRunEvents)
          .where(
            and(
              eq(this.schema.workflowRunEvents.workflowId, workflowId),
              eq(this.schema.workflowRunEvents.runId, runId),
            ),
          )
          .orderBy(asc(this.schema.workflowRunEvents.sequence)),
      catch: d1Error("db.admin.listWorkflowRunEvents"),
    })
    return rows.map(toWorkflowRunEvent)
  })

  archiveWorkflow = Effect.fn("db.admin.archiveWorkflow")(function* (
    this: AdminStore,
    id: string,
    updatedAt: number,
  ) {
    const updated = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(this.schema.workflows)
          .set({ status: "archived", updatedAt })
          .where(eq(this.schema.workflows.id, id))
          .returning({ id: this.schema.workflows.id }),
      catch: d1Error("db.admin.archiveWorkflow"),
    })
    return updated.length > 0
  })

  unarchiveWorkflow = Effect.fn("db.admin.unarchiveWorkflow")(function* (
    this: AdminStore,
    id: string,
    updatedAt: number,
  ) {
    const updated = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(this.schema.workflows)
          .set({ status: "active", updatedAt })
          .where(eq(this.schema.workflows.id, id))
          .returning({ id: this.schema.workflows.id }),
      catch: d1Error("db.admin.unarchiveWorkflow"),
    })
    return updated.length > 0
  })

  deleteSession = Effect.fn("db.admin.deleteSession")(function* (this: AdminStore, id: string) {
    const deleted = yield* Effect.tryPromise({
      try: () =>
        this.drizzle.delete(this.schema.sessions).where(eq(this.schema.sessions.id, id)).returning({
          id: this.schema.sessions.id,
        }),
      catch: d1Error("db.admin.deleteSession"),
    })
    return deleted.length > 0
  })

  updateSessionStatus = Effect.fn("db.admin.updateSessionStatus")(function* (
    this: AdminStore,
    id: string,
    status: string,
    updatedAt: number,
  ) {
    const updated = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(this.schema.sessions)
          .set({ status, updatedAt })
          .where(eq(this.schema.sessions.id, id))
          .returning({ id: this.schema.sessions.id }),
      catch: d1Error("db.admin.updateSessionStatus"),
    })
    return updated.length > 0
  })

  previewGitHubAccountCleanup = Effect.fn("db.admin.previewGitHubAccountCleanup")(
    function* (this: AdminStore) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          this.drizzle
            .select({
              linkedAccounts: sql<number>`count(*)`,
              affectedUsers: sql<number>`count(distinct ${this.schema.account.userId})`,
            })
            .from(this.schema.account)
            .where(eq(this.schema.account.providerId, "github")),
        catch: d1Error("db.admin.previewGitHubAccountCleanup"),
      })

      return {
        linkedAccounts: Number(rows[0]?.linkedAccounts ?? 0),
        affectedUsers: Number(rows[0]?.affectedUsers ?? 0),
      }
    },
  )

  cleanupGitHubAccounts = Effect.fn("db.admin.cleanupGitHubAccounts")(function* (this: AdminStore) {
    const deleted = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .delete(this.schema.account)
          .where(eq(this.schema.account.providerId, "github"))
          .returning({ userId: this.schema.account.userId }),
      catch: d1Error("db.admin.cleanupGitHubAccounts"),
    })
    const userIds = [...new Set(deleted.map((row) => row.userId))]

    return {
      linkedAccounts: deleted.length,
      affectedUsers: userIds.length,
      userIds,
    }
  })

  recordAudit = Effect.fn("db.admin.recordAudit")(function* (
    this: AdminStore,
    input: {
      id: string
      adminUserId: string
      adminEmail: string
      targetType: string
      targetId: string
      action: string
      reason?: string | null
      result: string
      status: number
      message?: string | null
      createdAt: number
    },
  ) {
    yield* Effect.tryPromise({
      try: () =>
        this.drizzle.insert(this.schema.adminAuditEvents).values({
          id: input.id,
          adminUserId: input.adminUserId,
          adminEmail: input.adminEmail,
          targetType: input.targetType,
          targetId: input.targetId,
          action: input.action,
          reason: input.reason ?? null,
          result: input.result,
          status: input.status,
          message: input.message ?? null,
          createdAt: input.createdAt,
        }),
      catch: d1Error("db.admin.recordAudit"),
    })
  })

  private getLatestWorkflowRun = Effect.fn("db.admin.getLatestWorkflowRun")(function* (
    this: AdminStore,
    workflowId: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.workflowRuns)
          .where(eq(this.schema.workflowRuns.workflowId, workflowId))
          .orderBy(desc(this.schema.workflowRuns.updatedAt))
          .limit(1),
      catch: d1Error("db.admin.getLatestWorkflowRun"),
    })
    return Option.map(Option.fromNullishOr(rows[0]), toWorkflowRun)
  })

  private getWorkflowRunCounts = Effect.fn("db.admin.getWorkflowRunCounts")(function* (
    this: AdminStore,
    workflowId: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({ status: this.schema.workflowRuns.status, count: this.sql.countStar() })
          .from(this.schema.workflowRuns)
          .where(eq(this.schema.workflowRuns.workflowId, workflowId))
          .groupBy(this.schema.workflowRuns.status)
          .orderBy(asc(this.schema.workflowRuns.status)),
      catch: d1Error("db.admin.getWorkflowRunCounts"),
    })
    return rows.map(toStatusCount)
  })

  private listAttentionItems = Effect.fn("db.admin.listAttentionItems")(function* (
    this: AdminStore,
    now: number,
  ) {
    const queuedThreshold = now - 5 * 60 * 1000
    const runningThreshold = now - 60 * 60 * 1000
    const activeSessionThreshold = now - 30 * 60 * 1000

    const [failedRuns, queuedRuns, runningRuns, inactiveSessions] = yield* Effect.all(
      [
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .select()
              .from(this.schema.workflowRuns)
              .where(eq(this.schema.workflowRuns.status, "failed"))
              .orderBy(desc(this.schema.workflowRuns.updatedAt))
              .limit(10),
          catch: d1Error("db.admin.listAttentionItems"),
        }),
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .select()
              .from(this.schema.workflowRuns)
              .where(
                and(
                  eq(this.schema.workflowRuns.status, "queued"),
                  lt(this.schema.workflowRuns.updatedAt, queuedThreshold),
                ),
              )
              .orderBy(asc(this.schema.workflowRuns.updatedAt))
              .limit(10),
          catch: d1Error("db.admin.listAttentionItems"),
        }),
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .select()
              .from(this.schema.workflowRuns)
              .where(
                and(
                  eq(this.schema.workflowRuns.status, "running"),
                  lt(this.schema.workflowRuns.updatedAt, runningThreshold),
                ),
              )
              .orderBy(asc(this.schema.workflowRuns.updatedAt))
              .limit(10),
          catch: d1Error("db.admin.listAttentionItems"),
        }),
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .select(sessionSelect(this.schema))
              .from(this.schema.sessions)
              .leftJoin(this.schema.user, eq(this.schema.user.id, this.schema.sessions.userId))
              .where(
                and(
                  eq(this.schema.sessions.status, "active"),
                  lt(this.schema.sessions.updatedAt, activeSessionThreshold),
                ),
              )
              .orderBy(asc(this.schema.sessions.updatedAt))
              .limit(10),
          catch: d1Error("db.admin.listAttentionItems"),
        }),
      ],
      { concurrency: "unbounded" },
    )

    return [
      ...failedRuns.map((run) => ({
        id: `run-failed-${run.id}`,
        severity: "error" as const,
        label: "Workflow run failed",
        detail: run.error ?? run.id,
        targetType: "workflow_run",
        targetId: run.id,
        status: run.status,
        updatedAt: run.updatedAt,
      })),
      ...queuedRuns.map((run) => ({
        id: `run-queued-${run.id}`,
        severity: "warn" as const,
        label: "Workflow run queued too long",
        detail: run.id,
        targetType: "workflow_run",
        targetId: run.id,
        status: run.status,
        updatedAt: run.updatedAt,
      })),
      ...runningRuns.map((run) => ({
        id: `run-running-${run.id}`,
        severity: "warn" as const,
        label: "Workflow run running too long",
        detail: run.id,
        targetType: "workflow_run",
        targetId: run.id,
        status: run.status,
        updatedAt: run.updatedAt,
      })),
      ...inactiveSessions.map((session) => ({
        id: `session-inactive-${session.id}`,
        severity: "warn" as const,
        label: "Active session has no recent update",
        detail: session.title ?? session.id,
        targetType: "session",
        targetId: session.id,
        status: session.status,
        updatedAt: session.updatedAt,
      })),
    ]
      .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
      .slice(0, 25)
  })
}
