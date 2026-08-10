import { getInfraServerUrl } from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type {
  AdminActionPayload,
  AdminAiSearchSourcePayload,
  AdminCloudflareAiGatewayProviderKeysPayload,
  AdminIdParams,
  AdminLitellmConfigPayload,
  AdminListQuery,
  AdminMcpcfConfigPayload,
  AdminRunWorkflowPayload,
  AdminWorkflowListQuery,
  AdminWorkflowRunParams,
} from "@solzero/api"
import {
  AdminStore,
  type AdminSessionRecord,
  type AdminWorkflowRecord,
} from "../../../background/db/admin"
import { IsolateSessionRuntime } from "../../../background/isolate/runtime"
import { resolveCloudflareTracing } from "../../services/observability"
import {
  createWorkflowTrigger,
  WorkflowLifecycle,
  WorkflowLifecycleInputError,
  WorkflowLifecycleNotFoundError,
  WorkflowRetryTriggerError,
} from "../../../background/workflows/lifecycle"
import { stringifyJson } from "../../../lib/json"
import {
  getAiProvidersAdminResponse,
  performExportLitellmProvider,
  performResetLitellmProvider,
  performSyncLitellmModels,
  performUpdateCloudflareAiGatewayProviderKeys,
  performUpdateLitellmProvider,
} from "./ai-providers"
import {
  getAiSearchAdminResponse,
  performCreateAiSearchSource,
  performDeleteAiSearchSource,
  performExportAiSearchConfig,
  performUpdateAiSearchSource,
} from "./ai-search"
import {
  getMcpcfAdminResponse,
  performExportMcpcfConfig,
  performRefreshMcpcf,
  performResetMcpcfConfig,
  performUpdateMcpcfConfig,
} from "./mcpcf"
import {
  ControlPlaneFailure,
  describeError,
  failUnless,
  getSessionStub,
  InternalRequests,
  json,
  requireOption,
  runControlPlane,
  type ControlPlaneContext,
} from "../shared/control-plane"
import { requireAdmin, resolveAdminAccess, withAudit } from "./route-helpers"
export { agentSkills, createAgentSkill, deleteAgentSkill, updateAgentSkill } from "./skills"

function workflowWebhookPath(webhookId: string): string {
  return `/workflows/webhooks/${webhookId}`
}

function formatWorkflowForAdmin(workflow: AdminWorkflowRecord, serverUrl: string) {
  const webhookPath = workflowWebhookPath(workflow.webhookId)
  return {
    id: workflow.id,
    userId: workflow.userId,
    userName: workflow.userName,
    userEmail: workflow.userEmail,
    name: workflow.name,
    status: workflow.status,
    manifestVersion: workflow.manifestVersion,
    webhookId: workflow.webhookId,
    webhookPath,
    webhookUrl: new URL(webhookPath, serverUrl).toString(),
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    latestRun: workflow.latestRun,
    runCounts: workflow.runCounts,
  }
}

function lifecycleFailureStatus(cause: unknown): number {
  return Match.value(cause).pipe(
    Match.when(Match.instanceOf(WorkflowLifecycleInputError), () => 400),
    Match.when(Match.instanceOf(WorkflowRetryTriggerError), () => 400),
    Match.when(Match.instanceOf(WorkflowLifecycleNotFoundError), () => 404),
    Match.orElse(() => 500),
  )
}

function lifecycleFailure(cause: unknown): ControlPlaneFailure {
  return new ControlPlaneFailure({
    payload: { error: describeError(cause) },
    status: lifecycleFailureStatus(cause),
  })
}

function toUnknownArray(value: unknown): unknown[] {
  return Match.value(Array.isArray(value)).pipe(
    Match.when(true, () => value as unknown[]),
    Match.orElse(() => [] as unknown[]),
  )
}

