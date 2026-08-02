import { describe, expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import { WORKFLOW_MANIFEST_VERSION, type WorkflowManifest } from "../../packages/shared/src"
import type {
  CreateWorkflowInput,
  UpdateWorkflowInput,
  WorkflowRecord,
  WorkflowRunRecord,
} from "../../packages/api/src/server/background/db/workflows"
import type { Env } from "../../packages/api/src/server/background/types"
import {
  WorkflowLifecycle,
  type WorkflowLifecycleAdapters,
  WorkflowRetryTriggerError,
} from "../../packages/api/src/server/background/workflows/lifecycle"

const manifest: WorkflowManifest = {
  version: WORKFLOW_MANIFEST_VERSION,
  name: "Daily check",
  nodes: [
    {
      id: "manual",
      type: "manual-trigger",
      label: "Manual",
      position: { x: 0, y: 0 },
      options: {},
    },
  ],
  edges: [],
}

const previousManifest: WorkflowManifest = {
  ...manifest,
  nodes: [
    {
      id: "schedule",
      type: "datetime-trigger",
      label: "Date Time",
      position: { x: 0, y: 0 },
      options: { scheduledAt: "2026-05-14T00:00:00.000Z" },
    },
  ],
}

function workflowRecord(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    id: "wf_1",
    user_id: "user_1",
    name: "Daily check",
    status: "active",
    manifest_version: 1,
    manifest_key: "user_1/workflows/wf_1/v1/manifest.json",
    code_key: "user_1/workflows/wf_1/v1/workflow.js",
    webhook_id: "wh_1",
    created_at: 1,
    updated_at: 1,
    ...overrides,
  }
}

function runRecord(overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    id: "wfr_1",
    workflow_id: "wf_1",
    workflow_version: 1,
    workflow_instance_id: "wf_wfr_1",
    user_id: "user_1",
    trigger_kind: "manual",
    trigger_node_id: null,
    status: "failed",
    input_json: JSON.stringify({ trigger: { kind: "manual", payload: { retry: true } } }),
    output_json: null,
    error: "boom",
    started_at: 1,
    completed_at: 2,
    updated_at: 2,
    ...overrides,
  }
}

function createStore() {
  return {
    createWorkflow: vi.fn(async (input: CreateWorkflowInput) =>
      workflowRecord({
        id: input.id,
        user_id: input.userId,
        name: input.name,
        status: input.status,
        manifest_version: input.manifestVersion,
        manifest_key: input.manifestKey,
        code_key: input.codeKey,
        webhook_id: input.webhookId,
        created_at: input.createdAt,
        updated_at: input.updatedAt,
      }),
    ),
    updateWorkflow: vi.fn(async (input: UpdateWorkflowInput) =>
      workflowRecord({
        id: input.id,
        user_id: input.userId,
        name: input.name,
        status: input.status,
        manifest_version: input.manifestVersion,
        manifest_key: input.manifestKey,
        code_key: input.codeKey,
        updated_at: input.updatedAt,
      }),
    ),
    disableWorkflow: vi.fn(async () => true),
    enableWorkflow: vi.fn(async () => true),
    archiveWorkflow: vi.fn(async () => true),
    unarchiveWorkflow: vi.fn(async () => true),
    getWorkflow: vi.fn(async () => workflowRecord()),
    getRun: vi.fn(async () => runRecord()),
  }
}

function createLifecycle(
  options: {
    store?: ReturnType<typeof createStore>
    readManifest?: WorkflowLifecycleAdapters["readManifest"]
    startRun?: WorkflowLifecycleAdapters["startRun"]
  } = {},
) {
  const store = options.store ?? createStore()
  const ids = ["workflowid", "webhookid"]
  const adapters: WorkflowLifecycleAdapters = {
    store,
    now: () => 1_000,
    generateId: vi.fn(() => ids.shift() ?? "id"),
    normalizeManifest: vi.fn(() => manifest),
    compileWorkflow: vi.fn(() => "compiled workflow"),
    writeArtifacts: vi.fn(() =>
      Effect.succeed({
        manifestKey: "user_1/workflows/wf_workflowid/v1/manifest.json",
        codeKey: "user_1/workflows/wf_workflowid/v1/workflow.js",
      }),
    ),
    readManifest: options.readManifest ?? vi.fn(() => Effect.succeed(previousManifest)),
    scheduleDateTriggers: vi.fn(() => Effect.void),
    cancelDateTriggers: vi.fn(() => Effect.void),
    registerSlackTriggers: vi.fn(() => Effect.succeed([])),
    disableSlackTriggers: vi.fn(() => Effect.void),
    startRun: options.startRun ?? vi.fn(async () => runRecord({ id: "wfr_next" })),
    resolveOktaUserId: vi.fn(() => Effect.succeed("okta_1")),
  }

  return {
    lifecycle: new WorkflowLifecycle({ DB: {} as D1Database } as Env, adapters),
    store,
    adapters,
  }
}

