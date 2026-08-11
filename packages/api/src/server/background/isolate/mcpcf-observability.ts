import {
  getSelectedMcpcfServerIds,
  type McpcfServerDefinition,
  type SessionToolSpec,
} from "@solzero/shared"
import type { IsolateMcpcfMcpPromptServer } from "../session/isolate/system"
import { getMcpcfMcpServerName } from "../session/mcp-config"
import { IsolateMcpServerSyncError, type McpcfMcpToolExposureReader } from "./mcp"

interface McpcfRequestLog {
  set(event: Record<string, unknown>): void
  emit(event: Record<string, unknown>): void
  error(error: Error, event?: Record<string, unknown>): void
}

interface McpcfRequestObserver {
  log: McpcfRequestLog
  setUserId(userId: string): void
}

interface McpcfRuntimeLogContext {
  sessionId: string
  userId: string
  repoOwner?: string | null
  repoName?: string | null
}

export interface McpcfPromptRequestLogContext {
  content: string
  model: string
  reasoningEffort?: string
}

export interface McpcfMcpToolExposure extends IsolateMcpcfMcpPromptServer {
  serverId: string
  slug: string
  upstreamToolCount: number
  rawToolNames: string[]
  connectionState: string | null
  connectionError: string | null
  serverCapabilities: unknown
}

export function getSelectedMcpcfLogContext(
  tools: readonly SessionToolSpec[],
  mcpcfServers: readonly McpcfServerDefinition[] = [],
) {
  const serversById = new Map(mcpcfServers.map((server) => [server.id, server]))
  const servers = getSelectedMcpcfServerIds(tools).map((serverId) => {
    const server = serversById.get(serverId)
    return {
      id: serverId,
      slug: server?.slug ?? null,
      label: server?.label ?? serverId,
    }
  })

  return {
    serverCount: servers.length,
    servers,
  }
}

export function getMcpcfMcpToolExposures(input: {
  reader: McpcfMcpToolExposureReader
  selectedTools: readonly SessionToolSpec[]
  mcpcfServers: readonly McpcfServerDefinition[]
  connectedServerNames: readonly string[]
}): McpcfMcpToolExposure[] {
  const connectedServerNames = new Set(input.connectedServerNames)
  const selectedIds = new Set(getSelectedMcpcfServerIds(input.selectedTools))

  return input.mcpcfServers
    .filter((server) => selectedIds.has(server.id))
    .flatMap((server) => {
      const serverName = getMcpcfMcpServerName(server)
      if (!connectedServerNames.has(serverName)) {
        return []
      }

      const exposure = input.reader.getServerExposure(serverName)

      return [
        {
          serverId: server.id,
          slug: server.slug,
          label: server.label,
          serverName,
          description: server.description,
          upstreamToolCount: exposure.rawToolNames.length,
          rawToolNames: exposure.rawToolNames,
          connectionState: exposure.connectionState,
          connectionError: exposure.connectionError,
          serverCapabilities: exposure.serverCapabilities,
          toolNames: exposure.toolNames,
        },
      ]
    })
}

export function logMcpcfMcpToolExposure(input: {
  createObserver: (path: string, routeBranch: string) => McpcfRequestObserver
  runtime: McpcfRuntimeLogContext
  request: McpcfPromptRequestLogContext
  selectedTools: readonly SessionToolSpec[]
  mcpcfServers: readonly McpcfServerDefinition[]
  connectedServerNames: readonly string[]
  exposures: readonly McpcfMcpToolExposure[]
}): void {
  const mcpcf = getSelectedMcpcfLogContext(input.selectedTools, input.mcpcfServers)
  if (mcpcf.serverCount === 0) {
    return
  }

  const observer = input.createObserver("mcpcf_mcp_tools", "isolate-mcpcf-mcp-tools")
  observer.setUserId(input.runtime.userId)
  observer.log.set({
    event: "isolate.mcpcf.mcp_tools.available",
    status: 200,
    boundary: "mcp.mcpcf.tool_exposure",
    isolate: {
      sessionId: input.runtime.sessionId,
      userId: input.runtime.userId,
      promptLength: input.request.content.length,
      model: input.request.model,
      reasoningEffort: input.request.reasoningEffort ?? null,
    },
    mcpcf: {
      ...mcpcf,
      exposures: input.exposures.map((server) => ({
        id: server.serverId,
        slug: server.slug,
        label: server.label,
        mcpServerName: server.serverName,
        connectionState: server.connectionState,
        connectionError: server.connectionError,
        serverCapabilities: server.serverCapabilities,
        upstreamToolCount: server.upstreamToolCount,
        upstreamToolNames: server.rawToolNames,
        callableToolCount: server.toolNames.length,
        callableToolNames: server.toolNames,
      })),
    },
    mcp: {
      connectedServerNames: input.connectedServerNames,
    },
  })
}