function extractArray(value: Option.Option<Record<string, unknown>>, key: string): unknown[] {
  return Option.match(value, {
    onNone: () => [],
    onSome: (record) => toUnknownArray(record[key]),
  })
}

const parseInternalJson = Effect.fn("admin.parseInternalJson")(function* (response: Response) {
  const parsed = yield* Effect.tryPromise(
    () => response.json() as Promise<Record<string, unknown> | null>,
  ).pipe(Effect.orElseSucceed(() => null))
  return Option.fromNullishOr(parsed)
})

const fetchInternalJson = Effect.fn("admin.fetchInternalJson")(function* (
  context: ControlPlaneContext,
  sessionId: string,
  path: string,
) {
  const internalRequests = yield* InternalRequests
  const response = yield* internalRequests.fetch(
    getSessionStub(context.env, sessionId),
    `http://internal${path}`,
  )
  return yield* Match.value(response.ok).pipe(
    Match.when(false, () => Effect.succeed(Option.none<Record<string, unknown>>())),
    Match.orElse(() => parseInternalJson(response)),
  )
})

const buildAdminSessionResponse = Effect.fn("admin.buildAdminSessionResponse")(function* (
  context: ControlPlaneContext,
  sessionId: string,
  record: AdminSessionRecord,
) {
  const sections = yield* Effect.all(
    [
      fetchInternalJson(context, sessionId, "/internal/state"),
      fetchInternalJson(context, sessionId, "/internal/sandbox/activity?limit=100"),
      fetchInternalJson(context, sessionId, "/internal/messages?limit=25"),
      fetchInternalJson(context, sessionId, "/internal/artifacts"),
    ],
    { concurrency: "unbounded" },
  )
  const [state, activity, messages, artifacts] = sections
  return json({
    session: record,
    state: Option.getOrNull(state),
    sandboxActivity: extractArray(activity, "activity"),
    messages: extractArray(messages, "messages"),
    artifacts: extractArray(artifacts, "artifacts"),
  })
})

const finalizeSessionStatus = Effect.fn("admin.finalizeSessionStatus")(function* (
  store: AdminStore,
  sessionId: string,
  storedStatus: string,
  responseStatus: string,
) {
  yield* store.updateSessionStatus(sessionId, storedStatus, Date.now())
  return json({ status: responseStatus, targetType: "session", targetId: sessionId })
})

const performStopSession = Effect.fn("admin.performStopSession")(function* (
  context: ControlPlaneContext,
  sessionId: string,
) {
  const store = new AdminStore(context.env.DB)
  const record = yield* store.getSession(sessionId)
  yield* requireOption(record, "Session not found", 404)
  const internalRequests = yield* InternalRequests
  const response = yield* internalRequests.fetch(
    getSessionStub(context.env, sessionId),
    "http://internal/internal/stop",
    { method: "POST" },
  )
  return yield* Match.value(response.ok).pipe(
    Match.when(false, () => Effect.succeed(response)),
    Match.orElse(() =>
      Effect.succeed(json({ status: "stopped", targetType: "session", targetId: sessionId })),
    ),
  )
})

const performArchiveSession = Effect.fn("admin.performArchiveSession")(function* (
  context: ControlPlaneContext,
  sessionId: string,
) {
  const store = new AdminStore(context.env.DB)
  const record = yield* store.getSession(sessionId)
  const resolved = yield* requireOption(record, "Session not found", 404)
  const internalRequests = yield* InternalRequests
  const response = yield* internalRequests.fetch(
    getSessionStub(context.env, sessionId),
    "http://internal/internal/archive",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyJson({ userId: resolved.userId }),
    },
  )
  return yield* Match.value(response.ok).pipe(
    Match.when(false, () => Effect.succeed(response)),
    Match.orElse(() => finalizeSessionStatus(store, sessionId, "archived", "archived")),
  )
})

