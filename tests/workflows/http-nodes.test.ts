import * as Effect from "effect/Effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Env } from "../../packages/api/src/server/background/types"
import {
  executeWorkflowHttpNode,
  isWorkflowHttpNodeType,
  type WorkflowHttpNodeExecutionInput,
} from "../../packages/api/src/server/background/workflows/nodes/http"

function createEnv(): Env {
  return {} as Env
}

function createInput(
  input: Partial<WorkflowHttpNodeExecutionInput> & {
    node: WorkflowHttpNodeExecutionInput["node"]
  },
): WorkflowHttpNodeExecutionInput {
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

describe("workflow HTTP node adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it("identifies HTTP Workflow Node types", () => {
    expect(isWorkflowHttpNodeType("http-request")).toBe(true)
    expect(isWorkflowHttpNodeType("slack-notification")).toBe(false)
  })

  it("runs HTTP request nodes with templated options", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { accepted: true },
        {
          status: 202,
          headers: { "x-result": "ok" },
        },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await Effect.runPromise(
      executeWorkflowHttpNode(
        createInput({
          node: {
            id: "request",
            type: "http-request",
            label: "Request",
            options: {
              method: "POST",
              url: "https://example.com/{{inputs.path}}",
              headers: { "x-run": "{{runId}}" },
              body: "hello {{inputs.name}}",
              responseType: "json",
            },
          },
          inputs: { path: "api", name: "Ada" },
        }),
      ),
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({
        method: "POST",
        headers: { "x-run": "run_1" },
        body: "hello Ada",
      }),
    )
    expect(result).toMatchObject({
      outputs: {
        ok: true,
        status: 202,
        body: { accepted: true },
        json: { accepted: true },
        headers: { "content-type": "application/json", "x-result": "ok" },
      },
    })
  })

  it("renders JSON request body templates from connected inputs", async () => {
    const fetchMock = vi.fn(async () => Response.json({ accepted: true }, { status: 202 }))
    vi.stubGlobal("fetch", fetchMock)
    const sessionOutput = 'hello "Ada"\nline two'

    await Effect.runPromise(
      executeWorkflowHttpNode(
        createInput({
          node: {
            id: "request",
            type: "http-request",
            label: "Add note",
            options: {
              method: "POST",
              url: "https://api.opsgenie.com/v2/alerts/{{inputs.alert.alertId}}/notes",
              headers: { "Content-Type": "application/json" },
              body: '{ "note": "{{inputs.note}}" }',
            },
          },
          inputs: {
            alert: { alertId: "alert-1" },
            body: "raw edge value should not bypass configured body",
            note: sessionOutput,
          },
        }),
      ),
    )

    const [, requestInit] = fetchMock.mock.calls[0]

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.opsgenie.com/v2/alerts/alert-1/notes",
      expect.objectContaining({
        method: "POST",
      }),
    )
    expect(JSON.parse(String(requestInit?.body))).toEqual({ note: sessionOutput })
    expect(String(requestInit?.body)).toContain("\\n")
    expect(requestInit?.body).not.toBe(sessionOutput)
  })

  it("fails HTTP request nodes on error statuses when configured", async () => {
    const fetchMock = vi.fn(async () => new Response("Method Not Allowed", { status: 405 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      Effect.runPromise(
        executeWorkflowHttpNode(
          createInput({
            node: {
              id: "request",
              type: "http-request",
              label: "Add OpsGenie note",
              options: {
                method: "POST",
                url: "https://api.opsgenie.com/v2/alerts/{{inputs.alertId}}/notes?identifierType=alias",
                headers: { Authorization: "GenieKey secret", "Content-Type": "application/json" },
                body: '{ "note": "{{inputs.note}}" }',
                failOnHttpError: true,
              },
            },
            inputs: { alertId: "alert-1", note: "hello" },
          }),
        ),
      ),
    ).rejects.toThrow("HTTP request failed with status 405")

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.opsgenie.com/v2/alerts/alert-1/notes?identifierType=alias",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "GenieKey secret",
          "Content-Type": "application/json",
        },
        body: '{ "note": "hello" }',
      }),
    )
  })

  it("passes timeout signals and records pre-response failures", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError")
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      throw abortError
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      Effect.runPromise(
        executeWorkflowHttpNode(
          createInput({
            node: {
              id: "request",
              type: "http-request",
              label: "Request",
              options: {
                method: "GET",
                url: "https://example.com/slow",
                timeoutMs: 250,
              },
            },
          }),
        ),
      ),
    ).rejects.toThrow("The operation was aborted")
  })
})
