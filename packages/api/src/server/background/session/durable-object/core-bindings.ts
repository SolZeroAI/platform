import {
  type AgentRuntime,
  type OpenCodeMcpServers,
  type SessionKind,
  type SessionToolSpec,
} from "@solzero/shared"
import { type Attachment, type PromptExecutionMode, type SandboxEvent } from "../../types"
import { type SessionRow } from "../types"
import {
  alarm,
  createInternalRequestObserver,
  emitDroppedSandboxEventLog,
  ensureInitialized,
  handleIsolateInactivityAlarm,
  initializeStorage,
  logClientWebSocketAuthFailure,
  logDroppedSandboxEvent,
  logIsolateStopFailure,
  logMessageQueueFailure,
  logPromptStopped,
  maybeStopInactiveSandbox,
  routeRequest,
  stopInactiveSandbox,
} from "./core"

export function installSessionDOCoreBindings(SessionDO: { prototype: Record<string, unknown> }) {
  Object.assign(SessionDO.prototype, {
    createInternalRequestObserver(path: string, routeBranch: string) {
      return createInternalRequestObserver(this, path, routeBranch)
    },
    logMessageQueueFailure(input: {
      errorValue: unknown
      errorMessage: string
      sessionKind: SessionKind
      session: SessionRow | null
      userId: string | null
      message: {
        id: string
        content: string
        model: string | null
        reasoning_effort: string | null
        execution_mode: PromptExecutionMode
      }
      resolvedModel: string
      resolvedReasoningEffort: string | null
      attachments: Attachment[] | undefined
      tools: readonly SessionToolSpec[]
      customMcpServers: OpenCodeMcpServers
    }) {
      return logMessageQueueFailure(this, input)
    },
    logPromptStopped(input: {
      sessionKind: SessionKind
      agentRuntime: AgentRuntime
      userId: string | null
      messageId: string
      runtimeId: string
    }) {
      return logPromptStopped(this, input)
    },
    logIsolateStopFailure(input: {
      errorValue: unknown
      userId: string | null
      messageId: string
      runtimeId: string
    }) {
      return logIsolateStopFailure(this, input)
    },
    logDroppedSandboxEvent(input: { event: SandboxEvent; messageStatus: string | null }) {
      return logDroppedSandboxEvent(this, input)
    },
    emitDroppedSandboxEventLog(input: { event: SandboxEvent; messageStatus: string | null }) {
      return emitDroppedSandboxEventLog(this, input)
    },
    logClientWebSocketAuthFailure(input: {
      reason: "missing_token" | "invalid_or_expired_token"
      clientId?: string | null
      tokenPresent: boolean
      wsId?: string | null
    }) {
      return logClientWebSocketAuthFailure(this, input)
    },
    ensureInitialized() {
      return ensureInitialized(this)
    },
    initializeStorage() {
      return initializeStorage(this)
    },
    routeRequest(request: Request, url: URL) {
      return routeRequest(this, request, url)
    },
    alarm() {
      return alarm(this)
    },
    handleIsolateInactivityAlarm() {
      return handleIsolateInactivityAlarm(this)
    },
    maybeStopInactiveSandbox(lastActivity: number | null) {
      return maybeStopInactiveSandbox(this, lastActivity)
    },
    stopInactiveSandbox() {
      return stopInactiveSandbox(this)
    },
  })
}
