import {
  buildSessionToolRuntimePlan,
  isCustomMcpServerId,
  isMcpDiscoveryErrorReason,
  type McpDiscoveryErrorReason,
  type McpcfServerDefinition,
  type OpenCodeMcpServers,
  type OpenCodeRemoteMcpServer,
  type RemoteCustomMcpServerRuntimePlan,
  type StageMetadataInput,
  type SessionToolRuntimePlan,
  type SessionToolSpec,
} from "@solzero/shared"
import type { MCPClientManager, RegisterServerOptions } from "agents/mcp/client"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { describeError, toError } from "../../lib/effect-errors"
import { parseJsonOrText, stringifyJson } from "../../lib/json"
import { redactMcpcfErrorMessage } from "../../mcp/mcpcf-server"
import {
  MCPCF_MCP_TIMEOUT_MS,
  MCPCF_SERVER_HEADER,
  INTERNAL_MCPCF_MCP_SERVER_NAME,
  getMcpcfIsolateMcpUrl,
  getMcpcfMcpServerName,
} from "../session/mcp-config"

const DEFAULT_DISCOVERY_TIMEOUT_MS = 15_000

type McpServerRow = ReturnType<MCPClientManager["listServers"]>[number]
type McpConnection = MCPClientManager["mcpConnections"][string]
type McpConnectionResult = Awaited<ReturnType<MCPClientManager["connectToServer"]>>
type McpDiscoverResult = Awaited<ReturnType<MCPClientManager["discoverIfConnected"]>>
type McpcfPlanServer = SessionToolRuntimePlan["mcpRegistration"]["mcpcfServers"][number]
type ManagedMcpServerSource = "custom" | "mcpcf"

interface JsonRpcError {
  message: string | null
  discoveryReason: McpDiscoveryErrorReason | null
}

export interface McpcfMcpToolExposureSnapshot {
  rawToolNames: string[]
  connectionState: string | null
  connectionError: string | null
  serverCapabilities: unknown
  toolNames: string[]
}

export interface McpcfMcpToolExposureReader {
  getServerExposure(serverName: string): McpcfMcpToolExposureSnapshot
}

export type McpcfMcpToolExposureManager = Pick<MCPClientManager, "mcpConnections" | "getAITools">

export interface RemoteCustomMcpServerRegistration {
  id: string
  name: string
  server: OpenCodeRemoteMcpServer
  options: RegisterServerOptions
  optional: boolean
  source: ManagedMcpServerSource
  secretValues?: string[]
}

export interface IsolateMcpSyncResult {
  connectedServerNames: string[]
  skippedServers: Array<{
    name: string
    error: string
  }>
}

export type IsolateMcpManager = Pick<
  MCPClientManager,
  | "connectToServer"
  | "discoverIfConnected"
  | "listServers"
  | "mcpConnections"
  | "registerServer"
  | "removeServer"
>

type RemoteMcpServerRegistration = RemoteCustomMcpServerRegistration

interface RegistrationSyncOutcome {
  connectedName: Option.Option<string>
  skipped: Option.Option<IsolateMcpSyncResult["skippedServers"][number]>
}

export class IsolateMcpServerSyncError extends Error {
  readonly serverId: string
  readonly serverName: string
  readonly serverUrl: string
  readonly source: ManagedMcpServerSource
  readonly discoveryReason?: McpDiscoveryErrorReason

  constructor(
    message: string,
    registration: RemoteMcpServerRegistration,
    discoveryReason?: McpDiscoveryErrorReason,
  ) {
    super(message)
    this.name = "IsolateMcpServerSyncError"
    this.serverId = registration.id
    this.serverName = registration.name
    this.serverUrl = registration.server.url
    this.source = registration.source
    this.discoveryReason = discoveryReason
  }
}

function attempt<A>(thunk: () => Promise<A>) {
  return Effect.tryPromise({ try: thunk, catch: toError })
}

export function getEnabledRemoteCustomMcpServerNames(
  customMcpServers: OpenCodeMcpServers | null | undefined,
): string[] {
  return buildSessionToolRuntimePlan({ customMcpServers }).isolatePromptFacts.customMcpServerNames
}

function asRecord(value: unknown): Option.Option<Record<string, unknown>> {
  return Option.liftPredicate(
    value,
    (candidate): candidate is Record<string, unknown> =>
      Boolean(candidate) && typeof candidate === "object",
  )
}

