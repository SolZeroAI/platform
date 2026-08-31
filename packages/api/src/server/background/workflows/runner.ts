import type { LoadWorkflowRunnerContext, WorkflowRunner } from "@cloudflare/dynamic-workflows"
import type { WorkflowManifestNode } from "@solzero/shared"
import { generateId } from "../auth/crypto"
import {
  createWorkflowStoreFromD1,
  type WorkflowRecord,
  type WorkflowRunRecord,
  type WorkflowRunTriggerKind,
} from "../db/workflows"
import { makeControlPlaneFromEnv } from "../../effect/db/control-plane-db"
import { resolveOktaUserId } from "../../lib/better-auth"
import { createApiRequestObserver, type RequestLogger } from "../../effect/services/observability"
import type { Env } from "../types"
import { getWorkflowCodeKey, readWorkflowCode } from "./artifacts"
import {
  getWorkflowRuntimeKernelModules,
  getWorkflowRuntimeLoaderCacheVersion,
} from "./runtime-abi"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"

export interface WorkflowTriggerPayload {
  kind: WorkflowRunTriggerKind
  nodeId?: string | null
  payload?: Record<string, unknown> | null
  cron?: string | null
  scheduledAt?: string | null
  firedAt?: string | null
}

export interface StartWorkflowRunInput {
  env: Env
  workflow: WorkflowRecord
  trigger: WorkflowTriggerPayload
  userId: string
  oktaUserId?: string | null
  log?: RequestLogger
}

export interface WorkflowActionsEntrypoint {
  executeWorkflowNode(input: {
    workflowId: string
    runId: string
    manifestVersion?: number
    node: WorkflowManifestNode
    inputs: Record<string, unknown>
    trigger: WorkflowTriggerPayload
    userId: string
    oktaUserId?: string | null
  }): Promise<Record<string, unknown>>
  recordWorkflowEvent(input: {
    workflowId: string
    runId: string
    userId: string
    oktaUserId?: string | null
    nodeId?: string | null
    eventType: string
    level?: "info" | "warn" | "error"
    message: string
    data?: Record<string, unknown> | null
  }): Promise<{ ok: true }>
  completeWorkflowRun(input: {
    workflowId: string
    runId: string
    status: "completed" | "failed"
    output?: Record<string, unknown> | null
    error?: string | null
  }): Promise<{ ok: true }>
}

interface WorkflowActionsLoopbackContext extends ExecutionContext {
  exports?: {
    WorkflowActions?: (options: { props?: Record<string, never> }) => WorkflowActionsEntrypoint
  }
}

export interface DynamicWorkflowParams {
  workflowId: string
  runId: string
  trigger: WorkflowTriggerPayload
  userId: string
  oktaUserId?: string | null
}

interface WorkflowBindingLike {
  create(options: { id: string; params: DynamicWorkflowParams }): Promise<WorkflowInstanceLike>
  get(id: string): Promise<WorkflowInstanceLike>
}

interface WorkflowInstanceLike {
  id: string | Promise<string>
  status(): Promise<WorkflowInstanceStatus>
  sendEvent(input: { type: string; payload: unknown }): Promise<void>
  terminate(): Promise<void>
}

export interface WorkflowInstanceStatus {
  status: string
  error?: unknown
  output?: unknown
}

export interface TerminalWorkflowRunUpdate {
  status: "completed" | "failed"
  output?: Record<string, unknown> | null
  error?: string | null
}

const DYNAMIC_WORKFLOW_COMPATIBILITY_DATE = "2026-03-17"

const WORKFLOW_LOADER_ROUTE_BRANCH = "workflow-loader"

function recordOptionFromUnknown(value: unknown): Option.Option<Record<string, unknown>> {
  return Option.liftPredicate(value, (resolved: unknown): resolved is Record<string, unknown> =>
    Boolean(resolved && typeof resolved === "object" && !Array.isArray(resolved)),
  )
}

function outputRecordOptionFromUnknown(value: unknown): Option.Option<Record<string, unknown>> {
  return recordOptionFromUnknown(value).pipe(
    Option.orElse(() =>
      Match.value(value === null || value === undefined).pipe(
        Match.when(true, () => Option.none<Record<string, unknown>>()),
        Match.orElse(() => Option.some({ value })),
      ),
    ),
  )
}

