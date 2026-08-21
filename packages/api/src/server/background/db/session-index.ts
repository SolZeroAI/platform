import {
  DEFAULT_ISOLATE_STEP_LIMIT,
  normalizeIsolateStepLimit,
  resolveAgentRuntime,
  resolveSessionSubagentMode,
  stringifyOpenCodeMcpServers,
  stringifySessionTools,
  type AgentRuntime,
  type SessionInitiationSource,
  type SessionKind,
  type OpenCodeMcpServers,
  type SessionToolSpec,
  type SubagentMode,
} from "@solzero/shared"
import { and, asc, desc, eq, ne, or, sql, type AnyColumn, type SQL } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { stringifyJson } from "../../lib/json"
import { makeD1Drizzle, type D1DrizzleDatabase } from "../../effect/db/d1-drizzle"
import { sessions, workflowSessionReuseKeys } from "../../effect/db/schema"
import type { SessionStatus } from "../types"
import { d1Error, type D1Error } from "./errors"

export interface SessionIndexRecord {
  id: string
  user_id: string
  title: string | null
  repo_owner: string
  repo_name: string
  github_installation_id: number | null
  github_repo_id: number | null
  repo_default_branch: string | null
  branch_name: string | null
  tools_json: string
  custom_mcp_json: string
  secret_keys_json: string
  isolate_step_limit: number
  subagents: SubagentMode
  model: string
  reasoning_effort: string | null
  session_kind: SessionKind
  agent_runtime: AgentRuntime
  source: SessionInitiationSource
  incognito: boolean
  status: SessionStatus
  created_at: number
  updated_at: number
}

export interface CreateSessionIndexInput {
  id: string
  userId: string
  title: string | null
  repoOwner: string
  repoName: string
  githubInstallationId?: number | null
  githubRepoId?: number | null
  repoDefaultBranch?: string | null
  branchName?: string | null
  tools?: SessionToolSpec[] | null
  customMcpServers?: OpenCodeMcpServers | null
  secretKeys?: string[] | null
  isolateStepLimit?: number | null
  subagents?: SubagentMode | null
  model: string
  reasoningEffort?: string | null
  sessionKind: SessionKind
  agentRuntime: AgentRuntime
  source?: SessionInitiationSource
  incognito?: boolean
  status: SessionStatus
  createdAt: number
  updatedAt: number
}

export interface ListSessionIndexOptions {
  userId: string
  status?: string
  excludeStatus?: string
  includeIncognito?: boolean
  q?: string
  sortBy?: string
  sortDir?: string
  sessionKind?: string
  agentRuntime?: string
  source?: string
  repoOwner?: string
  repoName?: string
  limit: number
  offset: number
}

const SESSION_SORT_COLUMNS = {
  updatedAt: sessions.updatedAt,
  createdAt: sessions.createdAt,
  title: sessions.title,
  repoOwner: sessions.repoOwner,
  repoName: sessions.repoName,
  status: sessions.status,
  sessionKind: sessions.sessionKind,
  agentRuntime: sessions.agentRuntime,
  source: sessions.source,
  model: sessions.model,
} satisfies Record<string, AnyColumn>

function stringifySecretKeys(keys: readonly string[] | null | undefined): string {
  return stringifyJson(Array.from(new Set((keys ?? []).filter((key) => key.length > 0))))
}

export interface WorkflowSessionReuseKeyInput {
  userId: string
  workflowId: string
  nodeId: string
  sessionKind: SessionKind
  keyHash: string
}

export interface UpsertWorkflowSessionReuseKeyInput extends WorkflowSessionReuseKeyInput {
  sessionId: string
  now: number
}

export class SessionIndexStore {
  private readonly drizzle

  constructor(drizzle: D1DrizzleDatabase) {
    this.drizzle = drizzle
  }

