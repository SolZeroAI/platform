import {
  getSelectedAiSearchSourceIds,
  parseStoredSessionTools,
  type SessionToolSpec,
} from "@c0-agent/shared"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
  AiSearchRegistryStore,
  getAiSearchMcpToolNames,
  type AiSearchSourceRecord,
} from "../background/db/ai-search"
import {
  AI_SEARCH_SESSION_HEADER,
  INTERNAL_AI_SEARCH_MCP_ROUTE,
  parseAllowedAiSearchSources,
} from "../background/session/mcp-config"
import type { Env } from "../background/types"
import { runAiSearchMcpTool, type AiSearchMcpRuntimeContext } from "./ai-search-runtime"
import type { AiSearchToolMode } from "./ai-search-runtime"
import { objectInputSchema } from "./tool-input-schema"

class AiSearchToolInput extends Schema.Class<AiSearchToolInput>("AiSearchToolInput")({
  query: Schema.NonEmptyString,
}) {}

const aiSearchToolInputSchema = objectInputSchema(AiSearchToolInput)

function aiSearchSourceIdsFromTools(tools: SessionToolSpec[]): string[] {
  return getSelectedAiSearchSourceIds(tools)
}

function aiSearchSourcesFromSession(env: Env, sessionId: string): Promise<string[]> {
  return env.DB.prepare("SELECT tools_json FROM sessions WHERE id = ?")
    .bind(sessionId)
    .first<{ tools_json: string | null }>()
    .then((row) =>
      Option.match(Option.fromNullishOr(row?.tools_json), {
        onNone: () => [],
        onSome: (toolsJson) => aiSearchSourceIdsFromTools(parseStoredSessionTools(toolsJson)),
      }),
    )
}

function parseAllowedAiSearchSourcesSafe(request: Request): Promise<Option.Option<string[]>> {
  return Promise.resolve()
    .then(() => Option.some(parseAllowedAiSearchSources(request)))
    .catch(() => Option.none<string[]>())
}

function resolveAiSearchSourceIdsFromSessionId(
  env: Env,
  sessionId: string | undefined,
): Promise<string[]> {
  return Option.match(Option.fromNullishOr(sessionId).pipe(Option.filter((id) => id.length > 0)), {
    onNone: () => Promise.resolve<string[]>([]),
    onSome: (id) => aiSearchSourcesFromSession(env, id),
  })
}

function requireAllSourcesAvailable(
  requestedSourceIds: readonly string[],
  sources: readonly AiSearchSourceRecord[],
): AiSearchSourceRecord[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  const missing = requestedSourceIds.filter((sourceId) => !sourceById.has(sourceId))
  Match.value(missing.length > 0).pipe(
    Match.when(true, () => {
      throw new Error(`AI Search source is not available: ${missing.join(", ")}`)
    }),
    Match.orElse(() => undefined),
  )
  return requestedSourceIds.flatMap((sourceId) =>
    Option.match(Option.fromNullishOr(sourceById.get(sourceId)), {
      onNone: () => [],
      onSome: (source) => [source],
    }),
  )
}

function resolveAvailableSourcesFromRegistry(
  env: Env,
  requestedSourceIds: readonly string[],
): Promise<AiSearchSourceRecord[]> {
  const registry = new AiSearchRegistryStore(env)
  // oxlint-disable-next-line effect/effect-run-in-body -- MCP SDK request setup is Promise-based.
  return Effect.runPromise(registry.listAvailableSourcesByIds(requestedSourceIds)).then((sources) =>
    requireAllSourcesAvailable(requestedSourceIds, sources),
  )
}

export async function resolveAllowedAiSearchSources(
  request: Request,
  env: Env,
): Promise<AiSearchSourceRecord[]> {
  const sessionId = request.headers.get(AI_SEARCH_SESSION_HEADER)?.trim()
  const fromHeader = await parseAllowedAiSearchSourcesSafe(request)
  const headerSourceIds = fromHeader.pipe(Option.filter((sourceIds) => sourceIds.length > 0))
  const requestedSourceIds = await Option.match(headerSourceIds, {
    onNone: () => resolveAiSearchSourceIdsFromSessionId(env, sessionId),
    onSome: (sourceIds) => Promise.resolve(sourceIds),
  })
  return Match.value(requestedSourceIds.length === 0).pipe(
    Match.when(true, () => Promise.resolve<AiSearchSourceRecord[]>([])),
    Match.orElse(() => resolveAvailableSourcesFromRegistry(env, requestedSourceIds)),
  )
}

function rewriteRequestPathname(request: Request, url: URL, pathname: string): Request {
  url.pathname = pathname
  return new Request(url.toString(), request)
}

export function normalizeAiSearchMcpRequest(request: Request): Request {
  const url = new URL(request.url)
  return Match.value(url.pathname === `${INTERNAL_AI_SEARCH_MCP_ROUTE}/`).pipe(
    Match.when(true, () => rewriteRequestPathname(request, url, INTERNAL_AI_SEARCH_MCP_ROUTE)),
    Match.orElse(() => request),
  )
}

export function createAiSearchMcpServer(
  env: Env,
  allowedSources: readonly AiSearchSourceRecord[],
  context: AiSearchMcpRuntimeContext,
): McpServer {
  const server = new McpServer(
    {
      name: "c0-ai-search",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  const tools = allowedSources.flatMap(aiSearchSourceTools)

  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(({ tool }) => tool),
  }))

  server.server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleAiSearchCallTool(env, context, tools, request.params.name, request.params.arguments),
  )

  return server
}

function aiSearchSourceTools(source: AiSearchSourceRecord) {
  const toolNames = getAiSearchMcpToolNames(source)
  return [
    defineAiSearchSourceTool(
      source,
      toolNames.search,
      "search",
      `Search ${source.label} and return retrieval-only source results.`,
    ),
    defineAiSearchSourceTool(
      source,
      toolNames.aiSearch,
      "aiSearch",
      `Search ${source.label} and generate an answer with retrieved sources.`,
    ),
  ]
}

function handleAiSearchCallTool(
  env: Env,
  context: AiSearchMcpRuntimeContext,
  tools: ReadonlyArray<ReturnType<typeof defineAiSearchSourceTool>>,
  toolName: string,
  rawArguments: unknown,
): Promise<CallToolResult> {
  const definition = Option.getOrThrowWith(
    Option.fromNullishOr(tools.find(({ tool }) => tool.name === toolName)),
    () => new Error(`Tool ${toolName} not found`),
  )
  return runAiSearchSourceTool(
    env,
    context,
    definition,
    Schema.decodeUnknownSync(AiSearchToolInput)(rawArguments ?? {}),
  )
}

function defineAiSearchSourceTool(
  source: AiSearchSourceRecord,
  toolName: string,
  mode: AiSearchToolMode,
  description: string,
) {
  return {
    mode,
    source,
    tool: {
      name: toolName,
      description,
      inputSchema: aiSearchToolInputSchema,
    } satisfies Tool,
  } as const
}

async function runAiSearchSourceTool(
  env: Env,
  context: AiSearchMcpRuntimeContext,
  definition: ReturnType<typeof defineAiSearchSourceTool>,
  input: AiSearchToolInput,
): Promise<CallToolResult> {
  // oxlint-disable-next-line effect/effect-run-in-body -- MCP SDK request handler requires Promise; runs runAiSearchMcpTool Effect at that boundary.
  const text = await Effect.runPromise(
    runAiSearchMcpTool(env, definition.source, input.query, context, definition.mode),
  )
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  }
}