const performUnarchiveSession = Effect.fn("admin.performUnarchiveSession")(function* (
  context: ControlPlaneContext,
  sessionId: string,
) {
  const store = new AdminStore(context.env.DB)
  const record = yield* store.getSession(sessionId)
  const resolved = yield* requireOption(record, "Session not found", 404)
  const internalRequests = yield* InternalRequests
  const response = yield* internalRequests.fetch(
    getSessionStub(context.env, sessionId),
    "http://internal/internal/unarchive",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyJson({ userId: resolved.userId }),
    },
  )
  return yield* Match.value(response.ok).pipe(
    Match.when(false, () => Effect.succeed(response)),
    Match.orElse(() => finalizeSessionStatus(store, sessionId, "active", "active")),
  )
})

const performDeleteSession = Effect.fn("admin.performDeleteSession")(function* (
  context: ControlPlaneContext,
  sessionId: string,
) {
  const store = new AdminStore(context.env.DB)
  const session = yield* store.getSession(sessionId)
  yield* IsolateSessionRuntime.clearSubagentRunsBeforeDelete({
    env: context.env,
    tracing: resolveCloudflareTracing(context.ctx),
    sessionId,
    agentRuntime: Option.getOrUndefined(session)?.agentRuntime,
  })
  const deleted = yield* store.deleteSession(sessionId)
  yield* failUnless(deleted, "Session not found", 404)
  return json({ status: "deleted", targetType: "session", targetId: sessionId })
})

const performGithubAccountCleanup = Effect.fn("admin.performGithubAccountCleanup")(function* (
  context: ControlPlaneContext,
) {
  const result = yield* new AdminStore(context.env.DB).cleanupGitHubAccounts()
  return json({
    status: "deleted",
    affectedUsers: result.affectedUsers,
    deletedAccounts: result.linkedAccounts,
  })
})

const performRunWorkflow = Effect.fn("admin.performRunWorkflow")(function* (
  context: ControlPlaneContext,
  params: AdminIdParams,
  payload: AdminRunWorkflowPayload,
) {
  const run = yield* new WorkflowLifecycle(context.env)
    .startWorkflowRunById({
      workflowId: params.id,
      trigger: createWorkflowTrigger(payload.trigger),
    })
    .pipe(Effect.mapError((cause) => lifecycleFailure(cause)))
  return json({
    status: "started",
    targetType: "workflow",
    targetId: params.id,
    runId: run.id,
  })
})

const performRetryWorkflowRun = Effect.fn("admin.performRetryWorkflowRun")(function* (
  context: ControlPlaneContext,
  params: AdminWorkflowRunParams,
) {
  const nextRun = yield* new WorkflowLifecycle(context.env)
    .retryWorkflowRun({
      workflowId: params.id,
      runId: params.runId,
    })
    .pipe(Effect.mapError((cause) => lifecycleFailure(cause)))
  return json({
    status: "started",
    targetType: "workflow_run",
    targetId: params.runId,
    runId: nextRun.id,
  })
})

const performArchiveWorkflow = Effect.fn("admin.performArchiveWorkflow")(function* (
  context: ControlPlaneContext,
  params: AdminIdParams,
) {
  yield* new WorkflowLifecycle(context.env)
    .archiveWorkflowById(params.id)
    .pipe(Effect.mapError((cause) => lifecycleFailure(cause)))
  return json({ status: "archived", targetType: "workflow", targetId: params.id })
})

const performUnarchiveWorkflow = Effect.fn("admin.performUnarchiveWorkflow")(function* (
  context: ControlPlaneContext,
  params: AdminIdParams,
) {
  yield* new WorkflowLifecycle(context.env)
    .unarchiveWorkflowById(params.id)
    .pipe(Effect.mapError((cause) => lifecycleFailure(cause)))
  return json({ status: "active", targetType: "workflow", targetId: params.id })
})

export function summary() {
  return runControlPlane(
    Effect.fn("admin.summary")(function* (context: ControlPlaneContext) {
      yield* requireAdmin(context)
      const result = yield* new AdminStore(context.env.DB).getSummary()
      return json(result)
    }),
  )
}