describe("WorkflowLifecycle", () => {
  it("creates a workflow version, writes artifacts, stores the row, and schedules triggers", async () => {
    const { lifecycle, store, adapters } = createLifecycle()

    const result = await Effect.runPromise(
      lifecycle.createWorkflow({
        name: "Daily check",
        manifest: { name: "Daily check" },
        userId: "user_1",
      }),
    )

    expect(adapters.normalizeManifest).toHaveBeenCalledWith(
      { name: "Daily check", version: WORKFLOW_MANIFEST_VERSION },
      "Daily check",
    )
    expect(adapters.compileWorkflow).toHaveBeenCalledWith(manifest)
    expect(adapters.writeArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest,
        code: "compiled workflow",
        userId: "user_1",
        workflowId: "wf_workflowid",
        version: 1,
      }),
    )
    expect(store.createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "wf_workflowid",
        userId: "user_1",
        name: "Daily check",
        manifestVersion: 1,
        webhookId: "wh_webhookid",
      }),
    )
    expect(adapters.scheduleDateTriggers).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf_workflowid",
        userId: "user_1",
        nodes: manifest.nodes,
      }),
    )
    expect(result.workflow.id).toBe("wf_workflowid")
  })

  it("updates a workflow version and replaces its schedules", async () => {
    const { lifecycle, store, adapters } = createLifecycle()

    await Effect.runPromise(
      lifecycle.updateWorkflow({
        workflow: workflowRecord({ manifest_version: 2 }),
        name: "Updated",
        manifest: { name: "Updated" },
      }),
    )

    expect(adapters.readManifest).toHaveBeenCalledWith(
      expect.anything(),
      "user_1/workflows/wf_1/v1/manifest.json",
    )
    expect(store.updateWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "wf_1",
        userId: "user_1",
        manifestVersion: 3,
      }),
    )
    expect(adapters.cancelDateTriggers).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf_1",
        nodes: previousManifest.nodes,
      }),
    )
    expect(adapters.scheduleDateTriggers).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf_1",
        nodes: manifest.nodes,
      }),
    )
  })

  it("stores workflow display name independently from the manifest name", async () => {
    const { lifecycle, store, adapters } = createLifecycle()
    const inputManifest = {
      version: WORKFLOW_MANIFEST_VERSION,
      name: "Runtime manifest",
    }

    await Effect.runPromise(
      lifecycle.updateWorkflow({
        workflow: workflowRecord({ manifest_version: 2 }),
        name: "Display title",
        manifest: inputManifest,
      }),
    )

    expect(adapters.normalizeManifest).toHaveBeenCalledWith(inputManifest, "Runtime manifest")
    expect(store.updateWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "wf_1",
        userId: "user_1",
        name: "Display title",
      }),
    )
  })

  it("updates a workflow when the previous manifest artifact is missing", async () => {
    const workflow = workflowRecord({ manifest_version: 2 })
    const readManifest = vi.fn((_env: Env, manifestKey: string) =>
      Effect.fail(new Error(`Workflow manifest artifact '${manifestKey}' was not found`)),
    )
    const { lifecycle, store, adapters } = createLifecycle({ readManifest })

    await Effect.runPromise(
      lifecycle.updateWorkflow({
        workflow,
        name: "Updated",
        manifest: { name: "Updated" },
      }),
    )

    expect(store.updateWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "wf_1",
        manifestVersion: 3,
      }),
    )
    expect(adapters.cancelDateTriggers).not.toHaveBeenCalled()
    expect(adapters.scheduleDateTriggers).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf_1",
        nodes: manifest.nodes,
      }),
    )
  })

  it("does not hide previous manifest read failures", async () => {
    const readManifest = vi.fn(() => Effect.fail(new Error("R2 unavailable")))
    const { lifecycle, store, adapters } = createLifecycle({ readManifest })

    await expect(
      Effect.runPromise(
        lifecycle.updateWorkflow({
          workflow: workflowRecord({ manifest_version: 2 }),
          name: "Updated",
          manifest: { name: "Updated" },
        }),
      ),
    ).rejects.toThrow("R2 unavailable")

    expect(store.updateWorkflow).not.toHaveBeenCalled()
    expect(adapters.writeArtifacts).not.toHaveBeenCalled()
  })

  it("does not reschedule triggers when updating a disabled workflow", async () => {
    const { lifecycle, adapters } = createLifecycle()

    await Effect.runPromise(
      lifecycle.updateWorkflow({
        workflow: workflowRecord({ status: "disabled", manifest_version: 2 }),
        name: "Updated",
        manifest: { name: "Updated" },
      }),
    )

    expect(adapters.cancelDateTriggers).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf_1",
        nodes: previousManifest.nodes,
      }),
    )
    expect(adapters.scheduleDateTriggers).not.toHaveBeenCalled()
  })

  it("archives and unarchives workflows through the same lifecycle seam", async () => {
    const { lifecycle, store, adapters } = createLifecycle()

    await Effect.runPromise(lifecycle.archiveWorkflow({ workflow: workflowRecord() }))
    await Effect.runPromise(lifecycle.unarchiveWorkflow({ workflow: workflowRecord() }))

    expect(adapters.cancelDateTriggers).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf_1",
        nodes: previousManifest.nodes,
      }),
    )
    expect(store.archiveWorkflow).toHaveBeenCalledWith("wf_1", "user_1", 1_000)
    expect(store.unarchiveWorkflow).toHaveBeenCalledWith("wf_1", "user_1", 1_000)
    expect(adapters.scheduleDateTriggers).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf_1",
        userId: "user_1",
        nodes: previousManifest.nodes,
      }),
    )
  })

  it("disables and enables workflows while managing schedules", async () => {
    const { lifecycle, store, adapters } = createLifecycle()

    const disabled = await Effect.runPromise(
      lifecycle.disableWorkflow({ workflow: workflowRecord() }),
    )
    const enabled = await Effect.runPromise(
      lifecycle.enableWorkflow({
        workflow: workflowRecord({ status: "disabled" }),
      }),
    )

    expect(disabled.status).toBe("disabled")
    expect(enabled.status).toBe("active")
    expect(adapters.cancelDateTriggers).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf_1",
        nodes: previousManifest.nodes,
      }),
    )
    expect(store.disableWorkflow).toHaveBeenCalledWith("wf_1", "user_1", 1_000)
    expect(store.enableWorkflow).toHaveBeenCalledWith("wf_1", "user_1", 1_000)
    expect(adapters.scheduleDateTriggers).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf_1",
        userId: "user_1",
        nodes: previousManifest.nodes,
      }),
    )
  })

  it("retries a workflow run from the original trigger", async () => {
    const { lifecycle, store, adapters } = createLifecycle()

    await Effect.runPromise(lifecycle.retryWorkflowRun({ workflowId: "wf_1", runId: "wfr_1" }))

    expect(store.getWorkflow).toHaveBeenCalledWith("wf_1")
    expect(store.getRun).toHaveBeenCalledWith("wf_1", "wfr_1")
    expect(adapters.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: expect.objectContaining({ id: "wf_1" }),
        trigger: {
          kind: "manual",
          payload: { retry: true },
          nodeId: null,
          cron: null,
          scheduledAt: null,
          firedAt: null,
        },
        userId: "user_1",
        oktaUserId: "okta_1",
      }),
    )
  })

  it("rejects retry when the previous run has no reusable trigger", async () => {
    const store = createStore()
    store.getRun.mockResolvedValue(runRecord({ input_json: "{}" }))
    const startRun = vi.fn(async () => runRecord())
    const { lifecycle } = createLifecycle({ store, startRun })

    await expect(
      Effect.runPromise(lifecycle.retryWorkflowRun({ workflowId: "wf_1", runId: "wfr_1" })),
    ).rejects.toBeInstanceOf(WorkflowRetryTriggerError)
    expect(startRun).not.toHaveBeenCalled()
  })
})