export function logMcpcfMcpToolExposureFailure(input: {
  createObserver: (path: string, routeBranch: string) => McpcfRequestObserver
  runtime: McpcfRuntimeLogContext
  error: Error
  request: McpcfPromptRequestLogContext
  selectedTools: readonly SessionToolSpec[]
  mcpcfServers: readonly McpcfServerDefinition[]
  connectedServerNames: readonly string[]
  exposures: readonly McpcfMcpToolExposure[]
}): void {
  const mcpcf = getSelectedMcpcfLogContext(input.selectedTools, input.mcpcfServers)
  const observer = input.createObserver("mcpcf_mcp_tools", "isolate-mcpcf-mcp-tools")
  observer.log.error(input.error, {
    event: "isolate.mcpcf.mcp_tools.unavailable",
    boundary: "mcp.mcpcf.tool_exposure",
    isolate: {
      sessionId: input.runtime.sessionId,
      userId: input.runtime.userId,
      promptLength: input.request.content.length,
      model: input.request.model,
      reasoningEffort: input.request.reasoningEffort ?? null,
    },
    mcpcf: {
      ...mcpcf,
      exposures: input.exposures.map((server) => ({
        id: server.serverId,
        slug: server.slug,
        label: server.label,
        mcpServerName: server.serverName,
        connectionState: server.connectionState,
        connectionError: server.connectionError,
        serverCapabilities: server.serverCapabilities,
        upstreamToolCount: server.upstreamToolCount,
        upstreamToolNames: server.rawToolNames,
        callableToolCount: server.toolNames.length,
      })),
    },
    mcp: {
      connectedServerNames: input.connectedServerNames,
    },
  })
}

export function logMcpcfMcpSyncFailure(input: {
  createObserver: (path: string, routeBranch: string) => McpcfRequestObserver
  runtime: McpcfRuntimeLogContext
  errorValue: unknown
  selectedTools: readonly SessionToolSpec[]
  mcpcfServers: readonly McpcfServerDefinition[]
  request: McpcfPromptRequestLogContext
}): void {
  const error =
    input.errorValue instanceof Error ? input.errorValue : new Error(String(input.errorValue))
  const mcpcf = getSelectedMcpcfLogContext(input.selectedTools, input.mcpcfServers)
  const observer = input.createObserver("mcpcf_mcp_sync", "isolate-mcpcf-mcp-sync")
  observer.log.error(error, {
    event: "isolate.mcpcf.mcp_sync.failed",
    boundary: "mcp.mcpcf.isolate_sync",
    isolate: {
      sessionId: input.runtime.sessionId,
      userId: input.runtime.userId,
      repoOwner: input.runtime.repoOwner || null,
      repoName: input.runtime.repoName || null,
      promptLength: input.request.content.length,
      model: input.request.model,
      reasoningEffort: input.request.reasoningEffort ?? null,
    },
    mcpcf,
    mcp: {
      serverName:
        input.errorValue instanceof IsolateMcpServerSyncError
          ? input.errorValue.serverName
          : "mcpcf",
      registrationMode: "internal_proxy",
      url:
        input.errorValue instanceof IsolateMcpServerSyncError ? input.errorValue.serverUrl : null,
    },
  })
}
