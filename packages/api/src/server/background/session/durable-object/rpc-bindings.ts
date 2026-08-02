import {
  getGitHubRepoTool,
  normalizeSessionTools,
  type OpenCodeMcpServers,
  type SessionCallbackContext,
  type SessionKind,
} from "@c0-agent/shared"
import { type PromptExecutionMode, type SessionState } from "../../types"
import { type LocalSpanContext } from "../../observability/tracing"
import type { UpdateToolsBody } from "../durable-object"
import { type SessionRow } from "../types"
import {
  applyToolUpdate,
  attachRepoError,
  broadcastSessionState,
  commitToolUpdate,
  dispatchEnqueuedPrompt,
  enqueuePromptValidationError,
  enqueueValidatedPrompt,
  existingRepoChangeError,
  handleEnqueuePrompt,
  handleGetState,
  handleInit,
  handleResumePrompt,
  handleUpdateTools,
  logAsyncPromptQueueError,
  repoChangeError,
  resolveParticipantByUserId,
  serializeSandbox,
  serializeSessionState,
  startAwaitedQueuedPrompt,
  startBackgroundQueuedPrompt,
  startQueuedPrompt,
  startStreamedPrompt,
  syncRuntimeForKind,
  syncToolingRuntime,
  updateToolsForSession,
  updateToolsForUser,
  warmRuntimeForKind,
} from "./rpc"

export function installSessionDORpcBindings(SessionDO: { prototype: Record<string, unknown> }) {
  Object.assign(SessionDO.prototype, {
    handleInit(request: Request) {
      return handleInit(this, request)
    },
    warmRuntimeForKind(sessionKind: SessionKind) {
      return warmRuntimeForKind(this, sessionKind)
    },
    handleGetState() {
      return handleGetState(this)
    },
    serializeSessionState(state: SessionState) {
      return serializeSessionState(this, state)
    },
    serializeSandbox() {
      return serializeSandbox(this)
    },
    handleEnqueuePrompt(request: Request, options: { waitForCompletion?: boolean } = {}) {
      return handleEnqueuePrompt(this, request, options)
    },
    enqueuePromptValidationError(executionMode: PromptExecutionMode) {
      return enqueuePromptValidationError(this, executionMode)
    },
    enqueueValidatedPrompt(
      request: Request,
      body: {
        content: string
        authorId: string
        source: string
        model?: string
        reasoningEffort?: string
        executionMode?: PromptExecutionMode
        attachments?: Array<{ type: string; name: string; url?: string }>
        callbackContext?: SessionCallbackContext
      },
      executionMode: PromptExecutionMode,
      options: { waitForCompletion?: boolean },
    ) {
      return enqueueValidatedPrompt(this, request, body, executionMode, options)
    },
    resolveParticipantByUserId(userId: string) {
      return resolveParticipantByUserId(this, userId)
    },
    dispatchEnqueuedPrompt(
      executionMode: PromptExecutionMode,
      options: { waitForCompletion?: boolean },
      messageId: string,
      localParentContext: LocalSpanContext | undefined,
    ) {
      return dispatchEnqueuedPrompt(this, executionMode, options, messageId, localParentContext)
    },
    startStreamedPrompt(messageId: string, localParentContext: LocalSpanContext | undefined) {
      return startStreamedPrompt(this, messageId, localParentContext)
    },
    startQueuedPrompt(
      options: { waitForCompletion?: boolean },
      messageId: string,
      localParentContext: LocalSpanContext | undefined,
    ) {
      return startQueuedPrompt(this, options, messageId, localParentContext)
    },
    startBackgroundQueuedPrompt(
      messageId: string,
      localParentContext: LocalSpanContext | undefined,
    ) {
      return startBackgroundQueuedPrompt(this, messageId, localParentContext)
    },
    startAwaitedQueuedPrompt(messageId: string, localParentContext: LocalSpanContext | undefined) {
      return startAwaitedQueuedPrompt(this, messageId, localParentContext)
    },
    logAsyncPromptQueueError(errorValue: unknown) {
      return logAsyncPromptQueueError(this, errorValue)
    },
    handleResumePrompt(request: Request) {
      return handleResumePrompt(this, request)
    },
    handleUpdateTools(request: Request) {
      return handleUpdateTools(this, request)
    },
    updateToolsForUser(userId: string, body: UpdateToolsBody) {
      return updateToolsForUser(this, userId, body)
    },
    updateToolsForSession(body: UpdateToolsBody) {
      return updateToolsForSession(this, body)
    },
    applyToolUpdate(session: SessionRow, body: UpdateToolsBody) {
      return applyToolUpdate(this, session, body)
    },
    repoChangeError(session: SessionRow, requestedRepo: ReturnType<typeof getGitHubRepoTool>) {
      return repoChangeError(this, session, requestedRepo)
    },
    existingRepoChangeError(
      current: { repoOwner: string; repoName: string },
      requestedRepo: ReturnType<typeof getGitHubRepoTool>,
    ) {
      return existingRepoChangeError(this, current, requestedRepo)
    },
    attachRepoError(requestedRepo: ReturnType<typeof getGitHubRepoTool>) {
      return attachRepoError(this, requestedRepo)
    },
    commitToolUpdate(
      session: SessionRow,
      body: UpdateToolsBody,
      requestedTools: ReturnType<typeof normalizeSessionTools>,
      requestedCustomMcpServers: OpenCodeMcpServers,
    ) {
      return commitToolUpdate(this, session, body, requestedTools, requestedCustomMcpServers)
    },
    syncToolingRuntime(session: SessionRow) {
      return syncToolingRuntime(this, session)
    },
    syncRuntimeForKind(session: SessionRow) {
      return syncRuntimeForKind(this, session)
    },
    broadcastSessionState() {
      return broadcastSessionState(this)
    },
  })
}