  private toRecord(row: typeof sessions.$inferSelect): SessionIndexRecord {
    return {
      id: row.id,
      user_id: row.userId,
      title: row.title,
      repo_owner: row.repoOwner,
      repo_name: row.repoName,
      github_installation_id: row.githubInstallationId,
      github_repo_id: row.githubRepoId,
      repo_default_branch: row.repoDefaultBranch,
      branch_name: row.branchName,
      tools_json: row.toolsJson,
      custom_mcp_json: row.customMcpJson,
      secret_keys_json: row.secretKeysJson,
      isolate_step_limit: normalizeIsolateStepLimit(
        row.isolateStepLimit,
        DEFAULT_ISOLATE_STEP_LIMIT,
      ),
      subagents: resolveSessionSubagentMode(row.sessionKind, row.subagents),
      model: row.model,
      reasoning_effort: row.reasoningEffort,
      session_kind: row.sessionKind as SessionKind,
      agent_runtime: resolveAgentRuntime({
        agentRuntime: row.agentRuntime,
        sessionKind: row.sessionKind,
      }),
      source: normalizeSessionSource(row.source),
      incognito: row.incognito === 1,
      status: row.status as SessionStatus,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }
  }

  getById = Effect.fn("db.sessionIndex.getById")(function* (this: SessionIndexStore, id: string) {
    const rows = yield* Effect.tryPromise({
      try: () => this.drizzle.select().from(sessions).where(eq(sessions.id, id)).limit(1),
      catch: d1Error("db.sessionIndex.getById"),
    })
    return Option.map(Option.fromNullishOr(rows[0]), (row) => this.toRecord(row))
  })

  create = Effect.fn("db.sessionIndex.create")(function* (
    this: SessionIndexStore,
    input: CreateSessionIndexInput,
  ) {
    yield* Effect.tryPromise({
      try: () =>
        this.drizzle.insert(sessions).values({
          id: input.id,
          userId: input.userId,
          title: input.title,
          repoOwner: input.repoOwner,
          repoName: input.repoName,
          githubInstallationId: input.githubInstallationId ?? null,
          githubRepoId: input.githubRepoId ?? null,
          repoDefaultBranch: input.repoDefaultBranch ?? null,
          branchName: input.branchName ?? null,
          toolsJson: stringifySessionTools(input.tools),
          customMcpJson: stringifyOpenCodeMcpServers(input.customMcpServers),
          secretKeysJson: stringifySecretKeys(input.secretKeys),
          isolateStepLimit: normalizeIsolateStepLimit(
            input.isolateStepLimit,
            DEFAULT_ISOLATE_STEP_LIMIT,
          ),
          subagents: resolveSessionSubagentMode(input.sessionKind, input.subagents),
          model: input.model,
          reasoningEffort: input.reasoningEffort ?? null,
          sessionKind: input.sessionKind,
          agentRuntime: input.agentRuntime,
          source: input.source ?? "web",
          incognito: Number(Boolean(input.incognito)),
          status: input.status,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        }),
      catch: d1Error("db.sessionIndex.create"),
    })
  })

