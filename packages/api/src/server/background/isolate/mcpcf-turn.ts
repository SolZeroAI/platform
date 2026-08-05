import type { StreamCallback } from "@cloudflare/think"
import {
  type McpDiscoveryErrorReason,
  type McpcfServerDefinition,
  type OpenCodeMcpServers,
  type StageMetadataInput,
  type SessionToolSpec,
} from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { issueMcpcfProxyCapability } from "../auth/mcpcf-capability"
import { describeError, toError } from "../../lib/effect-errors"
import { stringifyJson } from "../../lib/json"
import { resolveSelectedMcpcfServers } from "../session/runtime-mcp"
import type { Env } from "../types"
import {
  createMcpcfMcpToolExposureReader,
  formatMcpcfMcpSyncError,
  isMcpcfMcpSyncError,
  syncIsolateMcpServers,
  type IsolateMcpManager,
  type IsolateMcpServerSyncError,
  type McpcfMcpToolExposureManager,
  type McpcfMcpToolExposureReader,
} from "./mcp"
import {
  getMcpcfMcpToolExposures,
  getSelectedMcpcfLogContext,
  logMcpcfMcpSyncFailure,
  logMcpcfMcpToolExposure,
  logMcpcfMcpToolExposureFailure,
  type McpcfPromptRequestLogContext,
} from "./mcpcf-observability"
import type { IsolateMcpcfMcpPromptServer } from "../session/isolate/system"

interface McpcfRequestLog {
  set(event: Record<string, unknown>): void
  emit(event: Record<string, unknown>): void
  error(error: Error, event?: Record<string, unknown>): void
}

interface McpcfRequestObserver {
  log: McpcfRequestLog
  setUserId(userId: string): void
}

interface IsolateMcpTurnRuntime {
  sessionId: string
  userId: string
  repoOwner: string
  repoName: string
}

export type IsolateMcpTurnManager = IsolateMcpManager & McpcfMcpToolExposureManager
type CreateObserver = (path: string, routeBranch: string) => McpcfRequestObserver

export interface IsolateMcpTurnPreparation {
  connectedServerNames: string[]
  mcpcfMcpServers: IsolateMcpcfMcpPromptServer[]
}

interface ResolveMcpcfServersInput {
  env: Env
  selectedTools: readonly SessionToolSpec[]
  createObserver: CreateObserver
  runtime: IsolateMcpTurnRuntime
  request: McpcfPromptRequestLogContext
  callback?: StreamCallback
}

interface SyncMcpServersInput {
  manager: IsolateMcpManager
  customMcpServers: OpenCodeMcpServers | null | undefined
  selectedTools: readonly SessionToolSpec[]
  mcpcfServers: readonly McpcfServerDefinition[]
  mcpcfCapability?: string | null
  runtime: IsolateMcpTurnRuntime
  stage: StageMetadataInput
  createObserver: CreateObserver
  request: McpcfPromptRequestLogContext
  callback?: StreamCallback
}

interface AssertExposureInput {
  reader: McpcfMcpToolExposureReader
  selectedTools: readonly SessionToolSpec[]
  mcpcfServers: readonly McpcfServerDefinition[]
  connectedServerNames: readonly string[]
  createObserver: CreateObserver
  runtime: IsolateMcpTurnRuntime
  request: McpcfPromptRequestLogContext
  callback?: StreamCallback
}

function attempt<A>(thunk: () => Promise<A>) {
  return Effect.tryPromise({ try: thunk, catch: toError })
}

function terminalFlag(terminal: boolean | undefined): Record<string, true> {
  return Option.match(
    Option.liftPredicate(terminal, (value) => value === true),
    {
      onNone: () => ({}),
      onSome: () => ({ terminal: true }),
    },
  )
}

function discoveryReasonFlag(
  reason: McpDiscoveryErrorReason | undefined,
): Record<string, McpDiscoveryErrorReason> {
  return Option.match(Option.fromNullishOr(reason), {
    onNone: () => ({}),
    onSome: (resolved) => ({ discoveryReason: resolved }),
  })
}

function emitDiscoveryError(
  callback: StreamCallback | undefined,
  input: {
    serverName: string
    error: string
    terminal?: boolean
    discoveryReason?: McpDiscoveryErrorReason
  },
) {
  return attempt(
    () =>
      callback?.onEvent(
        stringifyJson({
          type: "mcp_discovery_error",
          serverName: input.serverName,
          error: input.error,
          ...terminalFlag(input.terminal),
          ...discoveryReasonFlag(input.discoveryReason),
        }),
      ) ?? Promise.resolve(),
  )
}

