import * as Effect from "effect/Effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AI_SEARCH_SESSION_HEADER,
  AI_SEARCH_SOURCE_HEADER,
} from "../../packages/api/src/server/background/session/mcp-config"
import type {
  AiSearchAiSearchResponse,
  AiSearchSearchResponse,
  Env,
} from "../../packages/api/src/server/background/types"
import { exportAiSearchConfig } from "../../packages/api/src/server/background/ai-search/admin-actions"
import {
  AiSearchRegistryStore,
  type AiSearchSourceRecord,
} from "../../packages/api/src/server/background/db/ai-search"
import { S0_CONFIG_KEYS } from "../../packages/api/src/server/background/db/s0-config"
import {
  createAiSearchMcpServer,
  resolveAllowedAiSearchSources,
} from "../../packages/api/src/server/mcp/ai-search-server"
import { runAiSearchMcpTool } from "../../packages/api/src/server/mcp/ai-search-runtime"

interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number | string | null
  method: string
  params?: Record<string, unknown>
}

interface TestProtocolServer {
  _requestHandlers: Map<
    string,
    (
      request: JsonRpcRequest,
      extra?: {
        requestInfo?: {
          headers: Record<string, string>
          url: URL
        }
      },
    ) => unknown | Promise<unknown>
  >
}

interface TestMcpServer {
  server: TestProtocolServer
}

const PRODUCT_DOCS_SOURCE: AiSearchSourceRecord = {
  id: "product-docs",
  label: "Product Docs",
  description: "Product documentation",
  enabled: true,
  maxResults: 7,
  dataSource: {
    type: "r2",
    bucketName: "product-docs",
    prefix: null,
    r2Jurisdiction: null,
  },
  createdAt: 1,
  updatedAt: 1,
}

const DISABLED_SOURCE: AiSearchSourceRecord = {
  ...PRODUCT_DOCS_SOURCE,
  id: "disabled-docs",
  label: "Disabled Docs",
  enabled: false,
}

const SAMPLE_AI_SEARCH_RESPONSE: AiSearchAiSearchResponse = {
  response: "Product setup uses the canonical installation flow.",
  data: [
    {
      filename: "kb/product/setup.md",
      score: 0.91,
      content: [
        {
          type: "text",
          text: "Use the canonical setup runbook for installation.",
        },
      ],
    },
  ],
}

const SAMPLE_SEARCH_RESPONSE: AiSearchSearchResponse = {
  data: [
    {
      filename: "kb/product/setup.md",
      score: 0.88,
      content: [
        {
          type: "text",
          text: "Product operators use setup runbooks for installation investigations.",
        },
      ],
    },
  ],
}

const DEFAULT_MCP_PROTOCOL_VERSION = "2025-03-26"

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  const record: Record<string, string> = {}
  new Headers(headers ?? {}).forEach((value, key) => {
    record[key] = value
  })
  return record
}

function createTestEnv(options?: {
  aiSearchResponse?: AiSearchAiSearchResponse
  searchResponse?: AiSearchSearchResponse
  searchReject?: Error
  sources?: AiSearchSourceRecord[]
  kvListPageSize?: number
  toolsJsonBySessionId?: Record<string, string | null>
}) {
  const sources = options?.sources ?? [PRODUCT_DOCS_SOURCE]
  const kvValues = new Map(
    sources.map((source) => [S0_CONFIG_KEYS.aiSearch.source(source.id), JSON.stringify(source)]),
  )
  const toBindingChunks = (response: AiSearchAiSearchResponse | AiSearchSearchResponse) =>
    (response.data ?? []).map((item, index) => ({
      id: item.file_id ?? `chunk-${index}`,
      type: item.content?.[0]?.type ?? "text",
      score: item.score ?? 0,
      text: item.content?.[0]?.text ?? "",
      item: {
        key: item.filename ?? "unknown",
      },
    }))

  const chatCompletions = vi.fn(async () => {
    const response = options?.aiSearchResponse ?? SAMPLE_AI_SEARCH_RESPONSE
    return {
      choices: [
        {
          message: {
            role: "assistant",
            content: response.response ?? "",
          },
        },
      ],
      chunks: toBindingChunks(response),
    }
  })
  const search = vi.fn(async () => {
    if (options?.searchReject) {
      throw options.searchReject
    }
    const response = options?.searchResponse ?? SAMPLE_SEARCH_RESPONSE
    return {
      search_query: "",
      chunks: toBindingChunks(response),
    }
  })
  const get = vi.fn(() => ({
    search,
    chatCompletions,
  }))
  const prepare = vi.fn(() => ({
    bind: vi.fn((sessionId: string) => ({
      first: vi.fn(async () => {
        const toolsJson = options?.toolsJsonBySessionId?.[sessionId] ?? null
        return toolsJson === null ? null : { tools_json: toolsJson }
      }),
    })),
  }))
  const s0Config = {
    get: vi.fn(async (key: string) => kvValues.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      kvValues.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      kvValues.delete(key)
    }),
    list: vi.fn(async ({ prefix, cursor }: { prefix?: string; cursor?: string }) => {
      const names = [...kvValues.keys()].filter((key) => key.startsWith(prefix ?? "")).sort()
      const offset = Number(cursor ?? 0)
      const pageSize = options?.kvListPageSize ?? Math.max(names.length, 1)
      const pageNames = names.slice(offset, offset + pageSize)
      const nextOffset = offset + pageNames.length
      const listComplete = nextOffset >= names.length
      return {
        keys: pageNames.map((name) => ({ name })),
        list_complete: listComplete,
        ...(listComplete ? {} : { cursor: String(nextOffset) }),
      }
    }),
  }

  const env = {
    AI_SEARCH: { get },
    S0_CONFIG: s0Config,
    DB: { prepare },
    REPO_SECRETS_ENCRYPTION_KEY: "test-key",
  } as unknown as Env

  return { env, chatCompletions, search, get, prepare }
}

