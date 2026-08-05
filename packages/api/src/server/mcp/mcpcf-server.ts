import {
  MCPCF_PROXY_TOOL_PREFIX,
  getMcpcfProxyServerAlias,
  getMcpcfProxyToolName,
  parseMcpcfProxyToolName,
} from "@solzero/shared"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type { McpcfConfigRecord, McpcfServerRecord } from "../background/db/mcpcf"
import {
  MCPCF_MCP_TIMEOUT_MS,
  INTERNAL_MCPCF_MCP_SERVER_NAME,
  getMcpcfMcpServerName,
} from "../background/session/mcp-config"
import {
  McpcfMcpRuntimeError,
  getMcpcfServerMcpUrl,
  redactMcpcfErrorMessage,
} from "./mcpcf-server/runtime"
import type { McpcfMcpContext } from "./mcpcf-server/runtime"

export {
  formatMcpcfBearerCredential,
  getMcpcfServerMcpUrl,
  normalizeMcpcfMcpRequest,
  redactMcpcfErrorMessage,
  resolveMcpcfMcpContext,
} from "./mcpcf-server/runtime"
export type {
  McpcfMcpContext,
  McpcfMcpLogSink,
  McpcfMcpRuntimeContext,
  McpcfRuntimeAuthMode,
  McpcfServerRuntimeSettings,
  McpcfUpstreamCallToolInput,
  McpcfUpstreamClient,
  McpcfUpstreamListToolsInput,
} from "./mcpcf-server/runtime"

function getExposedMcpcfToolName(context: McpcfMcpContext, server: McpcfServerRecord, tool: Tool) {
  return Match.value(context.servers.length === 1).pipe(
    Match.when(true, () => tool.name),
    Match.orElse(() => getMcpcfProxyToolName(server.id, tool.name)),
  )
}

function prefixMcpcfTool(context: McpcfMcpContext, server: McpcfServerRecord, tool: Tool): Tool {
  const description = Match.value(Boolean(tool.description)).pipe(
    Match.when(true, () => `[${server.label}] ${tool.description}`),
    Match.orElse(() => `[${server.label}] MCP Context Forge tool.`),
  )

  return {
    ...tool,
    name: getExposedMcpcfToolName(context, server, tool),
    description,
    inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    _meta: {
      ...tool._meta,
      "s0/mcpcfServerId": server.id,
      "s0/mcpcfServerSlug": server.slug,
      "s0/mcpcfUpstreamToolName": tool.name,
    },
  }
}

function getMcpcfAccessTokenForServer(context: McpcfMcpContext, server: McpcfServerRecord): string {
  return Option.getOrThrowWith(
    Option.fromNullishOr(context.accessTokensByServerId[server.id]).pipe(
      Option.orElse(() => context.accessToken),
    ),
    () => new Error(`MCP Context Forge runtime credential is unavailable for ${server.label}`),
  )
}

function getMcpcfUpstreamAccessTokenForServer(
  context: McpcfMcpContext,
  server: McpcfServerRecord,
): Option.Option<string> {
  return Option.fromNullishOr(context.upstreamAccessTokensByServerId[server.id])
}

function filterToolsByDisabledSet(tools: Tool[], disabledTools: Set<string>): Tool[] {
  return Match.value(disabledTools.size === 0).pipe(
    Match.when(true, () => tools),
    Match.orElse(() => Arr.filter(tools, (tool) => !disabledTools.has(tool.name))),
  )
}

function filterDefaultEnabledTools(
  context: McpcfMcpContext,
  server: McpcfServerRecord,
  tools: Tool[],
): Tool[] {
  const settings = context.serverSettingsById[server.id]
  const defaultDisabled = settings?.defaultToolsEnabled === false
  return Match.value(defaultDisabled).pipe(
    Match.when(true, () => [] as Tool[]),
    Match.orElse(() => filterToolsByDisabledSet(tools, new Set(settings?.disabledTools ?? []))),
  )
}

function isMcpcfToolEnabledForServer(
  context: McpcfMcpContext,
  server: McpcfServerRecord,
  upstreamToolName: string,
): boolean {
  const settings = context.serverSettingsById[server.id]
  const defaultDisabled = settings?.defaultToolsEnabled === false
  return Match.value(defaultDisabled).pipe(
    Match.when(true, () => false),
    Match.orElse(() => !(settings?.disabledTools ?? []).includes(upstreamToolName)),
  )
}

