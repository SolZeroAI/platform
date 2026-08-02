import { getInfraServerUrl, WORKFLOW_NODE_CATALOG, type WorkflowManifest } from "@c0-agent/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import {
  WorkflowStore,
  type WorkflowRecord,
  type WorkflowRunRecord,
} from "../../../background/db/workflows"
import { readWorkflowManifest } from "../../../background/workflows/artifacts"
import {
  createWorkflowTrigger,
  WorkflowLifecycle,
  WorkflowLifecycleInputError,
  WorkflowLifecycleNotFoundError,
  WorkflowRetryTriggerError,
} from "../../../background/workflows/lifecycle"
import type { WorkflowManifestMigrationResult } from "../../../background/workflows/manifest-migrations"
import { parseJson } from "../../../lib/json"
import {
  ControlPlaneFailure,
  describeError,
  failUnless,
  json,
  requireOption,
  requirePrincipalUserId,
  resolveUserIdentity,
  runControlPlane,
  type ControlPlaneContext,
} from "../shared/control-plane"

export function parseListNumber(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value)
  return Match.value(Number.isFinite(parsed) && parsed >= 0).pipe(
    Match.when(true, () => Math.min(Math.floor(parsed), max)),
    Match.orElse(() => fallback),
  )
}

export function formatWorkflow(
  record: WorkflowRecord,
  manifest?: WorkflowManifest,
  serverUrl?: string,
) {
  const webhookPath = `/workflows/webhooks/${record.webhook_id}`
  const webhookUrl = Option.match(Option.fromNullishOr(serverUrl), {
    onSome: (base) => new URL(webhookPath, base).toString(),
    onNone: () => null,
  })
  return {
    id: record.id,
    userId: record.user_id,
    name: record.name,
    status: record.status,
    manifestVersion: record.manifest_version,
    manifestKey: record.manifest_key,
    codeKey: record.code_key,
    webhookId: record.webhook_id,
    webhookPath,
    webhookUrl,
    manifest,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

function formatWorkflowManifestMigration(migration: WorkflowManifestMigrationResult) {
  return {
    fromVersion: migration.fromVersion,
    toVersion: migration.toVersion,
    steps: migration.steps,
  }
}

export function formatWorkflowRun(run: WorkflowRunRecord) {
  const output = Option.match(Option.fromNullishOr(run.output_json), {
    onSome: (raw) => parseJson(raw) as Record<string, unknown>,
    onNone: () => null,
  })
  return {
    id: run.id,
    workflowId: run.workflow_id,
    workflowVersion: run.workflow_version,
    workflowInstanceId: run.workflow_instance_id,
    userId: run.user_id,
    triggerKind: run.trigger_kind,
    triggerNodeId: run.trigger_node_id,
    status: run.status,
    input: parseJson(run.input_json) as Record<string, unknown>,
    output,
    error: run.error,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    updatedAt: run.updated_at,
  }
}

const lifecycleFailureStatus = (cause: unknown): Option.Option<number> =>
  Match.value(cause).pipe(
    Match.when(Match.instanceOf(WorkflowLifecycleInputError), () => Option.some(400)),
    Match.when(Match.instanceOf(WorkflowRetryTriggerError), () => Option.some(400)),
    Match.when(Match.instanceOf(WorkflowLifecycleNotFoundError), () => Option.some(404)),
    Match.orElse(() => Option.none<number>()),
  )

/**
 * Maps a known workflow-lifecycle rejection into a tagged control-plane failure (400/404).
 * Unexpected causes are re-surfaced unchanged so the runtime renders/logs a 500.
 */
export const lifecycleFailure = (cause: unknown) =>
  Option.match(lifecycleFailureStatus(cause), {
    onSome: (status) =>
      new ControlPlaneFailure({ payload: { error: describeError(cause) }, status }),
    onNone: () => cause,
  })

/** Resolves a non-archived workflow owned by the acting user, failing otherwise. */
export const requireWorkflowForUser = Effect.fn("workflows.requireWorkflowForUser")(function* (
  context: ControlPlaneContext,
  workflowId: string,
) {
  const userId = yield* requirePrincipalUserId(context.request, context.principal)
  const store = new WorkflowStore(context.db)
  const found = yield* store.getWorkflowForUser(workflowId, userId)
  const workflow = yield* requireOption(found, "Workflow not found", 404)
  yield* failUnless(workflow.status !== "archived", "Workflow not found", 404)
  return { workflow, userId }
})

export function catalog() {
  return runControlPlane(() => Effect.succeed(json({ nodes: WORKFLOW_NODE_CATALOG })))
}

export function createWorkflow(input: { payload: { name: string; manifest: unknown } }) {
  return runControlPlane(
    Effect.fn("workflows.create")(function* ({ request, env, principal, identityProvider }) {
      const identity = yield* resolveUserIdentity(request, env, principal, identityProvider)
      const created = yield* new WorkflowLifecycle(env)
        .createWorkflow({
          name: input.payload.name,
          manifest: input.payload.manifest,
          userId: identity.userId,
        })
        .pipe(Effect.mapError(lifecycleFailure))
      return json(
        {
          workflow: formatWorkflow(created.workflow, created.manifest, getInfraServerUrl(env)),
          manifestMigration: formatWorkflowManifestMigration(created.migration),
        },
        201,
      )
    }),
  )
}

export function updateWorkflow(input: {
  params: { id: string }
  payload: { name: string; manifest: unknown }
}) {
  return runControlPlane(
    Effect.fn("workflows.update")(function* (context) {
      const { workflow } = yield* requireWorkflowForUser(context, input.params.id)
      const updated = yield* new WorkflowLifecycle(context.env)
        .updateWorkflow({
          workflow,
          name: input.payload.name,
          manifest: input.payload.manifest,
        })
        .pipe(Effect.mapError(lifecycleFailure))
      return json({
        workflow: formatWorkflow(
          updated.workflow,
          updated.manifest,
          getInfraServerUrl(context.env),
        ),
        manifestMigration: formatWorkflowManifestMigration(updated.migration),
      })
    }),
  )
}

export function updateWorkflowName(input: { params: { id: string }; payload: { name: string } }) {
  return runControlPlane(
    Effect.fn("workflows.updateName")(function* (context) {
      const name = input.payload.name.trim()
      yield* failUnless(name.length > 0, "Workflow name is required", 400)
      const { workflow } = yield* requireWorkflowForUser(context, input.params.id)
      const store = new WorkflowStore(context.db)
      const updated = yield* store.updateWorkflowName({
        id: workflow.id,
        userId: workflow.user_id,
        name,
        updatedAt: Date.now(),
      })
      const resolved = yield* requireOption(updated, "Workflow not found", 404)
      const manifest = yield* readWorkflowManifest(context.env, resolved.manifest_key)
      return json({
        workflow: formatWorkflow(resolved, manifest, getInfraServerUrl(context.env)),
      })
    }),
  )
}

export function runWorkflow(input: { params: { id: string }; payload: { trigger?: unknown } }) {
  return runControlPlane(
    Effect.fn("workflows.run")(function* (context) {
      const { workflow } = yield* requireWorkflowForUser(context, input.params.id)
      const trigger = createWorkflowTrigger(input.payload.trigger)
      const run = yield* new WorkflowLifecycle(context.env).startWorkflowRun({ workflow, trigger })
      return json({ run: formatWorkflowRun(run) }, 201)
    }),
  )
}
