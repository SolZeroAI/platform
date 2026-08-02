import { describe, expect, it, vi } from "vitest"
import type { WorkflowRecord } from "../../packages/api/src/server/background/db/workflows"
import {
  getTerminalWorkflowRunUpdate,
  getWorkflowBindingMetadata,
  getWorkflowCodeKeyForVersion,
  getWorkflowLoaderCacheKey,
  resolveWorkflowActionsBinding,
  resolveWorkflowCodeKey,
  type WorkflowActionsEntrypoint,
} from "../../packages/api/src/server/background/workflows/runner"
import { getWorkflowRuntimeLoaderCacheVersion } from "../../packages/api/src/server/background/workflows/runtime-abi"

function workflowRecord(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    id: "wf_1",
    user_id: "user_1",
    name: "Workflow",
    status: "active",
    manifest_version: 3,
    manifest_key: "user_1/workflows/wf_1/v3/manifest.json",
    code_key: "user_1/workflows/wf_1/v3/workflow.js",
    webhook_id: "wh_1",
    created_at: 1,
    updated_at: 2,
    ...overrides,
  }
}

function workflowActionsBinding(): WorkflowActionsEntrypoint {
  return {
    executeWorkflowNode: async () => ({}),
    recordWorkflowEvent: async () => ({ ok: true }),
    completeWorkflowRun: async () => ({ ok: true }),
  }
}

function executionContext(extra: Record<string, unknown> = {}): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
    ...extra,
  } as ExecutionContext
}

describe("getTerminalWorkflowRunUpdate", () => {
  it("maps complete workflow instance status to a completed run update", () => {
    expect(
      getTerminalWorkflowRunUpdate({
        status: "complete",
        output: { outputs: { ok: true } },
      }),
    ).toEqual({
      status: "completed",
      output: { outputs: { ok: true } },
      error: null,
    })
  })

  it("maps errored workflow instance status to a failed run update", () => {
    expect(
      getTerminalWorkflowRunUpdate({
        status: "errored",
        error: {
          name: "Error",
          message: "Worker failed before workflow code ran",
        },
      }),
    ).toEqual({
      status: "failed",
      output: null,
      error: "Worker failed before workflow code ran",
    })
  })

  it("keeps active workflow instance statuses active", () => {
    expect(getTerminalWorkflowRunUpdate({ status: "running" })).toBeNull()
    expect(getTerminalWorkflowRunUpdate({ status: "waiting" })).toBeNull()
  })
})

describe("getWorkflowCodeKeyForVersion", () => {
  it("uses deterministic artifact keys for previous workflow versions", () => {
    expect(getWorkflowCodeKeyForVersion(workflowRecord(), 2)).toBe(
      "user_1/workflows/wf_1/v2/workflow.js",
    )
  })

  it("keeps the current workflow row code key for the latest version", () => {
    expect(
      getWorkflowCodeKeyForVersion(
        workflowRecord({
          code_key: "custom/latest/workflow.js",
        }),
        3,
      ),
    ).toBe("custom/latest/workflow.js")
  })

  it("rejects future workflow versions", () => {
    expect(() => getWorkflowCodeKeyForVersion(workflowRecord(), 4)).toThrow(
      "Workflow 'wf_1' version 4 is not available",
    )
  })
})

describe("getWorkflowBindingMetadata", () => {
  it("binds dynamic workflow runners to an explicit workflow version and code artifact", () => {
    expect(getWorkflowBindingMetadata(workflowRecord(), 2)).toEqual({
      workflowId: "wf_1",
      version: 2,
      userId: "user_1",
      codeKey: "user_1/workflows/wf_1/v2/workflow.js",
    })
  })
})

describe("resolveWorkflowCodeKey", () => {
  it("uses immutable metadata code keys without requiring the workflow row", () => {
    expect(
      resolveWorkflowCodeKey({
        workflow: null,
        workflowId: "wf_1",
        version: 3,
        metadataCodeKey: "user_1/workflows/wf_1/v3/workflow.js",
      }),
    ).toEqual({
      codeKey: "user_1/workflows/wf_1/v3/workflow.js",
      source: "metadata",
    })
  })

  it("falls back to the workflow row for old metadata", () => {
    expect(
      resolveWorkflowCodeKey({
        workflow: workflowRecord(),
        workflowId: "wf_1",
        version: 2,
      }),
    ).toEqual({
      codeKey: "user_1/workflows/wf_1/v2/workflow.js",
      source: "workflow-row",
    })
  })
})

describe("getWorkflowLoaderCacheKey", () => {
  it("includes the runtime ABI and kernel source cache version", () => {
    expect(getWorkflowLoaderCacheKey({ workflowId: "wf_1", version: 2 })).toBe(
      `wf_1:v2:${getWorkflowRuntimeLoaderCacheVersion()}`,
    )
  })
})

describe("resolveWorkflowActionsBinding", () => {
  it("prefers the current worker loopback entrypoint for dynamic workers", () => {
    const fallback = workflowActionsBinding()
    const loopback = workflowActionsBinding()
    const WorkflowActions = vi.fn(() => loopback)

    expect(
      resolveWorkflowActionsBinding({
        env: { WORKFLOW_ACTIONS: fallback } as never,
        ctx: executionContext({
          exports: {
            WorkflowActions,
          },
        }),
      }),
    ).toBe(loopback)
    expect(WorkflowActions).toHaveBeenCalledWith({ props: {} })
  })

  it("falls back to the configured service binding when loopback exports are unavailable", () => {
    const fallback = workflowActionsBinding()

    expect(
      resolveWorkflowActionsBinding({
        env: { WORKFLOW_ACTIONS: fallback } as never,
        ctx: executionContext(),
      }),
    ).toBe(fallback)
  })
})