export function access() {
  return runControlPlane(
    Effect.fn("admin.access")(function* (context: ControlPlaneContext) {
      const isAdmin = yield* resolveAdminAccess(context)
      return json({ isAdmin })
    }),
  )
}

export function sessions({ query }: { query: AdminListQuery }) {
  return runControlPlane(
    Effect.fn("admin.sessions")(function* (context: ControlPlaneContext) {
      yield* requireAdmin(context)
      const result = yield* new AdminStore(context.env.DB).listSessions(query)
      return json(result)
    }),
  )
}

export function session({ params }: { params: AdminIdParams }) {
  return runControlPlane(
    Effect.fn("admin.session")(function* (context: ControlPlaneContext) {
      yield* requireAdmin(context)
      const store = new AdminStore(context.env.DB)
      const record = yield* store.getSession(params.id)
      const resolved = yield* requireOption(record, "Session not found", 404)
      return yield* buildAdminSessionResponse(context, params.id, resolved)
    }),
  )
}

export function stopSession({
  params,
  payload,
}: {
  params: AdminIdParams
  payload: AdminActionPayload
}) {
  return runControlPlane(
    Effect.fn("admin.stopSession")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "session",
          targetId: params.id,
          action: "stop",
          reason: payload.reason,
        },
        performStopSession(context, params.id),
      )
    }),
  )
}

export function archiveSession({
  params,
  payload,
}: {
  params: AdminIdParams
  payload: AdminActionPayload
}) {
  return runControlPlane(
    Effect.fn("admin.archiveSession")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "session",
          targetId: params.id,
          action: "archive",
          reason: payload.reason,
        },
        performArchiveSession(context, params.id),
      )
    }),
  )
}

export function unarchiveSession({
  params,
  payload,
}: {
  params: AdminIdParams
  payload: AdminActionPayload
}) {
  return runControlPlane(
    Effect.fn("admin.unarchiveSession")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "session",
          targetId: params.id,
          action: "unarchive",
          reason: payload.reason,
        },
        performUnarchiveSession(context, params.id),
      )
    }),
  )
}

export function deleteSession({
  params,
  payload,
}: {
  params: AdminIdParams
  payload: AdminActionPayload
}) {
  return runControlPlane(
    Effect.fn("admin.deleteSession")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "session",
          targetId: params.id,
          action: "delete",
          reason: payload.reason,
        },
        performDeleteSession(context, params.id),
      )
    }),
  )
}

export function workflows({ query }: { query: AdminWorkflowListQuery }) {
  return runControlPlane(
    Effect.fn("admin.workflows")(function* (context: ControlPlaneContext) {
      yield* requireAdmin(context)
      const result = yield* new AdminStore(context.env.DB).listWorkflows(query)
      const serverUrl = getInfraServerUrl(context.env)
      return json({
        ...result,
        workflows: result.workflows.map((workflow) => formatWorkflowForAdmin(workflow, serverUrl)),
      })
    }),
  )
}

export function workflowRuns({ params }: { params: AdminIdParams }) {
  return runControlPlane(
    Effect.fn("admin.workflowRuns")(function* (context: ControlPlaneContext) {
      yield* requireAdmin(context)
      const store = new AdminStore(context.env.DB)
      const workflow = yield* store.getWorkflow(params.id)
      yield* requireOption(workflow, "Workflow not found", 404)
      const runs = yield* store.listWorkflowRuns(params.id)
      return json({ runs })
    }),
  )
}

export function workflowRunEvents({ params }: { params: AdminWorkflowRunParams }) {
  return runControlPlane(
    Effect.fn("admin.workflowRunEvents")(function* (context: ControlPlaneContext) {
      yield* requireAdmin(context)
      const store = new AdminStore(context.env.DB)
      const run = yield* store.getWorkflowRun(params.id, params.runId)
      yield* requireOption(run, "Workflow run not found", 404)
      const events = yield* store.listWorkflowRunEvents(params.id, params.runId)
      return json({ events })
    }),
  )
}