function createRuntimeContext() {
  return { log: { error: vi.fn() } }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function invokeServerRequest(
  server: TestMcpServer,
  request: JsonRpcRequest,
  headers?: HeadersInit,
): Promise<unknown> {
  const handler = server.server._requestHandlers.get(request.method)
  if (!handler) {
    throw new Error(`Missing MCP request handler for '${request.method}'`)
  }

  return handler(request, {
    requestInfo: {
      headers: headersToRecord(headers),
      url: new URL("https://example.com/mcp"),
    },
  })
}

async function resolveAllowedSources(env: Env, headers?: HeadersInit) {
  return resolveAllowedAiSearchSources(new Request("https://example.com/mcp", { headers }), env)
}

describe("AI Search config export", () => {
  it("exports normalized source records without a separate index", async () => {
    const { env } = createTestEnv()

    const result = await Effect.runPromise(exportAiSearchConfig(env))

    expect(result).toMatchObject({
      variableCount: 1,
      sourceCount: 1,
    })
    expect(result.dotenv).toContain('"aiSearchSources":[{"id":"product-docs"')
    expect(result.dotenv).not.toContain("createdAt")
    expect(result.dotenv).not.toContain("instanceId")
    expect(result.dotenv).not.toContain("toolSlug")
  })
})

describe("AI Search source discovery", () => {
  it("reads paginated KV sources as runtime registry state", async () => {
    const kvProductDocs = {
      ...PRODUCT_DOCS_SOURCE,
      label: "KV Product Docs",
      maxResults: 3,
    }
    const { env } = createTestEnv({
      sources: [kvProductDocs, DISABLED_SOURCE],
      kvListPageSize: 1,
    })

    const sources = await Effect.runPromise(
      new AiSearchRegistryStore(env).listSourcesWithPresence(),
    )

    expect(sources).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ id: "disabled-docs" }),
        recordSource: "kv",
        locked: false,
      }),
      expect.objectContaining({
        source: expect.objectContaining({
          id: "product-docs",
          label: "KV Product Docs",
          maxResults: 3,
        }),
        recordSource: "kv",
        locked: false,
        envVarName: null,
      }),
    ])
  })
})

describe("AI Search MCP runtime", () => {
  it("runs aiSearch for the selected source and formats the answer", async () => {
    const { env, chatCompletions, get } = createTestEnv()

    const text = await Effect.runPromise(
      runAiSearchMcpTool(
        env,
        PRODUCT_DOCS_SOURCE,
        "How does product setup work?",
        createRuntimeContext(),
        "aiSearch",
      ),
    )

    expect(get).toHaveBeenCalledWith("product-docs")
    expect(chatCompletions).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "How does product setup work?" }],
        ai_search_options: expect.objectContaining({
          retrieval: { max_num_results: 7 },
          query_rewrite: { enabled: true },
        }),
      }),
    )
    expect(text).toContain("Product Docs")
    expect(text).toContain("canonical installation flow")
    expect(text).toContain("kb/product/setup.md")
  })

  it("runs retrieval search through the API AI Search binding", async () => {
    const { env, search, chatCompletions, get } = createTestEnv()

    const text = await Effect.runPromise(
      runAiSearchMcpTool(
        env,
        PRODUCT_DOCS_SOURCE,
        "Which setup runbook should I use?",
        createRuntimeContext(),
        "search",
      ),
    )

    expect(get).toHaveBeenCalledWith("product-docs")
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "Which setup runbook should I use?",
        ai_search_options: expect.objectContaining({
          retrieval: { max_num_results: 7 },
          query_rewrite: { enabled: true },
        }),
      }),
    )
    expect(chatCompletions).not.toHaveBeenCalled()
    expect(text).toContain("Product Docs")
    expect(text).toContain("setup runbooks")
    expect(text).toContain("kb/product/setup.md")
  })

  it("logs search failures with generic source context", async () => {
    const error = new Error("AI Search context limit exceeded")
    const { env } = createTestEnv({ searchReject: error })
    const log = { error: vi.fn() }

    await expect(
      Effect.runPromise(
        runAiSearchMcpTool(
          env,
          PRODUCT_DOCS_SOURCE,
          "Which setup runbook should I use?",
          { log },
          "search",
        ),
      ),
    ).rejects.toThrow("AI Search context limit exceeded")
    expect(log.error).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        event: "ai_search.mcp.search.failed",
        aiSearch: expect.objectContaining({
          sourceId: "product-docs",
          mode: "search",
          queryLength: expect.any(Number),
        }),
      }),
    )
  })
})

