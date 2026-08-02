import * as Effect from "effect/Effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Env } from "../../packages/api/src/server/background/types"
import {
  executeWorkflowNotificationNode,
  isWorkflowNotificationNodeType,
  type WorkflowNotificationNodeExecutionInput,
} from "../../packages/api/src/server/background/workflows/nodes/notification"

function createEnv(): Env {
  return {} as Env
}

function createInput(
  input: Partial<WorkflowNotificationNodeExecutionInput> & {
    node: WorkflowNotificationNodeExecutionInput["node"]
  },
): WorkflowNotificationNodeExecutionInput {
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

describe("workflow notification node adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it("identifies notification Workflow Node types", () => {
    expect(isWorkflowNotificationNodeType("slack-notification")).toBe(false)
    expect(isWorkflowNotificationNodeType("email-notification")).toBe(true)
    expect(isWorkflowNotificationNodeType("http-request")).toBe(false)
  })

  it("fails email notifications as coming soon without calling an email provider", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      Effect.runPromise(
        executeWorkflowNotificationNode(
          createInput({
            node: {
              id: "email",
              type: "email-notification",
              label: "Email",
              options: {
                to: "ops@example.com",
                from: "c0@example.com",
                subject: "Run {{runId}}",
                body: "Done",
              },
            },
          }),
        ),
      ),
    ).rejects.toThrow("Email notifications are coming soon.")

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects unsupported notification Workflow Node types", async () => {
    await expect(
      Effect.runPromise(
        executeWorkflowNotificationNode(
          createInput({
            node: {
              id: "unknown",
              type: "http-request",
              label: "HTTP",
              options: {},
            },
          }),
        ),
      ),
    ).rejects.toThrow("Unsupported workflow notification node 'http-request'")
  })
})