function nonEmptyStringOption(value: unknown): Option.Option<string> {
  return Option.liftPredicate(
    value,
    (resolved: unknown): resolved is string =>
      typeof resolved === "string" && resolved.trim().length > 0,
  )
}

function formatWorkflowInstanceError(status: WorkflowInstanceStatus): string {
  const error = status.error
  return nonEmptyStringOption(error).pipe(
    Option.orElse(() =>
      recordOptionFromUnknown(error).pipe(
        Option.flatMap((record) => nonEmptyStringOption(record.message)),
      ),
    ),
    Option.getOrElse(() => `Workflow instance ${status.status}`),
  )
}

function responseUrlRedaction(payload: Record<string, unknown>): Record<string, string> {
  return Match.value(Object.prototype.hasOwnProperty.call(payload, "responseUrl")).pipe(
    Match.when(true, () => ({ responseUrl: "[redacted]" })),
    Match.orElse(() => ({})),
  )
}

function redactSlackWorkflowTrigger(trigger: WorkflowTriggerPayload): WorkflowTriggerPayload {
  const payload = Option.getOrElse(recordOptionFromUnknown(trigger.payload), () => ({}))
  return {
    ...trigger,
    payload: {
      ...payload,
      ...responseUrlRedaction(payload),
    },
  }
}

function redactWorkflowTriggerForEvent(trigger: WorkflowTriggerPayload): WorkflowTriggerPayload {
  return Match.value(trigger.kind).pipe(
    Match.when("slack", () => redactSlackWorkflowTrigger(trigger)),
    Match.orElse(() => trigger),
  )
}

export function getTerminalWorkflowRunUpdate(status: WorkflowInstanceStatus) {
  return Match.value(status.status).pipe(
    Match.when(
      "complete",
      (): TerminalWorkflowRunUpdate => ({
        status: "completed",
        output: Option.getOrNull(outputRecordOptionFromUnknown(status.output)),
        error: null,
      }),
    ),
    Match.whenOr(
      "errored",
      "terminated",
      (): TerminalWorkflowRunUpdate => ({
        status: "failed",
        output: null,
        error: formatWorkflowInstanceError(status),
      }),
    ),
    Match.orElse(() => null),
  )
}

export async function getWrappedWorkflowBinding(
  workflow: WorkflowRecord,
  version = workflow.manifest_version,
): Promise<WorkflowBindingLike> {
  const { wrapWorkflowBinding } = await import("@cloudflare/dynamic-workflows")
  // oxlint-disable-next-line effect/avoid-any -- Interop cast bridging the untyped `@cloudflare/dynamic-workflows` binding wrapper onto the local `WorkflowBindingLike` RPC surface; the wrapper return type is structurally opaque and is a runtime stub, not Schema-validatable data.
  return wrapWorkflowBinding(getWorkflowBindingMetadata(workflow, version), {
    bindingName: "DYNAMIC_WORKFLOW",
  }) as unknown as WorkflowBindingLike
}

export function getWorkflowBindingMetadata(
  workflow: WorkflowRecord,
  version = workflow.manifest_version,
): { workflowId: string; version: number; userId: string; codeKey: string } {
  return {
    workflowId: workflow.id,
    version,
    userId: workflow.user_id,
    codeKey: getWorkflowCodeKeyForVersion(workflow, version),
  }
}

export function getWorkflowLoaderCacheKey(input: { workflowId: string; version: number }): string {
  return `${input.workflowId}:v${input.version}:${getWorkflowRuntimeLoaderCacheVersion()}`
}

export function getWorkflowCodeKeyForVersion(workflow: WorkflowRecord, version: number): string {
  Match.value(Number.isInteger(version) && version >= 1).pipe(
    Match.when(false, () => {
      throw new Error("Dynamic workflow metadata must include a positive integer version")
    }),
    Match.orElse(() => undefined),
  )
  Match.value(version > workflow.manifest_version).pipe(
    Match.when(true, () => {
      throw new Error(`Workflow '${workflow.id}' version ${version} is not available`)
    }),
    Match.orElse(() => undefined),
  )
  return Match.value(version === workflow.manifest_version).pipe(
    Match.when(true, () => workflow.code_key),
    Match.orElse(() =>
      getWorkflowCodeKey({
        userId: workflow.user_id,
        workflowId: workflow.id,
        version,
      }),
    ),
  )
}