export function githubAccountCleanupPreview() {
  return runControlPlane(
    Effect.fn("admin.githubAccountCleanupPreview")(function* (context: ControlPlaneContext) {
      yield* requireAdmin(context)
      const preview = yield* new AdminStore(context.env.DB).previewGitHubAccountCleanup()
      return json(preview)
    }),
  )
}

export function githubAccountCleanup() {
  return runControlPlane(
    Effect.fn("admin.githubAccountCleanup")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "github_account",
          targetId: "all",
          action: "cleanup",
          reason: "Temporary GitHub App reauthorization cleanup",
        },
        performGithubAccountCleanup(context),
      )
    }),
  )
}

export function mcpcf() {
  return runControlPlane(
    Effect.fn("admin.mcpcf")(function* (context: ControlPlaneContext) {
      yield* requireAdmin(context)
      const data = yield* getMcpcfAdminResponse(context)
      return json(data)
    }),
  )
}

export function updateMcpcfConfig({ payload }: { payload: AdminMcpcfConfigPayload }) {
  return runControlPlane(
    Effect.fn("admin.updateMcpcfConfig")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "mcpcf",
          targetId: "config",
          action: "update_config",
          reason: "Admin MCP Context Forge configuration update",
        },
        performUpdateMcpcfConfig(context, admin, payload),
      )
    }),
  )
}

export function resetMcpcfConfig() {
  return runControlPlane(
    Effect.fn("admin.resetMcpcfConfig")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "mcpcf",
          targetId: "config",
          action: "reset_config",
          reason: "Admin MCP Context Forge configuration reset",
        },
        performResetMcpcfConfig(context, admin),
      )
    }),
  )
}

export function exportMcpcfConfig() {
  return runControlPlane(
    Effect.fn("admin.exportMcpcfConfig")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "mcpcf",
          targetId: "config",
          action: "export_config",
          reason: "Admin MCP Context Forge configuration export",
        },
        performExportMcpcfConfig(context, admin),
      )
    }),
  )
}

export function refreshMcpcf() {
  return runControlPlane(
    Effect.fn("admin.refreshMcpcf")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "mcpcf",
          targetId: "registry",
          action: "refresh",
          reason: "Manual MCP Context Forge registry refresh",
        },
        performRefreshMcpcf(context, admin),
      )
    }),
  )
}

export function aiProviders() {
  return runControlPlane(
    Effect.fn("admin.aiProviders")(function* (context: ControlPlaneContext) {
      yield* requireAdmin(context)
      const data = yield* getAiProvidersAdminResponse(context)
      return json(data)
    }),
  )
}

export function aiSearch() {
  return runControlPlane(
    Effect.fn("admin.aiSearch")(function* (context: ControlPlaneContext) {
      yield* requireAdmin(context)
      const data = yield* getAiSearchAdminResponse(context)
      return json(data)
    }),
  )
}

export function exportAiSearchConfig() {
  return runControlPlane(
    Effect.fn("admin.exportAiSearchConfig")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "ai_search",
          targetId: "config",
          action: "export_config",
          reason: "Admin AI Search configuration export",
        },
        performExportAiSearchConfig(context, admin),
      )
    }),
  )
}

export function createAiSearchSource({ payload }: { payload: AdminAiSearchSourcePayload }) {
  return runControlPlane(
    Effect.fn("admin.createAiSearchSource")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "ai_search_source",
          targetId: payload.id,
          action: "create",
        },
        performCreateAiSearchSource(context, admin, payload),
      )
    }),
  )
}

