import type { AdminListQuery, AdminWorkflowListQuery } from "@c0/api"
import { resolveAgentRuntime } from "@c0-agent/shared"
import { and, asc, desc, eq, lt, or, sql, type AnyColumn, type SQL } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { parseJsonOrText } from "../../lib/json"
import { makeD1Drizzle } from "../../effect/db/d1-drizzle"
import {
  adminAuditEvents,
  account as accountRows,
  sessions as sessionRows,
  user as userRows,
  workflowRunEvents,
  workflowRuns,
  workflows as workflowRows,
} from "../../effect/db/schema"
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

const sessionSelect = {
  id: sessionRows.id,
  userId: sessionRows.userId,
  userName: userRows.name,
  userEmail: userRows.email,
  sessionKind: sessionRows.sessionKind,
  agentRuntime: sessionRows.agentRuntime,
  source: sessionRows.source,
  title: sessionRows.title,
  repoOwner: sessionRows.repoOwner,
  repoName: sessionRows.repoName,
  model: sessionRows.model,
  reasoningEffort: sessionRows.reasoningEffort,
  status: sessionRows.status,
  createdAt: sessionRows.createdAt,
  updatedAt: sessionRows.updatedAt,
}

const workflowSelect = {
  id: workflowRows.id,
  userId: workflowRows.userId,
  userName: userRows.name,
  userEmail: userRows.email,
  name: workflowRows.name,
  status: workflowRows.status,
  manifestVersion: workflowRows.manifestVersion,
  manifestKey: workflowRows.manifestKey,
  codeKey: workflowRows.codeKey,
  webhookId: workflowRows.webhookId,
  createdAt: workflowRows.createdAt,
  updatedAt: workflowRows.updatedAt,
}

const sessionSortColumns = {
  id: sessionRows.id,
  title: sessionRows.title,
  userId: sessionRows.userId,
  userEmail: userRows.email,
  sessionKind: sessionRows.sessionKind,
  agentRuntime: sessionRows.agentRuntime,
  source: sessionRows.source,
  repoOwner: sessionRows.repoOwner,
  repoName: sessionRows.repoName,
  model: sessionRows.model,
  status: sessionRows.status,
  createdAt: sessionRows.createdAt,
  updatedAt: sessionRows.updatedAt,
} satisfies Record<string, AnyColumn>

const workflowSortColumns = {
  id: workflowRows.id,
  name: workflowRows.name,
  userId: workflowRows.userId,
  userEmail: userRows.email,
  status: workflowRows.status,
  manifestVersion: workflowRows.manifestVersion,
  webhookId: workflowRows.webhookId,
  createdAt: workflowRows.createdAt,
  updatedAt: workflowRows.updatedAt,
} satisfies Record<string, AnyColumn>

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