function stringMetadataValue(
  metadata: Record<string, unknown>,
  key: string,
): Option.Option<string> {
  const value = metadata[key]
  return nonEmptyStringOption(value)
}

export function resolveWorkflowCodeKey(input: {
  workflow: WorkflowRecord | null
  workflowId: string
  version: number
  metadataCodeKey?: string | null
}): { codeKey: string; source: "metadata" | "workflow-row" } {
  return Option.match(nonEmptyStringOption(input.metadataCodeKey), {
    onNone: () =>
      Option.match(Option.fromNullishOr(input.workflow), {
        onNone: () => {
          throw new Error(`Workflow '${input.workflowId}' was not found`)
        },
        onSome: (workflow) => ({
          codeKey: getWorkflowCodeKeyForVersion(workflow, input.version),
          source: "workflow-row",
        }),
      }),
    onSome: (codeKey) => ({ codeKey, source: "metadata" }),
  })
}

function numberMetadataValue(value: unknown): number {
  return Match.value(value).pipe(
    Match.when(Match.number, (resolved) => resolved),
    Match.orElse(() => Number(value)),
  )
}

function validateWorkflowLoaderMetadata(workflowId: string, version: number): void {
  Match.value(!workflowId || !Number.isFinite(version)).pipe(
    Match.when(true, () => {
      throw new Error("Dynamic workflow metadata must include workflowId and version")
    }),
    Match.orElse(() => undefined),
  )
}

function setObserverUserId(
  observer: ReturnType<typeof createApiRequestObserver>,
  userId: Option.Option<string>,
) {
  Option.match(userId, {
    onNone: () => undefined,
    onSome: (resolvedUserId) => observer.setUserId(resolvedUserId),
  })
}

async function readWorkflowForLoader(input: {
  env: Env
  workflowId: string
  metadataCodeKey: Option.Option<string>
}): Promise<WorkflowRecord | null> {
  return Option.match(input.metadataCodeKey, {
    onNone: () =>
      createWorkflowStoreFromD1(makeControlPlaneFromEnv(input.env)).getWorkflow(input.workflowId),
    onSome: () => Promise.resolve(null),
  })
}

async function loadObservedDynamicWorkflowRunner(input: {
  env: Env
  ctx: ExecutionContext
  workflowId: string
  version: number
  metadataCodeKey: Option.Option<string>
  log: RequestLogger
}): Promise<WorkflowRunner> {
  const workflow = await readWorkflowForLoader(input)
  const { codeKey, source } = resolveWorkflowCodeKey({
    workflow,
    workflowId: input.workflowId,
    version: input.version,
    metadataCodeKey: Option.getOrNull(input.metadataCodeKey),
  })

  input.log.set({
    workflowId: input.workflowId,
    workflowVersion: input.version,
    codeKey,
    codeKeySource: source,
    workflowRowFound: Boolean(workflow),
  })

  // oxlint-disable-next-line effect/effect-run-in-body -- Dynamic workflow loader boundary must return a Promise to the Cloudflare SDK while loading code stored by Effect artifact helpers.
  const code = await Effect.runPromise(readWorkflowCode(input.env, codeKey))
  const stub = input.env.WORKFLOW_LOADER.load({
    compatibilityDate: DYNAMIC_WORKFLOW_COMPATIBILITY_DATE,
    mainModule: "index.js",
    modules: {
      "index.js": code,
      ...getWorkflowRuntimeKernelModules(),
    },
    env: {
      S0_WORKFLOW_ACTIONS: resolveWorkflowActionsBinding(input),
    },
    globalOutbound: null,
  })

  // oxlint-disable-next-line effect/avoid-any -- Interop cast bridging the dynamic loader stub's generic `getEntrypoint` return onto the local `WorkflowRunner` RPC surface; the entrypoint is a runtime stub, not Schema-validatable data.
  return stub.getEntrypoint("TenantWorkflow") as unknown as WorkflowRunner
}