export function updateAiSearchSource({
  params,
  payload,
}: {
  params: AdminIdParams
  payload: AdminAiSearchSourcePayload
}) {
  return runControlPlane(
    Effect.fn("admin.updateAiSearchSource")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "ai_search_source",
          targetId: params.id,
          action: "update",
        },
        performUpdateAiSearchSource(context, admin, params.id, payload),
      )
    }),
  )
}

export function deleteAiSearchSource({ params }: { params: AdminIdParams }) {
  return runControlPlane(
    Effect.fn("admin.deleteAiSearchSource")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "ai_search_source",
          targetId: params.id,
          action: "delete",
        },
        performDeleteAiSearchSource(context, admin, params.id),
      )
    }),
  )
}

export function updateLitellmProvider({ payload }: { payload: AdminLitellmConfigPayload }) {
  return runControlPlane(
    Effect.fn("admin.updateLitellmProvider")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "ai_provider",
          targetId: "litellm",
          action: "update_config",
        },
        performUpdateLitellmProvider(context, admin, payload),
      )
    }),
  )
}

export function updateCloudflareAiGatewayProviderKeys({
  payload,
}: {
  payload: AdminCloudflareAiGatewayProviderKeysPayload
}) {
  return runControlPlane(
    Effect.fn("admin.updateCloudflareAiGatewayProviderKeys")(function* (
      context: ControlPlaneContext,
    ) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "ai_provider",
          targetId: "cloudflare-ai-gateway",
          action: "update_provider_keys",
        },
        performUpdateCloudflareAiGatewayProviderKeys(context, admin, payload),
      )
    }),
  )
}

export function resetLitellmProvider() {
  return runControlPlane(
    Effect.fn("admin.resetLitellmProvider")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "ai_provider",
          targetId: "litellm",
          action: "reset_config",
        },
        performResetLitellmProvider(context, admin),
      )
    }),
  )
}

export function exportLitellmProvider() {
  return runControlPlane(
    Effect.fn("admin.exportLitellmProvider")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "ai_provider",
          targetId: "litellm",
          action: "export_config",
        },
        performExportLitellmProvider(context, admin),
      )
    }),
  )
}

export function syncLitellmModels() {
  return runControlPlane(
    Effect.fn("admin.syncLitellmModels")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "ai_provider",
          targetId: "litellm",
          action: "sync_models",
        },
        performSyncLitellmModels(context, admin),
      )
    }),
  )
}

export function runWorkflow({
  params,
  payload,
}: {
  params: AdminIdParams
  payload: AdminRunWorkflowPayload
}) {
  return runControlPlane(
    Effect.fn("admin.runWorkflow")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "workflow",
          targetId: params.id,
          action: "run",
          reason: payload.reason,
        },
        performRunWorkflow(context, params, payload),
      )
    }),
  )
}

export function retryWorkflowRun({
  params,
  payload,
}: {
  params: AdminWorkflowRunParams
  payload: AdminActionPayload
}) {
  return runControlPlane(
    Effect.fn("admin.retryWorkflowRun")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "workflow_run",
          targetId: params.runId,
          action: "retry",
          reason: payload.reason,
        },
        performRetryWorkflowRun(context, params),
      )
    }),
  )
}

export function archiveWorkflow({
  params,
  payload,
}: {
  params: AdminIdParams
  payload: AdminActionPayload
}) {
  return runControlPlane(
    Effect.fn("admin.archiveWorkflow")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "workflow",
          targetId: params.id,
          action: "archive",
          reason: payload.reason,
        },
        performArchiveWorkflow(context, params),
      )
    }),
  )
}

export function unarchiveWorkflow({
  params,
  payload,
}: {
  params: AdminIdParams
  payload: AdminActionPayload
}) {
  return runControlPlane(
    Effect.fn("admin.unarchiveWorkflow")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "workflow",
          targetId: params.id,
          action: "unarchive",
          reason: payload.reason,
        },
        performUnarchiveWorkflow(context, params),
      )
    }),
  )
}