  updateTooling = Effect.fn("db.sessionIndex.updateTooling")(function* (
    this: SessionIndexStore,
    input: {
      id: string
      repoOwner: string
      repoName: string
      tools?: SessionToolSpec[] | null
      customMcpServers?: OpenCodeMcpServers | null
      isolateStepLimit?: number | null
      subagents?: SubagentMode | null
      updatedAt: number
    },
  ) {
    const existing = yield* this.getById(input.id)
    const fallbackLimit = Option.getOrElse(
      Option.map(existing, (record) => record.isolate_step_limit),
      () => DEFAULT_ISOLATE_STEP_LIMIT,
    )
    const existingRecord = Option.getOrNull(existing)
    const subagents = resolveSessionSubagentMode(
      existingRecord?.session_kind,
      input.subagents,
      existingRecord?.subagents,
    )
    const updated = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(sessions)
          .set({
            repoOwner: input.repoOwner,
            repoName: input.repoName,
            toolsJson: stringifySessionTools(input.tools),
            customMcpJson: stringifyOpenCodeMcpServers(input.customMcpServers),
            isolateStepLimit: normalizeIsolateStepLimit(input.isolateStepLimit, fallbackLimit),
            subagents,
            updatedAt: input.updatedAt,
          })
          .where(eq(sessions.id, input.id))
          .returning({ id: sessions.id }),
      catch: d1Error("db.sessionIndex.updateTooling"),
    })
    return updated.length > 0
  })

  updateStatus = Effect.fn("db.sessionIndex.updateStatus")(function* (
    this: SessionIndexStore,
    id: string,
    status: SessionStatus,
    updatedAt = Date.now(),
  ) {
    const updated = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(sessions)
          .set({ status, updatedAt })
          .where(eq(sessions.id, id))
          .returning({ id: sessions.id }),
      catch: d1Error("db.sessionIndex.updateStatus"),
    })
    return updated.length > 0
  })

  delete = Effect.fn("db.sessionIndex.delete")(function* (this: SessionIndexStore, id: string) {
    const deleted = yield* Effect.tryPromise({
      try: () =>
        this.drizzle.delete(sessions).where(eq(sessions.id, id)).returning({ id: sessions.id }),
      catch: d1Error("db.sessionIndex.delete"),
    })
    return deleted.length > 0
  })

  list = Effect.fn("db.sessionIndex.list")(function* (
    this: SessionIndexStore,
    options: ListSessionIndexOptions,
  ) {
    const conditions: SQL[] = [eq(sessions.userId, options.userId)]
    addExactFilter(conditions, sessions.status, options.status)
    addNotEqualFilter(conditions, sessions.status, options.excludeStatus)
    addExactFilter(conditions, sessions.sessionKind, options.sessionKind)
    addExactFilter(conditions, sessions.agentRuntime, options.agentRuntime)
    addExactFilter(conditions, sessions.source, options.source)
    addLikeFilter(conditions, options.repoOwner, [sessions.repoOwner])
    addLikeFilter(conditions, options.repoName, [sessions.repoName])
    addLikeFilter(conditions, options.q, [
      sessions.title,
      sessions.repoOwner,
      sessions.repoName,
      sessions.branchName,
      sessions.model,
      sessions.reasoningEffort,
      sessions.sessionKind,
      sessions.agentRuntime,
      sessions.source,
      sessions.toolsJson,
      sessions.customMcpJson,
    ])
    Match.value(Boolean(options.includeIncognito)).pipe(
      Match.when(false, () => {
        conditions.push(eq(sessions.incognito, 0))
      }),
      Match.orElse(() => undefined),
    )
    const where = combineConditions(conditions)
    const limit = clampLimit(options.limit)
    const offset = Math.max(0, options.offset)

    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(sessions)
          .where(where)
          .orderBy(resolveSessionOrder(options))
          .limit(limit + 1)
          .offset(offset),
      catch: d1Error("db.sessionIndex.list"),
    })

    const records = rows.map((row) => this.toRecord(row))
    const hasMore = records.length > limit
    Match.value(hasMore).pipe(
      Match.when(true, () => {
        records.pop()
      }),
      Match.orElse(() => undefined),
    )

    const countRows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({ total: sql<number>`count(*)` })
          .from(sessions)
          .where(where),
      catch: d1Error("db.sessionIndex.list"),
    })
    const total = Option.getOrElse(
      Option.map(Option.fromNullishOr(countRows[0]), (row) => row.total),
      () => 0,
    )

    return {
      sessions: records,
      total,
      hasMore,
    }
  })

  getWorkflowSessionReuseSessionId = Effect.fn("db.sessionIndex.getWorkflowSessionReuseSessionId")(
    function* (this: SessionIndexStore, input: WorkflowSessionReuseKeyInput) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          this.drizzle
            .select({ sessionId: workflowSessionReuseKeys.sessionId })
            .from(workflowSessionReuseKeys)
            .where(workflowSessionReuseKeyWhere(input))
            .limit(1),
        catch: d1Error("db.sessionIndex.getWorkflowSessionReuseSessionId"),
      })
      return Option.map(Option.fromNullishOr(rows[0]), (row) => row.sessionId)
    },
  )

  upsertWorkflowSessionReuseKey = Effect.fn("db.sessionIndex.upsertWorkflowSessionReuseKey")(
    function* (this: SessionIndexStore, input: UpsertWorkflowSessionReuseKeyInput) {
      yield* Effect.tryPromise({
        try: () =>
          this.drizzle
            .insert(workflowSessionReuseKeys)
            .values({
              userId: input.userId,
              workflowId: input.workflowId,
              nodeId: input.nodeId,
              sessionKind: input.sessionKind,
              keyHash: input.keyHash,
              sessionId: input.sessionId,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoUpdate({
              target: [
                workflowSessionReuseKeys.userId,
                workflowSessionReuseKeys.workflowId,
                workflowSessionReuseKeys.nodeId,
                workflowSessionReuseKeys.sessionKind,
                workflowSessionReuseKeys.keyHash,
              ],
              set: {
                sessionId: input.sessionId,
                updatedAt: input.now,
              },
            }),
        catch: d1Error("db.sessionIndex.upsertWorkflowSessionReuseKey"),
      })
    },
  )
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

function addNotEqualFilter(conditions: SQL[], column: AnyColumn, value: string | undefined) {
  Option.match(Option.fromNullishOr(value?.trim()).pipe(Option.filter(Boolean)), {
    onNone: () => undefined,
    onSome: (trimmed) => {
      conditions.push(ne(column, trimmed))
    },
  })
}

function combineConditions(conditions: SQL[]) {
  return Match.value(conditions.length > 0).pipe(
    Match.when(true, () => and(...conditions)),
    Match.orElse(() => undefined),
  )
}

function resolveSessionOrder(options: Pick<ListSessionIndexOptions, "sortBy" | "sortDir">): SQL {
  const column = Option.match(
    Option.fromNullishOr(options.sortBy).pipe(
      Option.filter((key): key is keyof typeof SESSION_SORT_COLUMNS =>
        Object.prototype.hasOwnProperty.call(SESSION_SORT_COLUMNS, key),
      ),
    ),
    {
      onNone: () => SESSION_SORT_COLUMNS.updatedAt,
      onSome: (key) => SESSION_SORT_COLUMNS[key],
    },
  )
  return Match.value(options.sortDir === "asc").pipe(
    Match.when(true, () => asc(column)),
    Match.orElse(() => desc(column)),
  )
}

function clampLimit(limit: number): number {
  return Match.value(!Number.isFinite(limit) || limit <= 0).pipe(
    Match.when(true, () => 50),
    Match.orElse(() => Math.min(Math.trunc(limit), 100)),
  )
}

function workflowSessionReuseKeyWhere(input: WorkflowSessionReuseKeyInput) {
  return and(
    eq(workflowSessionReuseKeys.userId, input.userId),
    eq(workflowSessionReuseKeys.workflowId, input.workflowId),
    eq(workflowSessionReuseKeys.nodeId, input.nodeId),
    eq(workflowSessionReuseKeys.sessionKind, input.sessionKind),
    eq(workflowSessionReuseKeys.keyHash, input.keyHash),
  )
}

function normalizeSessionSource(value: string | null | undefined): SessionInitiationSource {
  return Match.value(value).pipe(
    Match.whenOr("slack", "api", (resolved) => resolved),
    Match.orElse(() => "web" as const),
  )
}

// oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Promise-boundary bridge: A is the type parameter, so the D1Error channel must be named explicitly here.
function runSessionIndexEffect<A>(effect: Effect.Effect<A, D1Error>): Promise<A> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary bridging the Effect SessionIndexStore to the non-Effect workflow session node and workflow-builder MCP server.
  return Effect.runPromise(effect)
}

function runSessionIndexOption<A>(
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Promise-boundary bridge: A is the type parameter, so the D1Error channel must be named explicitly here.
  effect: Effect.Effect<Option.Option<A>, D1Error>,
): Promise<A | null> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary bridging the Effect SessionIndexStore to the non-Effect workflow session node and workflow-builder MCP server.
  return Effect.runPromise(effect.pipe(Effect.map(Option.getOrNull)))
}

/**
 * Promise-facing view of {@link SessionIndexStore} for the non-Effect workflow session node and
 * workflow-builder MCP server. Runs the underlying Effect at this boundary and re-surfaces nullable
 * reads as `T | null`.
 */
export interface SessionIndexStorePromise {
  getById(id: string): Promise<SessionIndexRecord | null>
  getWorkflowSessionReuseSessionId(input: WorkflowSessionReuseKeyInput): Promise<string | null>
  upsertWorkflowSessionReuseKey(input: UpsertWorkflowSessionReuseKeyInput): Promise<void>
}

export function createSessionIndexStoreFromD1(db: D1Database): SessionIndexStorePromise {
  const store = new SessionIndexStore(makeD1Drizzle(db))
  return {
    getById: (id) => runSessionIndexOption(store.getById(id)),
    getWorkflowSessionReuseSessionId: (input) =>
      runSessionIndexOption(store.getWorkflowSessionReuseSessionId(input)),
    upsertWorkflowSessionReuseKey: (input) =>
      runSessionIndexEffect(store.upsertWorkflowSessionReuseKey(input)),
  }
}
