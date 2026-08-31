import type { WorkflowApprovalPayload, WorkflowRunListQuery } from "@solzero/api"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { generateId } from "../../../background/auth/crypto"
import {
  WorkflowStore,
  type WorkflowRecord,
  type WorkflowRunEventRecord,
  type WorkflowRunRecord,
} from "../../../background/db/workflows"
import type { Env } from "../../../background/types"
import {
  getWrappedWorkflowBinding,
  reconcileWorkflowRun,
} from "../../../background/workflows/runner"
import { prefixStorageKeyWithUserId } from "../../../lib/better-auth"
import { parseJson, parseJsonOrText, stringifyJson } from "../../../lib/json"
import type { ControlPlaneDb } from "../../db/control-plane-db"
import type { D1DrizzleDatabase } from "../../db/d1-drizzle"
import { EffectRequestLogger, type RequestLogger } from "../../services/observability"
import {
  type ControlPlaneContext,
  describeError,
  failUnless,
  json,
  requireOption,
  runControlPlane,
} from "../shared/control-plane"
import { formatWorkflowRun, parseListNumber, requireWorkflowForUser } from "./shared"

type SavedWorkflowArtifactNodeType = "r2-put-object" | "kv-put"

interface WorkflowRunArtifactReference {
  nodeId: string
  nodeType: SavedWorkflowArtifactNodeType
  output: Record<string, unknown>
}

interface WorkflowRunEventsSnapshot {
  runs: ReturnType<typeof formatWorkflowRun>[]
  runId: string | null
  events: ReturnType<typeof formatRunEvent>[]
  serverTime: number
}

function asJsonRecord(value: unknown): Option.Option<Record<string, unknown>> {
  return Option.fromNullishOr(value).pipe(
    Option.filter(
      (candidate): candidate is Record<string, unknown> =>
        typeof candidate === "object" && !Array.isArray(candidate),
    ),
  )
}

function parseJsonRecordOption(value: string | null): Option.Option<Record<string, unknown>> {
  return Option.fromNullishOr(value).pipe(
    Option.filter((raw) => raw.length > 0),
    Option.flatMap((raw) => asJsonRecord(parseJson(raw))),
  )
}

function readNonEmptyString(value: unknown): Option.Option<string> {
  return Option.fromNullishOr(value).pipe(
    Option.filter(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.trim().length > 0,
    ),
    Option.map((candidate) => candidate.trim()),
  )
}

function isSavedWorkflowArtifactNodeType(
  nodeType: string | null | undefined,
): nodeType is SavedWorkflowArtifactNodeType {
  return nodeType === "r2-put-object" || nodeType === "kv-put"
}

function looksLikeJsonDocument(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.startsWith("{") || trimmed.startsWith("[")
}

function parseStoredArtifactContent(text: string, contentType: string | null): unknown {
  const shouldParseJson =
    (contentType ?? "").toLowerCase().includes("json") || looksLikeJsonDocument(text)
  return Match.value(shouldParseJson).pipe(
    Match.when(true, () => parseJsonOrText(text)),
    Match.orElse(() => text),
  )
}

function getWorkflowR2BucketBinding(env: Env, binding: string): Option.Option<R2Bucket> {
  return Match.value(binding).pipe(
    Match.when("WORKFLOW_BUCKET", () => Option.some(env.WORKFLOW_BUCKET)),
    Match.when("AI_SEARCH_CONTENT_BUCKET", () => Option.some(env.AI_SEARCH_CONTENT_BUCKET)),
    Match.orElse(() => Option.none<R2Bucket>()),
  )
}

function getWorkflowKvNamespaceBinding(env: Env, binding: string): Option.Option<KVNamespace> {
  return Match.value(binding).pipe(
    Match.when("REPOS_CACHE", () => Option.some(env.REPOS_CACHE)),
    Match.when("USER_WORKFLOW_KV", () => Option.some(env.USER_WORKFLOW_KV)),
    Match.orElse(() => Option.none<KVNamespace>()),
  )
}