function buildMcpcfOAuthAuthLogFields(context: McpcfMcpContext): Record<string, unknown> {
  const issuerMatches = Option.match(
    Option.all({
      accessTokenIssuer: context.accessTokenIssuer,
      expectedAccessTokenIssuer: context.expectedAccessTokenIssuer,
    }),
    {
      onNone: () => null,
      onSome: ({ accessTokenIssuer, expectedAccessTokenIssuer }) =>
        accessTokenIssuer === expectedAccessTokenIssuer,
    },
  )
  return {
    oauth: {
      providerId: Option.getOrNull(context.oauthProviderId),
      providerUserId: Option.getOrNull(context.providerUserId),
      accessTokenIssuer: Option.getOrNull(context.accessTokenIssuer),
      expectedAccessTokenIssuer: Option.getOrNull(context.expectedAccessTokenIssuer),
      issuerMatches,
    },
  }
}

function mcpcfOAuthAuthLogFields(context: McpcfMcpContext): Record<string, unknown> {
  return Option.match(context.authMode, {
    onNone: () => ({}),
    onSome: (mode) =>
      Match.value(mode === "mcpcf_oauth").pipe(
        Match.when(true, () => buildMcpcfOAuthAuthLogFields(context)),
        Match.orElse(() => ({})),
      ),
  })
}

const listMcpcfServerTools = Effect.fn("mcp.mcpcf.listServerTools")(function* (
  context: McpcfMcpContext,
  config: McpcfConfigRecord,
  server: McpcfServerRecord,
) {
  const startedAt = Date.now()
  const accessToken = getMcpcfAccessTokenForServer(context, server)
  const upstreamAccessToken = getMcpcfUpstreamAccessTokenForServer(context, server)
  const tools = yield* context.upstreamClient
    .listTools({
      config,
      server,
      accessToken,
      upstreamAccessToken: Option.getOrUndefined(upstreamAccessToken),
    })
    .pipe(
      Effect.catch((cause) =>
        Effect.gen(function* () {
          const listError = new McpcfMcpRuntimeError({
            message: redactMcpcfErrorMessage(cause, [
              accessToken,
              Option.getOrElse(upstreamAccessToken, () => ""),
            ]),
          })
          const oauthAuthFields = mcpcfOAuthAuthLogFields(context)
          context.log.error(listError, {
            event: "mcp.mcpcf.tools.list_failed",
            boundary: "mcp.mcpcf.upstream_tools",
            mcpcf: {
              serverId: server.id,
              slug: server.slug,
              label: server.label,
              upstreamUrl: getMcpcfServerMcpUrl(config, server),
            },
            auth: {
              mode: Option.getOrNull(context.authMode),
            },
            ...oauthAuthFields,
            upstream: {
              timeoutMs: MCPCF_MCP_TIMEOUT_MS,
              durationMs: Date.now() - startedAt,
            },
            _forceKeep: true,
          })
          return yield* Effect.fail(listError)
        }),
      ),
    )

  context.log.set({
    event: "mcp.mcpcf.tools.listed",
    boundary: "mcp.mcpcf.upstream_tools",
    mcpcf: {
      serverId: server.id,
      slug: server.slug,
      label: server.label,
      upstreamToolCount: tools.length,
      exposedToolCount: filterDefaultEnabledTools(context, server, tools).length,
    },
    upstream: {
      durationMs: Date.now() - startedAt,
    },
  })
  return filterDefaultEnabledTools(context, server, tools).map((tool) =>
    prefixMcpcfTool(context, server, tool),
  )
})

const listMcpcfTools = Effect.fn("mcp.mcpcf.listTools")(function* (context: McpcfMcpContext) {
  return yield* Match.value(context.servers.length === 0).pipe(
    Match.when(true, () => Effect.succeed([] as Tool[])),
    Match.orElse(() =>
      Effect.gen(function* () {
        const config = yield* Option.match(context.config, {
          onNone: () =>
            Effect.fail(
              new McpcfMcpRuntimeError({
                message: "MCP Context Forge runtime credential is unavailable",
              }),
            ),
          onSome: Effect.succeed,
        })
        const toolsByServer = yield* Effect.all(
          context.servers.map((server) => listMcpcfServerTools(context, config, server)),
        )
        return toolsByServer.flat()
      }),
    ),
  )
})