function handleMcpcfResolveFailure(input: ResolveMcpcfServersInput, errorValue: unknown) {
  const error = describeError(errorValue)
  return Effect.gen(function* () {
    logMcpcfMcpSyncFailure({
      createObserver: input.createObserver,
      runtime: input.runtime,
      errorValue,
      selectedTools: input.selectedTools,
      mcpcfServers: [],
      request: input.request,
    })
    yield* emitDiscoveryError(input.callback, {
      serverName: "MCP Context Forge",
      error,
      terminal: true,
      discoveryReason: "server_unavailable",
    })
    return yield* Effect.fail(toError(error))
  })
}

function resolveMcpcfServers(input: ResolveMcpcfServersInput) {
  return resolveSelectedMcpcfServers({ env: input.env, tools: input.selectedTools }).pipe(
    Effect.catch((errorValue) => handleMcpcfResolveFailure(input, errorValue)),
  )
}

function reportMcpcfSyncFailure(input: SyncMcpServersInput, syncError: IsolateMcpServerSyncError) {
  const error = formatMcpcfMcpSyncError(syncError)
  return Effect.gen(function* () {
    logMcpcfMcpSyncFailure({
      createObserver: input.createObserver,
      runtime: input.runtime,
      errorValue: syncError,
      selectedTools: input.selectedTools,
      mcpcfServers: input.mcpcfServers,
      request: input.request,
    })
    yield* emitDiscoveryError(input.callback, {
      serverName: "MCP Context Forge",
      error,
      terminal: true,
      discoveryReason: syncError.discoveryReason,
    })
    return yield* Effect.fail(toError(error))
  })
}

function handleMcpcfSyncFailure(input: SyncMcpServersInput, errorValue: Error) {
  return Option.match(Option.liftPredicate(errorValue, isMcpcfMcpSyncError), {
    onNone: () => Effect.fail(errorValue),
    onSome: (syncError) => reportMcpcfSyncFailure(input, syncError),
  })
}

function syncMcpServers(input: SyncMcpServersInput) {
  return syncIsolateMcpServers(input.manager, {
    customMcpServers: input.customMcpServers,
    tools: input.selectedTools,
    mcpcfServers: input.mcpcfServers,
    sessionId: input.runtime.sessionId,
    stage: input.stage,
    mcpcfCapability: input.mcpcfCapability,
  }).pipe(Effect.catch((errorValue) => handleMcpcfSyncFailure(input, errorValue)))
}

function emitSkippedServersLog(
  skippedServers: Array<{ name: string; error: string }>,
  createObserver: CreateObserver,
  runtime: IsolateMcpTurnRuntime,
): void {
  const observer = createObserver("optional_mcp_sync", "isolate-optional-mcp-sync")
  observer.setUserId(runtime.userId)
  observer.log.emit({
    event: "isolate.optional_mcp.skipped",
    status: 200,
    isolate: {
      sessionId: runtime.sessionId,
      userId: runtime.userId,
    },
    mcp: {
      skippedServers,
    },
  })
}

function emitSkippedMcpServers(
  callback: StreamCallback | undefined,
  skippedServers: Array<{ name: string; error: string }>,
  createObserver: CreateObserver,
  runtime: IsolateMcpTurnRuntime,
) {
  return Effect.gen(function* () {
    Match.value(skippedServers.length > 0).pipe(
      Match.when(true, () => emitSkippedServersLog(skippedServers, createObserver, runtime)),
      Match.orElse(() => undefined),
    )
    yield* Effect.forEach(
      skippedServers,
      (skippedServer) =>
        emitDiscoveryError(callback, {
          serverName: skippedServer.name,
          error: skippedServer.error,
        }),
      { discard: true },
    )
  })
}

function unavailableExposureServers(
  exposures: ReturnType<typeof getMcpcfMcpToolExposures>,
  fallbackServers: ReturnType<typeof getSelectedMcpcfLogContext>["servers"],
) {
  return Match.value(exposures.length === 0).pipe(
    Match.when(true, () => fallbackServers),
    Match.orElse(() => exposures.filter((server) => server.toolNames.length === 0)),
  )
}

function labelServerName(labels: string[]): string {
  return Match.value(labels.length === 1).pipe(
    Match.when(true, () => labels[0]),
    Match.orElse(() => "MCP Context Forge"),
  )
}