function stableJsonEntries(value: Record<string, unknown>): string {
  return Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${stringifyJson(key)}:${stableJson(entryValue)}`)
    .join(",")
}

function stableJson(value: unknown): string {
  return Match.value(value).pipe(
    Match.when(Array.isArray, (entries) => `[${entries.map(stableJson).join(",")}]`),
    Match.when(
      (candidate: unknown): candidate is Record<string, unknown> =>
        Boolean(candidate) && typeof candidate === "object",
      (record) => `{${stableJsonEntries(record)}}`,
    ),
    Match.orElse((other) => stringifyJson(other)),
  )
}

export function formatMcpcfMcpAuthError(error: unknown): string {
  const message = describeError(error)
  const reconnectMarker = "LinkedOAuthReconnectRequiredError:"
  const reconnectIndex = message.lastIndexOf(reconnectMarker)
  return Match.value(reconnectIndex >= 0).pipe(
    Match.when(true, () => message.slice(reconnectIndex + reconnectMarker.length).trim()),
    Match.orElse(() => message),
  )
}

function extractJsonRpcPayload(message: string): Option.Option<Record<string, unknown>> {
  const start = message.indexOf('{"jsonrpc"')
  return Option.liftPredicate(start, (index) => index >= 0).pipe(
    Option.flatMap((index) => asRecord(parseJsonOrText(message.slice(index)))),
    Option.filter((parsed) => "error" in parsed),
  )
}

function jsonRpcMessage(value: unknown): Option.Option<string> {
  return Option.liftPredicate(
    value,
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  ).pipe(Option.map((candidate) => candidate.trim()))
}

function jsonRpcDiscoveryReason(data: unknown): Option.Option<McpDiscoveryErrorReason> {
  return asRecord(data).pipe(
    Option.filter((record) => "discoveryReason" in record),
    Option.map((record) => record.discoveryReason),
    Option.filter(isMcpDiscoveryErrorReason),
  )
}

function toJsonRpcError(errorValue: Record<string, unknown>): JsonRpcError {
  return {
    message: Option.getOrNull(jsonRpcMessage(errorValue.message)),
    discoveryReason: Option.getOrNull(jsonRpcDiscoveryReason(errorValue.data)),
  }
}

function getJsonRpcError(message: string): Option.Option<JsonRpcError> {
  return extractJsonRpcPayload(message).pipe(
    Option.flatMap((parsed) => asRecord(parsed.error)),
    Option.filter((errorValue) => "message" in errorValue),
    Option.map(toJsonRpcError),
  )
}

function isOAuthReconnectMessage(message: string): boolean {
  return (
    message.includes("LinkedOAuthReconnectRequiredError:") ||
    message.includes("OktaAccountReconnectRequiredError:") ||
    message.includes("Reconnect your configured OAuth account") ||
    message.includes("Reconnect Okta")
  )
}

export function formatMcpcfMcpSyncError(error: unknown): string {
  const message = formatMcpcfMcpAuthError(error).replace(
    /^Failed to (?:connect|discover) remote MCP server 'mcpcf(?:_[^']+)?':\s*/,
    "",
  )
  return Option.match(getJsonRpcError(message), {
    onNone: () => message,
    onSome: (jsonRpcError) => jsonRpcError.message ?? message,
  })
}

export function isMcpcfMcpSyncError(error: unknown): error is IsolateMcpServerSyncError {
  return error instanceof IsolateMcpServerSyncError && error.source === "mcpcf"
}

function formatRegistrationError(
  error: unknown,
  registration: RemoteMcpServerRegistration,
): string {
  return redactMcpcfErrorMessage(describeError(error), registration.secretValues)
}

function resolveMcpcfDiscoveryReason(message: string): McpDiscoveryErrorReason {
  const jsonRpcError = getJsonRpcError(message)
  const discoveryReason = Option.flatMap(jsonRpcError, (value) =>
    Option.fromNullishOr(value.discoveryReason),
  )
  const jsonRpcMessageText = Option.match(jsonRpcError, {
    onNone: () => "",
    onSome: (value) => value.message ?? "",
  })
  const oauthReconnect =
    isOAuthReconnectMessage(message) || isOAuthReconnectMessage(jsonRpcMessageText)
  return Option.match(discoveryReason, {
    onSome: (reason) => reason,
    onNone: () => fallbackDiscoveryReason(oauthReconnect),
  })
}

function fallbackDiscoveryReason(oauthReconnect: boolean): McpDiscoveryErrorReason {
  return Match.value(oauthReconnect).pipe(
    Match.when(true, () => "oauth_reconnect_required" as const),
    Match.orElse(() => "server_unavailable" as const),
  )
}

function getRegistrationDiscoveryReason(
  error: unknown,
  registration: RemoteMcpServerRegistration,
): McpDiscoveryErrorReason {
  return Match.value(registration.source === "mcpcf").pipe(
    Match.when(false, () => "server_unavailable" as const),
    Match.orElse(() => resolveMcpcfDiscoveryReason(describeError(error))),
  )
}

function transportHeaders(
  server: OpenCodeRemoteMcpServer,
): Option.Option<NonNullable<OpenCodeRemoteMcpServer["headers"]>> {
  return Option.fromNullishOr(server.headers).pipe(
    Option.filter((headers) => Object.keys(headers).length > 0),
  )
}

function buildTransportOptions(server: OpenCodeRemoteMcpServer) {
  return {
    type: "auto" as const,
    ...Option.match(transportHeaders(server), {
      onNone: () => ({}),
      onSome: (headers) => ({ requestInit: { headers } }),
    }),
  }
}

function buildRegistrationOptions(
  name: string,
  server: OpenCodeRemoteMcpServer,
): RegisterServerOptions {
  return {
    name,
    url: server.url,
    transport: buildTransportOptions(server),
  }
}

export function buildRemoteCustomMcpServerRegistrations(
  customMcpServers: OpenCodeMcpServers | null | undefined,
): RemoteCustomMcpServerRegistration[] {
  const plan = buildSessionToolRuntimePlan({ customMcpServers })
  return plan.mcpRegistration.remoteCustomMcpServers.map(buildRemoteCustomMcpServerRegistration)
}

function isMcpcfMcpServerRow(row: McpServerRow): boolean {
  return row.id === INTERNAL_MCPCF_MCP_SERVER_NAME || row.id.startsWith("mcpcf_")
}

export function buildInternalMcpcfMcpServerRegistrations(input: {
  tools: readonly SessionToolSpec[] | null | undefined
  mcpcfServers?: readonly McpcfServerDefinition[] | null
  sessionId?: string | null
  stage?: StageMetadataInput | null
  mcpcfCapability?: string | null
}): RemoteCustomMcpServerRegistration[] {
  const plan = buildSessionToolRuntimePlan({
    tools: input.tools,
    mcpcfServers: input.mcpcfServers,
  })
  return buildInternalMcpcfMcpServerRegistrationsFromPlan({
    plan,
    sessionId: input.sessionId,
    stage: input.stage,
    mcpcfCapability: input.mcpcfCapability,
  })
}

function buildRemoteCustomMcpServerRegistration(
  entry: RemoteCustomMcpServerRuntimePlan,
): RemoteCustomMcpServerRegistration {
  return {
    ...entry,
    options: buildRegistrationOptions(entry.name, entry.server),
    source: "custom",
  }
}

function authorizationHeader(token: string | null | undefined): Record<string, string> {
  return Option.match(Option.fromNullishOr(token), {
    onNone: () => ({}),
    onSome: (resolved) => ({ Authorization: `Bearer ${resolved}` }),
  })
}

interface McpcfRegistrationContext {
  sessionId?: string | null
  stage?: StageMetadataInput | null
  mcpcfCapability?: string | null
}

function buildMcpcfServerRegistration(
  server: McpcfPlanServer,
  context: McpcfRegistrationContext,
): RemoteCustomMcpServerRegistration {
  const name = getMcpcfMcpServerName(server)
  const remoteServer: OpenCodeRemoteMcpServer = {
    type: "remote",
    url: getMcpcfIsolateMcpUrl(context.stage ?? "dev"),
    enabled: true,
    oauth: false,
    headers: {
      [MCPCF_SERVER_HEADER]: server.id,
      ...authorizationHeader(context.mcpcfCapability),
    },
    timeout: MCPCF_MCP_TIMEOUT_MS,
  }

  return {
    id: name,
    name,
    server: remoteServer,
    options: buildRegistrationOptions(name, remoteServer),
    optional: false,
    source: "mcpcf",
    secretValues: Option.getOrUndefined(
      Option.map(Option.fromNullishOr(context.mcpcfCapability), (token) => [token]),
    ),
  }
}

export function buildInternalMcpcfMcpServerRegistrationsFromPlan(input: {
  plan: SessionToolRuntimePlan
  sessionId?: string | null
  stage?: StageMetadataInput | null
  mcpcfCapability?: string | null
}): RemoteCustomMcpServerRegistration[] {
  return input.plan.mcpRegistration.mcpcfServers.map((server) =>
    buildMcpcfServerRegistration(server, {
      sessionId: input.sessionId,
      stage: input.stage,
      mcpcfCapability: input.mcpcfCapability,
    }),
  )
}

export function buildIsolateMcpServerRegistrationsFromPlan(input: {
  plan: SessionToolRuntimePlan
  sessionId?: string | null
  stage?: StageMetadataInput | null
  mcpcfCapability?: string | null
}): RemoteCustomMcpServerRegistration[] {
  return [
    ...input.plan.mcpRegistration.remoteCustomMcpServers.map(
      buildRemoteCustomMcpServerRegistration,
    ),
    ...buildInternalMcpcfMcpServerRegistrationsFromPlan(input),
  ]
}

function stripSessionId(transportObject: Record<string, unknown>): Record<string, unknown> {
  const { sessionId: _, ...transport } = transportObject
  return transport
}

function normalizeStoredTransport(options: Record<string, unknown>): Record<string, unknown> {
  return Option.match(
    asRecord(options.transport).pipe(Option.filter((transport) => "sessionId" in transport)),
    {
      onNone: () => options,
      onSome: (transport) => ({
        ...options,
        transport: stripSessionId(transport),
      }),
    },
  )
}

function signatureFromStoredOptions(serverOptions: string): string {
  return Option.match(asRecord(parseJsonOrText(serverOptions)), {
    onNone: () => serverOptions,
    onSome: (options) => stableJson(normalizeStoredTransport(options)),
  })
}

function storedOptionsSignature(row: McpServerRow): string {
  return Option.match(Option.fromNullishOr(row.server_options), {
    onNone: () => stableJson({}),
    onSome: signatureFromStoredOptions,
  })
}

function expectedOptionsSignature(registration: RemoteCustomMcpServerRegistration): string {
  return stableJson({
    transport: registration.options.transport,
  })
}

function normalizeUrl(value: string): string {
  return Match.value(URL.canParse(value)).pipe(
    Match.when(true, () => new URL(value).href),
    Match.orElse(() => value),
  )
}

function storedServerMatches(
  row: McpServerRow,
  registration: RemoteCustomMcpServerRegistration,
): boolean {
  return (
    row.name === registration.name &&
    normalizeUrl(row.server_url) === normalizeUrl(registration.server.url) &&
    storedOptionsSignature(row) === expectedOptionsSignature(registration)
  )
}

function isReadyConnection(connection: McpConnection | undefined): boolean {
  return connection?.connectionState === "ready"
}

interface ExposureConnection {
  tools?: Array<{ name?: string }>
  connectionState?: string
  connectionError?: string | null
  serverCapabilities?: unknown
}

function rawToolNamesOf(connection: ExposureConnection | undefined): string[] {
  return Option.match(
    Option.liftPredicate(connection?.tools, (tools): tools is Array<{ name?: string }> =>
      Array.isArray(tools),
    ),
    {
      onNone: () => [],
      onSome: (tools) =>
        tools
          .map((entry) => entry.name)
          .filter((name): name is string => typeof name === "string" && name.length > 0)
          .sort((left, right) => left.localeCompare(right)),
    },
  )
}

export function createMcpcfMcpToolExposureReader(
  manager: McpcfMcpToolExposureManager,
): McpcfMcpToolExposureReader {
  return {
    getServerExposure(serverName) {
      const connection = manager.mcpConnections[serverName] as ExposureConnection | undefined
      return {
        rawToolNames: rawToolNamesOf(connection),
        connectionState: connection?.connectionState ?? null,
        connectionError: connection?.connectionError ?? null,
        serverCapabilities: connection?.serverCapabilities ?? null,
        toolNames: Object.keys(manager.getAITools({ serverId: serverName, state: "ready" })).sort(
          (left, right) => left.localeCompare(right),
        ),
      }
    },
  }
}

function isCustomMcpServerRow(row: McpServerRow): boolean {
  return isCustomMcpServerId(row.id)
}

function isManagedMcpServerRow(row: McpServerRow): boolean {
  return isCustomMcpServerRow(row) || isMcpcfMcpServerRow(row)
}

function removeServerAfterOptionalFailure(manager: IsolateMcpManager, serverId: string) {
  return attempt(() => manager.removeServer(serverId)).pipe(
    Effect.map(() => Option.none<string>()),
    Effect.catch((error) => Effect.succeed(Option.some(describeError(error)))),
  )
}

function connectStateError(
  connectResult: McpConnectionResult,
  registration: RemoteCustomMcpServerRegistration,
): Option.Option<string> {
  return Match.value(connectResult).pipe(
    Match.when({ state: "failed" }, (failed) =>
      Option.some(`Failed to connect remote MCP server '${registration.name}': ${failed.error}`),
    ),
    Match.when({ state: "authenticating" }, () =>
      Option.some(
        `Remote MCP server '${registration.name}' requires OAuth authorization before isolate sessions can use it`,
      ),
    ),
    Match.orElse(() => Option.none<string>()),
  )
}

function assertConnectState(
  connectResult: McpConnectionResult,
  registration: RemoteCustomMcpServerRegistration,
) {
  return Option.match(connectStateError(connectResult, registration), {
    onNone: () => Effect.void,
    onSome: (message) => Effect.fail(toError(message)),
  })
}

function discoveryTimeout(registration: RemoteCustomMcpServerRegistration): number {
  return Option.getOrElse(
    Option.liftPredicate(
      registration.server.timeout,
      (timeout): timeout is number => typeof timeout === "number" && Number.isFinite(timeout),
    ),
    () => DEFAULT_DISCOVERY_TIMEOUT_MS,
  )
}

function assertDiscoverResult(
  discoverResult: McpDiscoverResult,
  registration: RemoteCustomMcpServerRegistration,
) {
  return Option.match(
    Option.fromNullishOr(discoverResult).pipe(Option.filter((result) => !result.success)),
    {
      onNone: () => Effect.void,
      onSome: (result) =>
        Effect.fail(
          toError(
            `Failed to discover remote MCP server '${registration.name}': ${
              result.error ?? "unknown error"
            }`,
          ),
        ),
    },
  )
}

function discoverConnectedRemoteMcpServer(
  manager: IsolateMcpManager,
  registration: RemoteCustomMcpServerRegistration,
) {
  return Effect.gen(function* () {
    const discoverResult = yield* attempt(() =>
      manager.discoverIfConnected(registration.id, {
        timeoutMs: discoveryTimeout(registration),
      }),
    )
    yield* assertDiscoverResult(discoverResult, registration)
  })
}

function connectRegisteredRemoteMcpServer(
  manager: IsolateMcpManager,
  registration: RemoteCustomMcpServerRegistration,
) {
  return Effect.gen(function* () {
    const connectResult = yield* attempt(() => manager.connectToServer(registration.id))
    yield* assertConnectState(connectResult, registration)
    yield* discoverConnectedRemoteMcpServer(manager, registration)
  })
}

function reuseReadyRegistration(
  manager: IsolateMcpManager,
  registration: RemoteCustomMcpServerRegistration,
) {
  return Effect.gen(function* () {
    const shouldDiscover = Effect.succeed(registration.source === "mcpcf")
    yield* Effect.when(discoverConnectedRemoteMcpServer(manager, registration), shouldDiscover)
    return registration.name
  })
}

function registerAndConnect(
  manager: IsolateMcpManager,
  registration: RemoteCustomMcpServerRegistration,
) {
  return Effect.gen(function* () {
    yield* attempt(() => manager.registerServer(registration.id, registration.options))
    yield* connectRegisteredRemoteMcpServer(manager, registration)
    return registration.name
  })
}

function replaceAndConnect(
  manager: IsolateMcpManager,
  registration: RemoteCustomMcpServerRegistration,
) {
  return Effect.gen(function* () {
    yield* attempt(() => manager.removeServer(registration.id))
    return yield* registerAndConnect(manager, registration)
  })
}

function attemptRegistrationSync(
  manager: IsolateMcpManager,
  registration: RemoteCustomMcpServerRegistration,
  currentRow: McpServerRow | undefined,
) {
  const matches = currentRow !== undefined && storedServerMatches(currentRow, registration)
  const ready = matches && isReadyConnection(manager.mcpConnections[registration.id])
  return Match.value({ matches, ready }).pipe(
    Match.when({ ready: true }, () => reuseReadyRegistration(manager, registration)),
    Match.when({ matches: true }, () => replaceAndConnect(manager, registration)),
    Match.orElse(() => registerAndConnect(manager, registration)),
  )
}

function skippedServerError(error: string, cleanupError: Option.Option<string>): string {
  return Option.match(cleanupError, {
    onNone: () => error,
    onSome: (cleanup) => `${error}; cleanup failed: ${cleanup}`,
  })
}

function skipOptionalRegistration(
  manager: IsolateMcpManager,
  registration: RemoteCustomMcpServerRegistration,
  error: string,
) {
  return removeServerAfterOptionalFailure(manager, registration.id).pipe(
    Effect.map((cleanupError) => ({
      connectedName: Option.none<string>(),
      skipped: Option.some({
        name: registration.name,
        error: skippedServerError(error, cleanupError),
      }),
    })),
  )
}

function handleRegistrationSyncFailure(
  manager: IsolateMcpManager,
  registration: RemoteCustomMcpServerRegistration,
  errorValue: unknown,
) {
  const error = formatRegistrationError(errorValue, registration)
  return Match.value(registration.optional).pipe(
    Match.when(false, () =>
      Effect.fail(
        new IsolateMcpServerSyncError(
          error,
          registration,
          getRegistrationDiscoveryReason(errorValue, registration),
        ),
      ),
    ),
    Match.orElse(() => skipOptionalRegistration(manager, registration, error)),
  )
}

function connectedOutcome(connectedName: string): RegistrationSyncOutcome {
  return {
    connectedName: Option.some(connectedName),
    skipped: Option.none(),
  }
}

function applyRegistrationSync(
  manager: IsolateMcpManager,
  registration: RemoteCustomMcpServerRegistration,
  currentRow: McpServerRow | undefined,
) {
  return attemptRegistrationSync(manager, registration, currentRow).pipe(
    Effect.map(connectedOutcome),
    Effect.catch((errorValue) => handleRegistrationSyncFailure(manager, registration, errorValue)),
  )
}

export function syncIsolateCustomMcpServers(
  manager: IsolateMcpManager,
  customMcpServers: OpenCodeMcpServers | null | undefined,
) {
  return syncIsolateMcpServers(manager, { customMcpServers })
}

function shouldRemoveRow(
  row: McpServerRow,
  desiredById: Map<string, RemoteCustomMcpServerRegistration>,
): boolean {
  return Option.match(Option.fromNullishOr(desiredById.get(row.id)), {
    onNone: () => true,
    onSome: (registration) => !storedServerMatches(row, registration),
  })
}

export function syncIsolateMcpServers(
  manager: IsolateMcpManager,
  input: {
    customMcpServers?: OpenCodeMcpServers | null
    tools?: readonly SessionToolSpec[] | null
    mcpcfServers?: readonly McpcfServerDefinition[] | null
    sessionId?: string | null
    stage?: StageMetadataInput | null
    mcpcfCapability?: string | null
  },
) {
  return Effect.gen(function* () {
    const plan = buildSessionToolRuntimePlan({
      tools: input.tools,
      customMcpServers: input.customMcpServers,
      mcpcfServers: input.mcpcfServers,
    })
    const registrations = buildIsolateMcpServerRegistrationsFromPlan({
      plan,
      sessionId: input.sessionId,
      stage: input.stage,
      mcpcfCapability: input.mcpcfCapability,
    })
    const desiredById = new Map(
      registrations.map((registration) => [registration.id, registration] as const),
    )

    const rowsToRemove = manager
      .listServers()
      .filter(isManagedMcpServerRow)
      .filter((row) => shouldRemoveRow(row, desiredById))
    yield* Effect.forEach(rowsToRemove, (row) => attempt(() => manager.removeServer(row.id)), {
      discard: true,
    })

    const currentRowsById = new Map(
      manager
        .listServers()
        .filter(isManagedMcpServerRow)
        .map((row) => [row.id, row] as const),
    )
    const outcomes = yield* Effect.forEach(registrations, (registration) =>
      applyRegistrationSync(manager, registration, currentRowsById.get(registration.id)),
    )

    return {
      connectedServerNames: Arr.getSomes(outcomes.map((outcome) => outcome.connectedName)),
      skippedServers: Arr.getSomes(outcomes.map((outcome) => outcome.skipped)),
    }
  })
}