export async function loadDynamicWorkflowRunner(
  input: Pick<LoadWorkflowRunnerContext<Env>, "env" | "metadata" | "ctx">,
): Promise<WorkflowRunner> {
  const workflowId = Match.value(input.metadata.workflowId).pipe(
    Match.when(Match.string, (resolved) => resolved),
    Match.orElse(() => ""),
  )
  const version = numberMetadataValue(input.metadata.version)
  validateWorkflowLoaderMetadata(workflowId, version)
  const metadataCodeKey = stringMetadataValue(input.metadata, "codeKey")
  const metadataUserId = stringMetadataValue(input.metadata, "userId")
  const observer = createApiRequestObserver(
    new Request(
      `http://workflow-loader.internal/workflows/${encodeURIComponent(workflowId)}/v${version}`,
      { method: "POST" },
    ),
    input.env,
    input.ctx,
  )
  observer.setRouteBranch(WORKFLOW_LOADER_ROUTE_BRANCH)
  setObserverUserId(observer, metadataUserId)
  observer.log.set({
    workflowId,
    workflowVersion: version,
    hasMetadataCodeKey: Option.isSome(metadataCodeKey),
    hasMetadataUserId: Option.isSome(metadataUserId),
  })

  let runner = Option.none<WorkflowRunner>()
  function recordLoadedRunner(loadedRunner: WorkflowRunner): Response {
    runner = Option.some(loadedRunner)
    return new Response(null, { status: 200 })
  }

  await observer.run(({ log }) =>
    loadObservedDynamicWorkflowRunner({
      env: input.env,
      ctx: input.ctx,
      workflowId,
      version,
      metadataCodeKey,
      log,
    }).then(recordLoadedRunner),
  )
  return Option.getOrThrowWith(runner, () => new Error("Dynamic workflow runner was not loaded"))
}

function workflowActionsServiceBinding(input: {
  env: Pick<Env, "WORKFLOW_ACTIONS">
}): WorkflowActionsEntrypoint {
  // oxlint-disable-next-line effect/avoid-any -- Interop cast bridging the Cloudflare service binding `env.WORKFLOW_ACTIONS` onto the local `WorkflowActionsEntrypoint` RPC surface; the binding is a runtime stub, not Schema-validatable data.
  return input.env.WORKFLOW_ACTIONS as unknown as WorkflowActionsEntrypoint
}

export function resolveWorkflowActionsBinding(input: {
  env: Pick<Env, "WORKFLOW_ACTIONS">
  ctx: ExecutionContext
}): WorkflowActionsEntrypoint {
  const workflowActions = (input.ctx as WorkflowActionsLoopbackContext).exports?.WorkflowActions
  return Match.value(workflowActions).pipe(
    Match.when(
      (resolved: unknown): resolved is NonNullable<typeof workflowActions> =>
        typeof resolved === "function",
      (resolvedWorkflowActions) => resolvedWorkflowActions({ props: {} }),
    ),
    Match.orElse(() => workflowActionsServiceBinding(input)),
  )
}

function isReconcilableRun(run: WorkflowRunRecord): boolean {
  return run.status === "queued" || run.status === "running"
}

function terminalRunEventFields(terminalUpdate: TerminalWorkflowRunUpdate): {
  eventType: "run_completed" | "run_failed"
  level: "info" | "error"
  message: string
} {
  return Match.value(terminalUpdate.status).pipe(
    Match.when("completed", () => ({
      eventType: "run_completed" as const,
      level: "info" as const,
      message: "Workflow run completed",
    })),
    Match.orElse(() => ({
      eventType: "run_failed" as const,
      level: "error" as const,
      message: terminalUpdate.error ?? "Workflow run failed",
    })),
  )
}

function terminalRunEventData(terminalUpdate: TerminalWorkflowRunUpdate): Record<string, unknown> {
  return {
    source: "workflow_instance_status",
    ...Option.match(Option.fromNullishOr(terminalUpdate.output), {
      onNone: () => ({}),
      onSome: (output) => ({ output }),
    }),
    ...Option.match(Option.fromNullishOr(terminalUpdate.error), {
      onNone: () => ({}),
      onSome: (error) => ({ error }),
    }),
  }
}