function toStatusCount(row: { status: string; count: number }): AdminStatusCount {
  return {
    status: row.status,
    count: Number(row.count),
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

function toWorkflowRun(row: typeof workflowRuns.$inferSelect): AdminWorkflowRunRecord {
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

function toWorkflowRunEvent(row: typeof workflowRunEvents.$inferSelect): AdminWorkflowRunEvent {
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

  constructor(db: D1Database) {
    this.drizzle = makeD1Drizzle(db)
  }

  getSummary = Effect.fn("db.admin.getSummary")(function* (this: AdminStore, now = Date.now()) {
    const [sessions, workflows, runs, attention] = yield* Effect.all(
      [
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .select({ status: sessionRows.status, count: sql<number>`count(*)` })
              .from(sessionRows)
              .groupBy(sessionRows.status)
              .orderBy(asc(sessionRows.status)),
          catch: d1Error("db.admin.getSummary"),
        }),
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .select({ status: workflowRows.status, count: sql<number>`count(*)` })
              .from(workflowRows)
              .groupBy(workflowRows.status)
              .orderBy(asc(workflowRows.status)),
          catch: d1Error("db.admin.getSummary"),
        }),
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .select({ status: workflowRuns.status, count: sql<number>`count(*)` })
              .from(workflowRuns)
              .groupBy(workflowRuns.status)
              .orderBy(asc(workflowRuns.status)),
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
      sessionRows.id,
      sessionRows.title,
      sessionRows.repoOwner,
      sessionRows.repoName,
      userRows.name,
      userRows.email,
    ])
    addExactFilter(conditions, sessionRows.status, query.status)
    addExactFilter(conditions, sessionRows.agentRuntime, query.agentRuntime)
    addExactFilter(conditions, sessionRows.sessionKind, query.kind)
    addExactFilter(conditions, sessionRows.source, query.source)
    addExactFilter(conditions, sessionRows.userId, query.userId)
    addExactFilter(conditions, sessionRows.repoOwner, query.repoOwner)
    addExactFilter(conditions, sessionRows.repoName, query.repoName)

    const where = combineConditions(conditions)
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select(sessionSelect)
          .from(sessionRows)
          .leftJoin(userRows, eq(userRows.id, sessionRows.userId))
          .where(where)
          .orderBy(orderBy(sessionSortColumns, query, "updatedAt"))
          .limit(limit + 1)
          .offset(offset),
      catch: d1Error("db.admin.listSessions"),
    })

    const countRows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({ total: sql<number>`count(*)` })
          .from(sessionRows)
          .leftJoin(userRows, eq(userRows.id, sessionRows.userId))
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
      total: Number(countRows[0]?.total ?? 0),
      limit,
      offset,
      hasMore,
    }
  })

  getSession = Effect.fn("db.admin.getSession")(function* (this: AdminStore, id: string) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select(sessionSelect)
          .from(sessionRows)
          .leftJoin(userRows, eq(userRows.id, sessionRows.userId))
          .where(eq(sessionRows.id, id))
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
      workflowRows.id,
      workflowRows.name,
      workflowRows.webhookId,
      userRows.name,
      userRows.email,
    ])
    addExactFilter(conditions, workflowRows.status, query.status)
    addExactFilter(conditions, workflowRows.userId, query.userId)

    const where = combineConditions(conditions)
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select(workflowSelect)
          .from(workflowRows)
          .leftJoin(userRows, eq(userRows.id, workflowRows.userId))
          .where(where)
          .orderBy(orderBy(workflowSortColumns, query, "updatedAt"))
          .limit(limit + 1)
          .offset(offset),
      catch: d1Error("db.admin.listWorkflows"),
    })

    const countRows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({ total: sql<number>`count(*)` })
          .from(workflowRows)
          .leftJoin(userRows, eq(userRows.id, workflowRows.userId))
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
      total: Number(countRows[0]?.total ?? 0),
      limit,
      offset,
      hasMore,
    }
  })

  getWorkflow = Effect.fn("db.admin.getWorkflow")(function* (this: AdminStore, id: string) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select(workflowSelect)
          .from(workflowRows)
          .leftJoin(userRows, eq(userRows.id, workflowRows.userId))
          .where(eq(workflowRows.id, id))
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
          .from(workflowRuns)
          .where(eq(workflowRuns.workflowId, workflowId))
          .orderBy(desc(workflowRuns.updatedAt))
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
          .from(workflowRuns)
          .where(and(eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.id, runId)))
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
          .from(workflowRunEvents)
          .where(
            and(eq(workflowRunEvents.workflowId, workflowId), eq(workflowRunEvents.runId, runId)),
          )
          .orderBy(asc(workflowRunEvents.sequence)),
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
          .update(workflowRows)
          .set({ status: "archived", updatedAt })
          .where(eq(workflowRows.id, id))
          .returning({ id: workflowRows.id }),
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
          .update(workflowRows)
          .set({ status: "active", updatedAt })
          .where(eq(workflowRows.id, id))
          .returning({ id: workflowRows.id }),
      catch: d1Error("db.admin.unarchiveWorkflow"),
    })
    return updated.length > 0
  })

  deleteSession = Effect.fn("db.admin.deleteSession")(function* (this: AdminStore, id: string) {
    const deleted = yield* Effect.tryPromise({
      try: () =>
        this.drizzle.delete(sessionRows).where(eq(sessionRows.id, id)).returning({
          id: sessionRows.id,
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
          .update(sessionRows)
          .set({ status, updatedAt })
          .where(eq(sessionRows.id, id))
          .returning({ id: sessionRows.id }),
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
              affectedUsers: sql<number>`count(distinct ${accountRows.userId})`,
            })
            .from(accountRows)
            .where(eq(accountRows.providerId, "github")),
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
          .delete(accountRows)
          .where(eq(accountRows.providerId, "github"))
          .returning({ userId: accountRows.userId }),
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
        this.drizzle.insert(adminAuditEvents).values({
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
          .from(workflowRuns)
          .where(eq(workflowRuns.workflowId, workflowId))
          .orderBy(desc(workflowRuns.updatedAt))
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
          .select({ status: workflowRuns.status, count: sql<number>`count(*)` })
          .from(workflowRuns)
          .where(eq(workflowRuns.workflowId, workflowId))
          .groupBy(workflowRuns.status)
          .orderBy(asc(workflowRuns.status)),
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
              .from(workflowRuns)
              .where(eq(workflowRuns.status, "failed"))
              .orderBy(desc(workflowRuns.updatedAt))
              .limit(10),
          catch: d1Error("db.admin.listAttentionItems"),
        }),
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .select()
              .from(workflowRuns)
              .where(
                and(eq(workflowRuns.status, "queued"), lt(workflowRuns.updatedAt, queuedThreshold)),
              )
              .orderBy(asc(workflowRuns.updatedAt))
              .limit(10),
          catch: d1Error("db.admin.listAttentionItems"),
        }),
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .select()
              .from(workflowRuns)
              .where(
                and(
                  eq(workflowRuns.status, "running"),
                  lt(workflowRuns.updatedAt, runningThreshold),
                ),
              )
              .orderBy(asc(workflowRuns.updatedAt))
              .limit(10),
          catch: d1Error("db.admin.listAttentionItems"),
        }),
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .select(sessionSelect)
              .from(sessionRows)
              .leftJoin(userRows, eq(userRows.id, sessionRows.userId))
              .where(
                and(
                  eq(sessionRows.status, "active"),
                  lt(sessionRows.updatedAt, activeSessionThreshold),
                ),
              )
              .orderBy(asc(sessionRows.updatedAt))
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