describe("AI Search MCP server", () => {
  it("resolves header-selected sources and serves initialize, tools/list, and tools/call", async () => {
    const { env, chatCompletions, search, get } = createTestEnv()
    const headers = {
      [AI_SEARCH_SOURCE_HEADER]: "product-docs",
    }

    const allowedSources = await resolveAllowedSources(env, headers)
    expect(allowedSources.map((source) => source.id)).toEqual(["product-docs"])

    const server = createAiSearchMcpServer(
      env,
      allowedSources,
      createRuntimeContext(),
    ) as unknown as TestMcpServer

    const initialize = await invokeServerRequest(
      server,
      {
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
      },
      headers,
    )

    expect(initialize).toMatchObject({
      protocolVersion: expect.any(String),
      capabilities: expect.objectContaining({
        tools: expect.any(Object),
      }),
      serverInfo: expect.objectContaining({
        name: "s0-ai-search",
      }),
    })

    const listedTools = await invokeServerRequest(
      server,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      },
      headers,
    )

    expect(listedTools).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: "search_product_docs",
          description: expect.stringContaining("Search Product Docs"),
        }),
        expect.objectContaining({
          name: "ask_product_docs",
          description: expect.stringContaining("Search Product Docs"),
        }),
      ]),
    })

    const retrievalTool = (await invokeServerRequest(
      server,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "search_product_docs",
          arguments: {
            query: "product setup runbook",
          },
        },
      },
      headers,
    )) as {
      content?: Array<{ type?: string; text?: string }>
    }

    expect(get).toHaveBeenCalledWith("product-docs")
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "product setup runbook",
        ai_search_options: expect.objectContaining({
          retrieval: { max_num_results: 7 },
          query_rewrite: { enabled: true },
        }),
      }),
    )
    expect(retrievalTool).toMatchObject({
      content: [
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Product Docs"),
        }),
      ],
    })

    const answerTool = (await invokeServerRequest(
      server,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "ask_product_docs",
          arguments: {
            query: "product setup runbook",
          },
        },
      },
      headers,
    )) as {
      content?: Array<{ type?: string; text?: string }>
    }

    expect(chatCompletions).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "product setup runbook" }],
        ai_search_options: expect.objectContaining({
          retrieval: { max_num_results: 7 },
          query_rewrite: { enabled: true },
        }),
      }),
    )
    expect(answerTool).toMatchObject({
      content: [
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Product Docs"),
        }),
      ],
    })

    const textContent = answerTool.content?.find((part) => part.type === "text")?.text
    expect(textContent).toContain("canonical installation flow")
    expect(textContent).toContain("kb/product/setup.md")
  })

  it("falls back to session-backed AI Search sources when source headers are omitted", async () => {
    const { env, chatCompletions, prepare } = createTestEnv({
      toolsJsonBySessionId: {
        "session-123": JSON.stringify([
          {
            kind: "ai_search",
            sourceId: "product-docs",
          },
        ]),
      },
    })
    const headers = {
      [AI_SEARCH_SESSION_HEADER]: "session-123",
    }

    const allowedSources = await resolveAllowedSources(env, headers)
    expect(prepare).toHaveBeenCalledWith("SELECT tools_json FROM sessions WHERE id = ?1")
    expect(allowedSources.map((source) => source.id)).toEqual(["product-docs"])

    const server = createAiSearchMcpServer(
      env,
      allowedSources,
      createRuntimeContext(),
    ) as unknown as TestMcpServer

    const listedTools = await invokeServerRequest(
      server,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/list",
        params: {},
      },
      headers,
    )

    expect(listedTools).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: "search_product_docs",
        }),
        expect.objectContaining({
          name: "ask_product_docs",
        }),
      ]),
    })

    const calledTool = (await invokeServerRequest(
      server,
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "ask_product_docs",
          arguments: {
            query: "setup runbook product",
          },
        },
      },
      headers,
    )) as {
      content?: Array<{ type?: string; text?: string }>
    }

    expect(chatCompletions).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "setup runbook product" }],
      }),
    )
    expect(calledTool).toMatchObject({
      content: [
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Product Docs"),
        }),
      ],
    })
  })

  it("rejects disabled or missing sources during selection", async () => {
    const { env } = createTestEnv({ sources: [PRODUCT_DOCS_SOURCE, DISABLED_SOURCE] })

    await expect(
      resolveAllowedSources(env, {
        [AI_SEARCH_SOURCE_HEADER]: "disabled-docs",
      }),
    ).rejects.toThrow("AI Search source is not available: disabled-docs")

    await expect(
      resolveAllowedSources(env, {
        [AI_SEARCH_SOURCE_HEADER]: "missing-docs",
      }),
    ).rejects.toThrow("AI Search source is not available: missing-docs")
  })
})