async function readTerminalWorkflowRunUpdate(input: {
  workflow: WorkflowRecord
  run: WorkflowRunRecord
  workflowInstanceId: string
}): Promise<Option.Option<TerminalWorkflowRunUpdate>> {
  const terminalUpdate = await getWrappedWorkflowBinding(input.workflow, input.run.workflow_version)
    .then((workflowBinding) => workflowBinding.get(input.workflowInstanceId))
    .then((instance) => instance.status())
    .then((status) => getTerminalWorkflowRunUpdate(status))
    .catch(() => null)
  return Option.fromNullishOr(terminalUpdate)
}

async function applyTerminalWorkflowRunUpdate(input: {
  env: Env
  run: WorkflowRunRecord
  terminalUpdate: TerminalWorkflowRunUpdate
}): Promise<WorkflowRunRecord> {
  const store = createWorkflowStoreFromD1(makeControlPlaneFromEnv(input.env))
  const completedAt = Date.now()
  const eventFields = terminalRunEventFields(input.terminalUpdate)
  await store.addRunEvent({
    id: `wfe_${generateId(12)}`,
    workflowId: input.run.workflow_id,
    runId: input.run.id,
    eventType: eventFields.eventType,
    level: eventFields.level,
    message: eventFields.message,
    data: terminalRunEventData(input.terminalUpdate),
    createdAt: completedAt,
  })
  await store.completeRun({
    workflowId: input.run.workflow_id,
    runId: input.run.id,
    status: input.terminalUpdate.status,
    output: input.terminalUpdate.output,
    error: input.terminalUpdate.error,
    completedAt,
  })

  return Option.getOrElse(
    Option.fromNullishOr(await store.getRun(input.run.workflow_id, input.run.id)),
    () => input.run,
  )
}

async function reconcileWorkflowRunInstance(input: {
  env: Env
  workflow: WorkflowRecord
  run: WorkflowRunRecord
  workflowInstanceId: string
}): Promise<WorkflowRunRecord> {
  const terminalUpdate = await readTerminalWorkflowRunUpdate(input)
  return Option.match(terminalUpdate, {
    onNone: () => Promise.resolve(input.run),
    onSome: (resolvedTerminalUpdate) =>
      applyTerminalWorkflowRunUpdate({
        env: input.env,
        run: input.run,
        terminalUpdate: resolvedTerminalUpdate,
      }),
  })
}

export async function reconcileWorkflowRun(input: {
  env: Env
  workflow: WorkflowRecord
  run: WorkflowRunRecord
}): Promise<WorkflowRunRecord> {
  return Match.value(isReconcilableRun(input.run)).pipe(
    Match.when(false, () => Promise.resolve(input.run)),
    Match.orElse(() =>
      Option.match(Option.fromNullishOr(input.run.workflow_instance_id), {
        onNone: () => Promise.resolve(input.run),
        onSome: (workflowInstanceId) =>
          reconcileWorkflowRunInstance({ ...input, workflowInstanceId }),
      }),
    ),
  )
}

function validateWorkflowRunUserId(userId: string): void {
  Match.value(userId.length === 0).pipe(
    Match.when(true, () => {
      throw new Error("Workflow run userId is required")
    }),
    Match.orElse(() => undefined),
  )
}

function workflowIdentityData(userId: string, oktaUserId: string | null): Record<string, string> {
  return Option.fromNullishOr(oktaUserId).pipe(
    Option.match({
      onNone: () => ({ userId }),
      onSome: (resolvedOktaUserId) => ({
        userId,
        oktaUserId: resolvedOktaUserId,
      }),
    }),
  )
}

function errorFromUnknown(error: unknown): Error {
  return Match.value(error).pipe(
    Match.when(Match.instanceOf(Error), (resolvedError) => resolvedError),
    Match.orElse(() => new Error(String(error))),
  )
}

