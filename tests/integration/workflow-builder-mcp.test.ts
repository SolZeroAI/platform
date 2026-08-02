import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { describe, expect, it, vi } from "vitest"
import { WORKFLOW_TEMPLATES } from "../../packages/shared/src"
import type { Env } from "../../packages/api/src/server/background/types"
import { createWorkflowBuilderMcpServer } from "../../packages/api/src/server/mcp/workflow-builder/server"
import {
  getWorkflowBuilderDraftKey,
  readLatestWorkflowBuilderDraft,
} from "../../packages/api/src/server/mcp/workflow-builder/runtime"

interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number | string | null
  method: string
  params?: Record<string, unknown>
}

interface TestProtocolServer {
  _requestHandlers: Map<string, (request: JsonRpcRequest) => unknown | Promise<unknown>>
}

interface TestMcpServer {
  server: TestProtocolServer
}

const DEFAULT_MCP_PROTOCOL_VERSION = "2025-03-26"

async function invokeServerRequest(
  server: TestMcpServer,
  request: JsonRpcRequest,
): Promise<unknown> {
  const handler = server.server._requestHandlers.get(request.method)
  if (!handler) {
    throw new Error(`Missing MCP request handler for '${request.method}'`)
  }

  return handler(request)
}

function createEnv() {
  const values = new Map<string, string>()
  const put = vi.fn(async (key: string, value: string) => {
    values.set(key, value)
  })
  const get = vi.fn(async (key: string) => values.get(key) ?? null)
  const env = {
    REPOS_CACHE: {
      put,
      get,
    },
  } as unknown as Env

  return { env, put, get, values }
}

describe("workflow builder MCP server", () => {
  it("serves catalog, validates manifests, and stores submitted drafts", async () => {
    const { env, put } = createEnv()
    const context = {
      env,
      sessionId: "session-builder",
      userId: "user_1",
    }
    const server = createWorkflowBuilderMcpServer(context) as unknown as TestMcpServer

    const initialize = await invokeServerRequest(server, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: DEFAULT_MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "vitest",
          version: "1.0.0",
        },
      },
    })

    expect(initialize).toMatchObject({
      serverInfo: expect.objectContaining({
        name: "c0-workflow-builder",
      }),
    })

    const listedTools = await invokeServerRequest(server, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    })

    expect(listedTools).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "get_workflow_node_catalog" }),
        expect.objectContaining({ name: "validate_workflow_manifest" }),
        expect.objectContaining({ name: "submit_workflow_draft" }),
      ]),
    })

    const manifest = WORKFLOW_TEMPLATES[0].manifest
    const validation = (await invokeServerRequest(server, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "validate_workflow_manifest",
        arguments: { manifest },
      },
    })) as { content?: Array<{ text?: string }> }

    expect(validation.content?.[0]?.text).toContain('"valid": true')

    const submit = (await invokeServerRequest(server, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "submit_workflow_draft",
        arguments: { manifest },
      },
    })) as { content?: Array<{ text?: string }> }

    expect(submit.content?.[0]?.text).toContain('"ok": true')
    expect(put).toHaveBeenCalledWith(
      getWorkflowBuilderDraftKey(context),
      expect.stringContaining('"sessionId":"session-builder"'),
      { expirationTtl: 86400 },
    )
    const draft = await Effect.runPromise(readLatestWorkflowBuilderDraft(context))
    Option.match(draft, {
      onNone: () => expect.fail("expected workflow builder draft"),
      onSome: (value) =>
        expect(value).toMatchObject({
          sessionId: "session-builder",
          userId: "user_1",
          manifest,
        }),
    })
  })
})