function getSelectedServerForProxyTool(
  context: McpcfMcpContext,
  proxyToolName: string,
): { server: McpcfServerRecord; upstreamToolName: string } {
  const parsedSelection = Option.flatMap(
    Option.fromNullishOr(parseMcpcfProxyToolName(proxyToolName)),
    (parsedValue) =>
      Option.map(
        Option.fromNullishOr(
          context.servers.find(
            (server) => getMcpcfProxyServerAlias(server.id) === parsedValue.serverAlias,
          ),
        ),
        (server) => ({
          server,
          upstreamToolName: parsedValue.upstreamToolName,
        }),
      ),
  )
  const fallbackSelection = Match.value(proxyToolName.startsWith(MCPCF_PROXY_TOOL_PREFIX)).pipe(
    Match.when(true, () => Option.none<{ server: McpcfServerRecord; upstreamToolName: string }>()),
    Match.orElse(() =>
      Option.flatMap(Arr.head(context.servers), (onlyServer) =>
        Match.value(context.servers.length === 1).pipe(
          Match.when(true, () =>
            Option.some({
              server: onlyServer,
              upstreamToolName: proxyToolName,
            }),
          ),
          Match.orElse(() => Option.none()),
        ),
      ),
    ),
  )
  return Option.getOrThrowWith(parsedSelection.pipe(Option.orElse(() => fallbackSelection)), () =>
    Option.match(Option.fromNullishOr(parseMcpcfProxyToolName(proxyToolName)), {
      onSome: (parsedValue) =>
        new Error(`MCP Context Forge server alias '${parsedValue.serverAlias}' is not selected`),
      onNone: () => new Error(`Unknown MCP Context Forge tool '${proxyToolName}'`),
    }),
  )
}

const callMcpcfTool = Effect.fn("mcp.mcpcf.callTool")(function* (
  context: McpcfMcpContext,
  proxyToolName: string,
  toolArguments?: Record<string, unknown>,
) {
  const config = yield* Option.match(context.config, {
    onNone: () =>
      Effect.fail(
        new McpcfMcpRuntimeError({
          message: "MCP Context Forge runtime credential is unavailable",
        }),
      ),
    onSome: Effect.succeed,
  })

  const { server, upstreamToolName } = getSelectedServerForProxyTool(context, proxyToolName)
  yield* Effect.succeed({ server, upstreamToolName }).pipe(
    Effect.filterOrFail(
      ({ server, upstreamToolName }) =>
        isMcpcfToolEnabledForServer(context, server, upstreamToolName),
      ({ upstreamToolName }) =>
        new McpcfMcpRuntimeError({
          message: `MCP Context Forge tool '${upstreamToolName}' is disabled by default`,
        }),
    ),
  )
  const accessToken = getMcpcfAccessTokenForServer(context, server)
  const upstreamAccessToken = getMcpcfUpstreamAccessTokenForServer(context, server)
  return yield* context.upstreamClient
    .callTool({
      config,
      server,
      accessToken,
      upstreamAccessToken: Option.getOrUndefined(upstreamAccessToken),
      toolName: upstreamToolName,
      arguments: toolArguments,
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new McpcfMcpRuntimeError({
            message: redactMcpcfErrorMessage(cause, [
              accessToken,
              Option.getOrElse(upstreamAccessToken, () => ""),
            ]),
          }),
      ),
    )
})

export function createMcpcfMcpServer(context: McpcfMcpContext): McpServer {
  const serverName = Option.match(Arr.head(context.servers), {
    onNone: () => INTERNAL_MCPCF_MCP_SERVER_NAME,
    onSome: (server) =>
      Match.value(context.servers.length === 1).pipe(
        Match.when(true, () => getMcpcfMcpServerName(server)),
        Match.orElse(() => INTERNAL_MCPCF_MCP_SERVER_NAME),
      ),
  })
  const server = new McpServer(
    {
      name: serverName,
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    // oxlint-disable-next-line effect/effect-run-in-body -- MCP SDK request handler requires Promise; runs listMcpcfTools Effect at that boundary.
    tools: await Effect.runPromise(listMcpcfTools(context)),
  }))

  server.server.setRequestHandler(CallToolRequestSchema, async (request) =>
    // oxlint-disable-next-line effect/effect-run-in-body -- MCP SDK request handler requires Promise; runs callMcpcfTool Effect at that boundary.
    Effect.runPromise(callMcpcfTool(context, request.params.name, request.params.arguments)),
  )

  return server
}