function failMcpcfExposure(
  input: AssertExposureInput,
  exposures: ReturnType<typeof getMcpcfMcpToolExposures>,
  unavailableServers: ReturnType<typeof unavailableExposureServers>,
) {
  const labels = unavailableServers.map((server) => server.label)
  const error = `MCP Context Forge MCP connected but exposed no callable tools for ${labels.join(
    ", ",
  )}.`
  return Effect.gen(function* () {
    logMcpcfMcpToolExposureFailure({
      createObserver: input.createObserver,
      runtime: input.runtime,
      error: new Error(error),
      request: input.request,
      selectedTools: input.selectedTools,
      mcpcfServers: input.mcpcfServers,
      connectedServerNames: input.connectedServerNames,
      exposures,
    })
    yield* emitDiscoveryError(input.callback, {
      serverName: labelServerName(labels),
      error,
      terminal: true,
      discoveryReason: "no_callable_tools",
    })
    return yield* Effect.fail(toError(error))
  })
}

function evaluateMcpcfExposures(input: AssertExposureInput) {
  return Effect.gen(function* () {
    const exposures = getMcpcfMcpToolExposures({
      reader: input.reader,
      selectedTools: input.selectedTools,
      mcpcfServers: input.mcpcfServers,
      connectedServerNames: input.connectedServerNames,
    })
    logMcpcfMcpToolExposure({
      createObserver: input.createObserver,
      runtime: input.runtime,
      request: input.request,
      selectedTools: input.selectedTools,
      mcpcfServers: input.mcpcfServers,
      connectedServerNames: input.connectedServerNames,
      exposures,
    })

    const mcpcf = getSelectedMcpcfLogContext(input.selectedTools, input.mcpcfServers)
    const unavailableServers = unavailableExposureServers(exposures, mcpcf.servers)
    return yield* Match.value(unavailableServers.length === 0).pipe(
      Match.when(true, () => Effect.succeed(exposures)),
      Match.orElse(() => failMcpcfExposure(input, exposures, unavailableServers)),
    )
  })
}

function assertMcpcfToolsExposed(input: AssertExposureInput) {
  return Match.value(input.mcpcfServers.length === 0).pipe(
    Match.when(true, () => Effect.succeed<IsolateMcpcfMcpPromptServer[]>([])),
    Match.orElse(() => evaluateMcpcfExposures(input)),
  )
}

function generateMcpcfProxyCapability(env: Env, sessionId: string) {
  return attempt(() => issueMcpcfProxyCapability(env.MCPCF_PROXY_SIGNING_SECRET, sessionId))
}

function capabilityOption(env: Env, sessionId: string) {
  return Effect.map(generateMcpcfProxyCapability(env, sessionId), Option.some)
}

function resolveMcpcfCapability(
  env: Env,
  sessionId: string,
  mcpcfServers: readonly McpcfServerDefinition[],
) {
  return Option.match(
    Option.liftPredicate(mcpcfServers, (servers) => servers.length > 0),
    {
      onNone: () => Effect.succeed(Option.none<string>()),
      onSome: () => capabilityOption(env, sessionId),
    },
  )
}

export function prepareIsolateMcpTurn(input: {
  env: Env
  manager: IsolateMcpTurnManager
  customMcpServers: OpenCodeMcpServers | null | undefined
  selectedTools: readonly SessionToolSpec[]
  createObserver: CreateObserver
  runtime: IsolateMcpTurnRuntime
  request: McpcfPromptRequestLogContext
  callback?: StreamCallback
}) {
  return Effect.gen(function* () {
    const mcpcfServers = yield* resolveMcpcfServers(input)
    const mcpcfCapability = yield* resolveMcpcfCapability(
      input.env,
      input.runtime.sessionId,
      mcpcfServers,
    )
    const mcpSync = yield* syncMcpServers({
      manager: input.manager,
      customMcpServers: input.customMcpServers,
      selectedTools: input.selectedTools,
      mcpcfServers,
      mcpcfCapability: Option.getOrNull(mcpcfCapability),
      runtime: input.runtime,
      stage: input.env,
      createObserver: input.createObserver,
      request: input.request,
      callback: input.callback,
    })
    yield* emitSkippedMcpServers(
      input.callback,
      mcpSync.skippedServers,
      input.createObserver,
      input.runtime,
    )
    const mcpcfMcpServers = yield* assertMcpcfToolsExposed({
      reader: createMcpcfMcpToolExposureReader(input.manager),
      selectedTools: input.selectedTools,
      mcpcfServers,
      connectedServerNames: mcpSync.connectedServerNames,
      createObserver: input.createObserver,
      runtime: input.runtime,
      request: input.request,
      callback: input.callback,
    })

    return {
      connectedServerNames: mcpSync.connectedServerNames,
      mcpcfMcpServers,
    }
  })
}