export async function startWorkflowRun(input: StartWorkflowRunInput) {
  const store = createWorkflowStoreFromD1(makeControlPlaneFromEnv(input.env))
  const now = Date.now()
  const runId = `wfr_${generateId(12)}`
  const instanceId = `wf_${runId}`
  const userId = input.userId.trim()
  validateWorkflowRunUserId(userId)
  const oktaUserId = await Match.value(input.oktaUserId).pipe(
    Match.when(
      Match.undefined,
      () =>
        // oxlint-disable-next-line effect/effect-run-in-body -- Workflow instance creation remains a Promise ABI boundary for Cloudflare dynamic workflows.
        Effect.runPromise(
          resolveOktaUserId(input.env, userId).pipe(Effect.orElseSucceed(() => null)),
        ) as Promise<string | null>,
    ),
    Match.orElse((resolved) => Promise.resolve(resolved)),
  )
  const identityData = workflowIdentityData(userId, oktaUserId)

  const run = await store.createRun({
    id: runId,
    workflowId: input.workflow.id,
    workflowVersion: input.workflow.manifest_version,
    workflowInstanceId: null,
    userId: input.workflow.user_id,
    triggerKind: input.trigger.kind,
    triggerNodeId: input.trigger.nodeId ?? null,
    input: { trigger: input.trigger, ...identityData },
    status: "queued",
    startedAt: now,
    updatedAt: now,
  })

  await store.addRunEvent({
    id: `wfe_${generateId(12)}`,
    workflowId: input.workflow.id,
    runId,
    eventType: "run_queued",
    message: "Workflow run queued",
    data: {
      trigger: redactWorkflowTriggerForEvent(input.trigger),
      ...identityData,
    },
    createdAt: now,
  })

  async function finalizeInstanceCreation(): Promise<WorkflowRunRecord> {
    input.log?.info("workflowDynamicInstanceCreateStarted", {
      workflowId: input.workflow.id,
      runId,
      workflowVersion: run.workflow_version,
      workflowInstanceId: instanceId,
      triggerKind: input.trigger.kind,
      triggerNodeId: input.trigger.nodeId ?? null,
      hasOktaUserId: Boolean(oktaUserId),
      metadataHasCodeKey: true,
    })
    const workflowBinding = await getWrappedWorkflowBinding(input.workflow, run.workflow_version)
    const instance = await workflowBinding.create({
      id: instanceId,
      params: {
        workflowId: input.workflow.id,
        runId,
        trigger: input.trigger,
        userId,
        oktaUserId,
      },
    })

    const workflowInstanceId = await instance.id

    await store.updateRunInstance({
      runId,
      workflowInstanceId,
      status: "running",
      updatedAt: Date.now(),
    })
    const updatedRun = await store.getRun(input.workflow.id, runId)
    const nextRun = Option.getOrElse(Option.fromNullishOr(updatedRun), () => run)
    input.log?.info("workflowDynamicInstanceCreateCompleted", {
      workflowId: input.workflow.id,
      runId,
      workflowVersion: nextRun.workflow_version,
      workflowInstanceId,
      triggerKind: input.trigger.kind,
      triggerNodeId: input.trigger.nodeId ?? null,
    })
    return nextRun
  }

  async function failInstanceCreation(error: unknown): Promise<never> {
    const normalizedError = errorFromUnknown(error)
    const message = normalizedError.message
    const completedAt = Date.now()
    input.log?.error(normalizedError, {
      event: "workflowDynamicInstanceCreateFailed",
      workflowId: input.workflow.id,
      runId,
      workflowVersion: run.workflow_version,
      workflowInstanceId: instanceId,
      triggerKind: input.trigger.kind,
      triggerNodeId: input.trigger.nodeId ?? null,
    })
    await store.addRunEvent({
      id: `wfe_${generateId(12)}`,
      workflowId: input.workflow.id,
      runId,
      eventType: "run_failed",
      level: "error",
      message,
      data: { error: message, ...identityData },
      createdAt: completedAt,
    })
    await store.completeRun({
      workflowId: input.workflow.id,
      runId,
      status: "failed",
      error: message,
      completedAt,
    })
    throw error
  }

  return finalizeInstanceCreation().catch((error: unknown) => failInstanceCreation(error))
}