function readSavedNodeType(
  eventData: Option.Option<Record<string, unknown>>,
): Option.Option<SavedWorkflowArtifactNodeType> {
  return eventData.pipe(
    Option.flatMap((data) => readNonEmptyString(data.nodeType)),
    Option.filter(isSavedWorkflowArtifactNodeType),
  )
}

function resolveEventOutput(
  eventData: Option.Option<Record<string, unknown>>,
): Option.Option<Record<string, unknown>> {
  return eventData.pipe(
    Option.flatMap((data) => asJsonRecord(data.result)),
    Option.flatMap((result) => asJsonRecord(result.outputs)),
  )
}

function resolveRunOutput(
  runOutputs: Option.Option<Record<string, unknown>>,
  nodeId: string | null,
): Option.Option<Record<string, unknown>> {
  return runOutputs.pipe(Option.flatMap((outputs) => asJsonRecord(outputs[nodeId ?? ""])))
}

function readNonEmptyNodeId(nodeId: string | null): Option.Option<string> {
  return Option.fromNullishOr(nodeId).pipe(Option.filter((id) => id.length > 0))
}

function matchesArtifactEvent(event: WorkflowRunEventRecord, nodeId: string): boolean {
  return (
    event.event_type === "node_completed" &&
    event.node_id === nodeId &&
    Boolean(event.node_id) &&
    Option.isSome(readSavedNodeType(parseJsonRecordOption(event.data_json)))
  )
}

function buildArtifactReference(
  match: WorkflowRunEventRecord,
  runOutputs: Option.Option<Record<string, unknown>>,
): Option.Option<WorkflowRunArtifactReference> {
  const eventData = parseJsonRecordOption(match.data_json)
  const nodeType = readSavedNodeType(eventData)
  const eventOutput = resolveEventOutput(eventData)
  const output = Option.orElse(resolveRunOutput(runOutputs, match.node_id), () => eventOutput)
  const nodeId = readNonEmptyNodeId(match.node_id)
  return Option.all({ output, nodeType, nodeId }).pipe(
    Option.map((resolved) => ({
      nodeId: resolved.nodeId,
      nodeType: resolved.nodeType,
      output: resolved.output,
    })),
  )
}

function getWorkflowRunArtifactReference(input: {
  run: WorkflowRunRecord
  events: WorkflowRunEventRecord[]
  nodeId: string
}): Option.Option<WorkflowRunArtifactReference> {
  const runOutputs = parseJsonRecordOption(input.run.output_json).pipe(
    Option.flatMap((runOutput) => asJsonRecord(runOutput.outputs)),
  )
  const sortedEvents = [...input.events].sort((left, right) => left.sequence - right.sequence)
  return Arr.findFirst(sortedEvents, (event) => matchesArtifactEvent(event, input.nodeId)).pipe(
    Option.flatMap((match) => buildArtifactReference(match, runOutputs)),
  )
}

export function formatRunEvent(
  event: Effect.Success<ReturnType<WorkflowStore["listRunEvents"]>>[number],
) {
  return {
    id: event.id,
    workflowId: event.workflow_id,
    runId: event.run_id,
    sequence: event.sequence,
    nodeId: event.node_id,
    eventType: event.event_type,
    level: event.level,
    message: event.message,
    data: parseJson(event.data_json) as Record<string, unknown>,
    createdAt: event.created_at,
  }
}

