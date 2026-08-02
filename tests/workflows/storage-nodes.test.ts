import * as Effect from "effect/Effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Env } from "../../packages/api/src/server/background/types"
import {
  executeWorkflowStorageNode,
  isWorkflowStorageNodeType,
  type WorkflowStorageNodeExecutionInput,
} from "../../packages/api/src/server/background/workflows/nodes/storage"

function createEnv(
  options: {
    workflowBucket?: Partial<Pick<R2Bucket, "get" | "put">>
    kvNamespace?: Partial<Pick<KVNamespace, "get" | "put">>
  } = {},
): Env {
  const workflowBucket = {
    get: vi.fn(),
    put: vi.fn(),
    ...options.workflowBucket,
  }
  const kvNamespace = {
    get: vi.fn(),
    put: vi.fn(),
    ...options.kvNamespace,
  }
  return {
    WORKFLOW_BUCKET: workflowBucket,
    AI_SEARCH_CONTENT_BUCKET: workflowBucket,
    USER_WORKFLOW_KV: kvNamespace,
    REPOS_CACHE: kvNamespace,
  } as unknown as Env
}

function createInput(
  input: Partial<WorkflowStorageNodeExecutionInput> & {
    node: WorkflowStorageNodeExecutionInput["node"]
  },
): WorkflowStorageNodeExecutionInput {
  return {
    env: createEnv(),
    workflowId: "wf_1",
    runId: "run_1",
    inputs: {},
    trigger: { kind: "manual", payload: {} },
    userId: "user_1",
    ...input,
  }
}

describe("workflow storage node adapter", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("identifies storage Workflow Node types", () => {
    expect(isWorkflowStorageNodeType("r2-put-object")).toBe(true)
    expect(isWorkflowStorageNodeType("kv-get")).toBe(true)
    expect(isWorkflowStorageNodeType("http-request")).toBe(false)
  })

  it("writes R2 objects with rendered user-prefixed keys", async () => {
    const put = vi.fn(async () => ({ etag: "etag-1" }))
    const result = await Effect.runPromise(
      executeWorkflowStorageNode(
        createInput({
          env: createEnv({ workflowBucket: { put } as Pick<R2Bucket, "put"> }),
          node: {
            id: "save",
            type: "r2-put-object",
            label: "Save",
            options: { key: "runs/{{runId}}/{{nodeId}}.json" },
          },
          inputs: { content: { ok: true } },
        }),
      ),
    )

    expect(put).toHaveBeenCalledWith("user_1/runs/run_1/save.json", '{\n  "ok": true\n}', {
      httpMetadata: { contentType: "application/json" },
    })
    expect(result).toEqual({
      outputs: {
        bucket: "WORKFLOW_BUCKET",
        key: "runs/run_1/save.json",
        etag: "etag-1",
        contentType: "application/json",
      },
    })
  })

  it("decodes base64 R2 content before writing", async () => {
    const put = vi.fn(async () => ({ etag: "etag-image" }))
    const result = await Effect.runPromise(
      executeWorkflowStorageNode(
        createInput({
          env: createEnv({ workflowBucket: { put } as Pick<R2Bucket, "put"> }),
          manifestVersion: 2,
          node: {
            id: "save-image",
            type: "r2-put-object",
            label: "Save image",
            options: {
              key: "runs/{{runId}}/{{nodeId}}.png",
              contentType: "image/png",
              encoding: "base64",
            },
          },
          inputs: { content: "data:image/png;base64,iVBORw==" },
        }),
      ),
    )

    expect(put).toHaveBeenCalledWith("user_1/runs/run_1/save-image.png", expect.any(Uint8Array), {
      httpMetadata: { contentType: "image/png" },
    })
    const body = put.mock.calls[0]?.[1] as Uint8Array
    expect(Array.from(body)).toEqual([137, 80, 78, 71])
    expect(result).toEqual({
      outputs: {
        bucket: "WORKFLOW_BUCKET",
        key: "runs/run_1/save-image.png",
        etag: "etag-image",
        contentType: "image/png",
      },
    })
  })

  it("keeps pre-v2 R2 content encoding options as text writes", async () => {
    const put = vi.fn(async () => ({ etag: "etag-text" }))
    const result = await Effect.runPromise(
      executeWorkflowStorageNode(
        createInput({
          env: createEnv({ workflowBucket: { put } as Pick<R2Bucket, "put"> }),
          manifestVersion: 1,
          node: {
            id: "save-image",
            type: "r2-put-object",
            label: "Save image",
            options: {
              key: "runs/{{runId}}/{{nodeId}}.png",
              contentType: "image/png",
              encoding: "base64",
            },
          },
          inputs: { content: "iVBORw==" },
        }),
      ),
    )

    expect(put).toHaveBeenCalledWith("user_1/runs/run_1/save-image.png", "iVBORw==", {
      httpMetadata: { contentType: "image/png" },
    })
    expect(result).toEqual({
      outputs: {
        bucket: "WORKFLOW_BUCKET",
        key: "runs/run_1/save-image.png",
        etag: "etag-text",
        contentType: "image/png",
      },
    })
  })

  it("reads KV values and parses JSON through the storage adapter interface", async () => {
    const get = vi.fn(async () => '{"ok":true}')
    const result = await Effect.runPromise(
      executeWorkflowStorageNode(
        createInput({
          env: createEnv({ kvNamespace: { get } as Pick<KVNamespace, "get"> }),
          node: {
            id: "load",
            type: "kv-get",
            label: "Load",
            options: { key: "runs/{{runId}}/value.json" },
          },
        }),
      ),
    )

    expect(get).toHaveBeenCalledWith("user_1/runs/run_1/value.json")
    expect(result).toEqual({
      outputs: {
        found: true,
        namespace: "USER_WORKFLOW_KV",
        key: "runs/run_1/value.json",
        value: { ok: true },
        json: { ok: true },
        text: '{"ok":true}',
      },
    })
  })

  it("keeps storage identity required inside the adapter", async () => {
    await expect(
      Effect.runPromise(
        executeWorkflowStorageNode(
          createInput({
            node: {
              id: "load",
              type: "kv-get",
              label: "Load",
              options: { key: "value" },
            },
            userId: "",
          }),
        ),
      ),
    ).rejects.toThrow("Workflow action userId is required")
  })
})