function encodeSse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${stringifyJson(data)}\n\n`)
}

function isLiveRunStatus(status: string): boolean {
  return status === "queued" || status === "running"
}

const fetchRunEvents = Effect.fn("workflows.fetchRunEvents")(function* (
  store: WorkflowStore,
  workflowId: string,
  runId: string,
) {
  const rows = yield* store.listRunEvents(workflowId, runId)
  return rows.map(formatRunEvent)
})

const getRunsSnapshot = Effect.fn("workflows.getRunsSnapshot")(function* (input: {
  env: Env
  store: WorkflowStore
  workflow: WorkflowRecord
  workflowId: string
  requestedRunId?: string
}) {
  const rows = yield* input.store.listRuns(input.workflowId)
  const reconciledRows = yield* Effect.tryPromise(() =>
    Promise.all(
      rows.map((run) => reconcileWorkflowRun({ env: input.env, workflow: input.workflow, run })),
    ),
  )
  const runs = reconciledRows.map(formatWorkflowRun)
  const selectedRunId = Option.fromNullishOr(input.requestedRunId).pipe(
    Option.filter((candidate) => runs.some((run) => run.id === candidate)),
    Option.orElse(() => Option.fromNullishOr(runs[0]?.id)),
  )
  const events = yield* Option.match(selectedRunId, {
    onNone: () => Effect.succeed<ReturnType<typeof formatRunEvent>[]>([]),
    onSome: (runId) => fetchRunEvents(input.store, input.workflowId, runId),
  })
  return {
    runs,
    runId: Option.getOrNull(selectedRunId),
    events,
    serverTime: Date.now(),
  } satisfies WorkflowRunEventsSnapshot
})

const terminateLiveInstance = Effect.fn("workflows.terminateLiveInstance")(function* (input: {
  workflow: WorkflowRecord
  run: WorkflowRunRecord
}) {
  const workflowBinding = yield* Effect.tryPromise(() =>
    getWrappedWorkflowBinding(input.workflow, input.run.workflow_version),
  )
  const instance = yield* Effect.tryPromise(() =>
    workflowBinding.get(input.run.workflow_instance_id ?? ""),
  )
  yield* Effect.tryPromise(() => instance.terminate())
  return true
})

/**
 * Terminates a live workflow run instance before deletion. Succeeds with `false` (no-op) when the
 * run is not live; fails when termination fails so the caller can log best-effort.
 */
const terminateRunInstanceIfLive = Effect.fn("workflows.terminateRunInstanceIfLive")(
  function* (input: { workflow: WorkflowRecord; run: WorkflowRunRecord }) {
    const isLive = Boolean(input.run.workflow_instance_id) && isLiveRunStatus(input.run.status)
    return yield* Match.value(isLive).pipe(
      Match.when(false, () => Effect.succeed(false)),
      Match.orElse(() => terminateLiveInstance(input)),
    )
  },
)

/** Resolves the durable workflow instance backing a run for approval delivery. */
const getWorkflowRunInstance = Effect.fn("workflows.getWorkflowRunInstance")(function* (
  workflow: WorkflowRecord,
  run: WorkflowRunRecord,
) {
  const workflowBinding = yield* Effect.tryPromise(() =>
    getWrappedWorkflowBinding(workflow, run.workflow_version),
  )
  return yield* Effect.tryPromise(() => workflowBinding.get(run.workflow_instance_id ?? ""))
})

const loadR2ArtifactResponse = Effect.fn("workflows.loadR2ArtifactResponse")(function* (input: {
  env: Env
  log: RequestLogger
  params: { id: string; runId: string; nodeId: string }
  artifact: WorkflowRunArtifactReference
  key: string
  storageKey: string
}) {
  const { env, log, params, artifact, key, storageKey } = input
  const binding = Option.getOrElse(
    readNonEmptyString(artifact.output.bucket),
    () => "WORKFLOW_BUCKET",
  )
  const bucket = yield* requireOption(
    getWorkflowR2BucketBinding(env, binding),
    `Unsupported workflow R2 bucket '${binding}'`,
    400,
  )
  const object = yield* requireOption(
    Option.fromNullishOr(yield* Effect.tryPromise(() => bucket.get(storageKey))),
    "Workflow artifact object not found",
    404,
  )
  const text = yield* Effect.tryPromise(() => object.text())
  const contentType = object.httpMetadata?.contentType ?? null
  log.set({
    workflowId: params.id,
    runId: params.runId,
    nodeId: artifact.nodeId,
    nodeType: artifact.nodeType,
    storageType: "r2",
    binding,
    key,
  })
  return json({
    artifact: {
      nodeId: artifact.nodeId,
      nodeType: artifact.nodeType,
      storageType: "r2",
      binding,
      key,
      contentType,
      etag: object.etag ?? null,
      content: parseStoredArtifactContent(text, contentType),
      text,
    },
  })
})

const loadKvArtifactResponse = Effect.fn("workflows.loadKvArtifactResponse")(function* (input: {
  env: Env
  log: RequestLogger
  params: { id: string; runId: string; nodeId: string }
  artifact: WorkflowRunArtifactReference
  key: string
  storageKey: string
}) {
  const { env, log, params, artifact, key, storageKey } = input
  const binding = Option.getOrElse(
    readNonEmptyString(artifact.output.namespace),
    () => "USER_WORKFLOW_KV",
  )
  const namespace = yield* requireOption(
    getWorkflowKvNamespaceBinding(env, binding),
    `Unsupported workflow KV namespace '${binding}'`,
    400,
  )
  const text = yield* requireOption(
    Option.fromNullishOr(yield* Effect.tryPromise(() => namespace.get(storageKey))),
    "Workflow artifact object not found",
    404,
  )
  log.set({
    workflowId: params.id,
    runId: params.runId,
    nodeId: artifact.nodeId,
    nodeType: artifact.nodeType,
    storageType: "kv",
    binding,
    key,
  })
  return json({
    artifact: {
      nodeId: artifact.nodeId,
      nodeType: artifact.nodeType,
      storageType: "kv",
      binding,
      key,
      contentType: null,
      etag: null,
      content: parseStoredArtifactContent(text, null),
      text,
    },
  })
})

/** Loads a saved workflow run artifact (R2 or KV) and renders it as a JSON response. */
const loadRunArtifactResponse = Effect.fn("workflows.loadRunArtifactResponse")(function* (input: {
  env: Env
  db: ControlPlaneDb | D1DrizzleDatabase
  log: RequestLogger
  params: { id: string; runId: string; nodeId: string }
}) {
  const { env, db, log, params } = input
  const store = new WorkflowStore(db)
  const run = yield* requireOption(
    yield* store.getRun(params.id, params.runId),
    "Workflow run not found",
    404,
  )
  const events = yield* store.listRunEvents(params.id, params.runId)
  const artifact = yield* requireOption(
    getWorkflowRunArtifactReference({ run, events, nodeId: params.nodeId }),
    "Workflow artifact not found",
    404,
  )
  const key = yield* requireOption(
    readNonEmptyString(artifact.output.key),
    "Workflow artifact key not found",
    404,
  )
  const storageKey = prefixStorageKeyWithUserId(run.user_id, key)
  return yield* Match.value(artifact.nodeType).pipe(
    Match.when("r2-put-object", () =>
      loadR2ArtifactResponse({ env, log, params, artifact, key, storageKey }),
    ),
    Match.orElse(() => loadKvArtifactResponse({ env, log, params, artifact, key, storageKey })),
  )
})

const logTerminateFailure = Effect.fn("workflows.deleteRun.terminateFailed")(function* (
  context: ControlPlaneContext,
  ids: { id: string; runId: string },
  cause: unknown,
) {
  const log = yield* EffectRequestLogger
  yield* log.warn("workflow.run.terminate_before_delete_failed", {
    workflowId: ids.id,
    runId: ids.runId,
    message: describeError(cause),
  })
})

/** Builds the SSE response that streams reconciled workflow run snapshots. */
function createRunEventsStreamResponse(input: {
  env: Env
  db: ControlPlaneDb | D1DrizzleDatabase
  workflow: WorkflowRecord
  workflowId: string
  requestedRunId?: string
  signal: AbortSignal
}): Response {
  const { env, db, workflow, workflowId, requestedRunId, signal } = input
  const store = new WorkflowStore(db)
  let intervalHandle = Option.none<ReturnType<typeof setInterval>>()
  let closed = false
  let sending = false

  const stopInterval = () => {
    Option.match(intervalHandle, {
      onNone: () => undefined,
      onSome: (handle) => clearInterval(handle),
    })
    intervalHandle = Option.none()
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () =>
        Match.value(closed).pipe(
          Match.when(false, () => {
            closed = true
            stopInterval()
            controller.close()
          }),
          Match.orElse(() => undefined),
        )

      const runSnapshotTick = async () => {
        sending = true
        // oxlint-disable-next-line effect/effect-run-in-body -- Web Streams boundary: SSE ticks fire from setInterval after the Effect handler has returned, so the snapshot Effect must be run to a Promise here to feed the imperative ReadableStream controller.
        await Effect.runPromise(
          getRunsSnapshot({ env, store, workflow, workflowId, requestedRunId }),
        )
          .then((snapshot) => controller.enqueue(encodeSse("snapshot", snapshot)))
          .catch((cause) =>
            controller.enqueue(encodeSse("error", { message: describeError(cause) })),
          )
        sending = false
      }

      const sendSnapshot = () =>
        Match.value(closed || sending).pipe(
          Match.when(false, () => runSnapshotTick()),
          Match.orElse(() => Promise.resolve()),
        )

      signal.addEventListener("abort", close, { once: true })
      await sendSnapshot()
      intervalHandle = Option.some(
        setInterval(() => {
          void sendSnapshot()
        }, 1_500),
      )
    },
    cancel() {
      closed = true
      stopInterval()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}

export function runs({ params, query }: { params: { id: string }; query: WorkflowRunListQuery }) {
  return runControlPlane(
    Effect.fn("workflows.runs")(function* (context) {
      const { workflow } = yield* requireWorkflowForUser(context, params.id)
      const store = new WorkflowStore(context.db)
      const limit = parseListNumber(query.limit, 20, 100)
      const offset = parseListNumber(query.offset, 0, 10_000)
      const result = yield* store.listRunPage({
        workflowId: params.id,
        limit,
        offset,
        q: query.q,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
        status: query.status,
        triggerKind: query.triggerKind,
      })
      const reconciledRows = yield* Effect.tryPromise(() =>
        Promise.all(
          result.runs.map((run) => reconcileWorkflowRun({ env: context.env, workflow, run })),
        ),
      )
      return json({
        runs: reconciledRows.map(formatWorkflowRun),
        total: result.total,
        totalRuns: result.totalRuns,
        errorsLast24Hours: result.errorsLast24Hours,
        limit,
        offset,
        hasMore: result.hasMore,
      })
    }),
  )
}

export function getRun({ params }: { params: { id: string; runId: string } }) {
  return runControlPlane(
    Effect.fn("workflows.getRun")(function* (context) {
      const { workflow } = yield* requireWorkflowForUser(context, params.id)
      const store = new WorkflowStore(context.db)
      const run = yield* store.getRun(params.id, params.runId)
      const resolvedRun = yield* requireOption(run, "Workflow run not found", 404)
      const reconciledRun = yield* Effect.tryPromise(() =>
        reconcileWorkflowRun({ env: context.env, workflow, run: resolvedRun }),
      )
      return json({ run: formatWorkflowRun(reconciledRun) })
    }),
  )
}

export function deleteRun({ params }: { params: { id: string; runId: string } }) {
  return runControlPlane(
    Effect.fn("workflows.deleteRun")(function* (context) {
      const { workflow } = yield* requireWorkflowForUser(context, params.id)
      const store = new WorkflowStore(context.db)
      const run = yield* store.getRun(params.id, params.runId)
      const resolvedRun = yield* requireOption(run, "Workflow run not found", 404)
      yield* terminateRunInstanceIfLive({ workflow, run: resolvedRun }).pipe(
        Effect.tapError((cause) => logTerminateFailure(context, params, cause)),
        Effect.ignore,
      )
      const deleted = yield* store.deleteRun(params.id, params.runId)
      yield* failUnless(Boolean(deleted), "Workflow run not found", 404)
      return json({ status: "deleted", workflowId: params.id, runId: params.runId })
    }),
  )
}

export function runEvents({ params }: { params: { id: string; runId: string } }) {
  return runControlPlane(
    Effect.fn("workflows.runEvents")(function* (context) {
      yield* requireWorkflowForUser(context, params.id)
      const events = yield* new WorkflowStore(context.db).listRunEvents(params.id, params.runId)
      const log = yield* EffectRequestLogger
      yield* log.set({
        eventsLength: events.length,
      })
      return json({
        events: events.map(formatRunEvent),
      })
    }),
  )
}

export function runArtifactContent({
  params,
}: {
  params: { id: string; runId: string; nodeId: string }
}) {
  return runControlPlane(
    Effect.fn("workflows.runArtifactContent")(function* (context) {
      yield* requireWorkflowForUser(context, params.id)
      return yield* loadRunArtifactResponse({
        env: context.env,
        db: context.db,
        log: context.log,
        params,
      })
    }),
  )
}

export function approveRun({
  params,
  payload,
}: {
  params: { id: string; runId: string }
  payload: WorkflowApprovalPayload
}) {
  return runControlPlane(
    Effect.fn("workflows.approveRun")(function* (context) {
      const { workflow, userId } = yield* requireWorkflowForUser(context, params.id)
      const store = new WorkflowStore(context.db)
      const run = yield* store.getRun(params.id, params.runId)
      const resolvedRun = yield* requireOption(run, "Workflow run not found", 404)
      yield* failUnless(
        Boolean(resolvedRun.workflow_instance_id),
        "Workflow run is not attached to an instance yet",
        409,
      )
      yield* failUnless(
        resolvedRun.status === "queued" || resolvedRun.status === "running",
        "Workflow run is not waiting for approval",
        409,
      )

      const approvedAt = new Date().toISOString()
      const approvalEventType = `workflow-approval:${params.id}:${params.runId}:${payload.nodeId}`
      const decision = Match.value(payload.approved).pipe(
        Match.when(true, () => "approved" as const),
        Match.orElse(() => "rejected" as const),
      )
      const message = Match.value(payload.approved).pipe(
        Match.when(true, () => "Approval submitted"),
        Match.orElse(() => "Rejection submitted"),
      )
      const comment = payload.comment ?? ""

      const instance = yield* getWorkflowRunInstance(workflow, resolvedRun)
      yield* Effect.tryPromise(() =>
        instance.sendEvent({
          type: approvalEventType,
          payload: {
            approved: payload.approved,
            decision,
            comment,
            approvedBy: userId,
            approvedAt,
          },
        }),
      )

      yield* store.addRunEvent({
        id: `wfe_${generateId(12)}`,
        workflowId: params.id,
        runId: params.runId,
        nodeId: payload.nodeId,
        eventType: "approval_submitted",
        message,
        data: {
          approved: payload.approved,
          decision,
          comment,
          approvedBy: userId,
          approvedAt,
          approvalEventType,
        },
        createdAt: Date.now(),
      })

      return json({
        status: "submitted",
        workflowId: params.id,
        runId: params.runId,
        nodeId: payload.nodeId,
        approved: payload.approved,
      })
    }),
  )
}

export function runEventsStream({
  params,
  query,
}: {
  params: { id: string }
  query: { runId?: string }
}) {
  return runControlPlane(
    Effect.fn("workflows.runEventsStream")(function* (context) {
      const { workflow } = yield* requireWorkflowForUser(context, params.id)
      return createRunEventsStreamResponse({
        env: context.env,
        db: context.db,
        workflow,
        workflowId: params.id,
        requestedRunId: query.runId,
        signal: context.request.signal,
      })
    }),
  )
}
