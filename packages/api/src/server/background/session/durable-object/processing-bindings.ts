import type { OpenCodeInteractionRequest, OpenCodeInteractionResponse } from "@c0-agent/shared"
import { type ClientInfo, type SandboxEvent, type ServerMessage } from "../../types"
import { type LocalSpanContext } from "../../observability/tracing"
import type {
  ExecutionCompleteSandboxEvent,
  IsolateStreamState,
  QueuedMessageContext,
  TokenSandboxEvent,
} from "../durable-object"
import { type MessageRow, type ParticipantRow } from "../types"
import {
  applyPromptFailure,
  applyStreamDelta,
  broadcast,
  buildQueuedMessageContext,
  canProcessQueue,
  clearTerminalDiscoveryEffect,
  completeExecution,
  completeExecutionIfMessage,
  completeIsolatePrompt,
  completionStatus,
  droppedEventMessageStatus,
  dropStatusForMessage,
  emitPromptErrorEvent,
  ensureIsolateReadySpan,
  ensureRuntimeReady,
  ensureSandboxEffect,
  failNonSandboxRuntime,
  finalizeExecutionStream,
  handlePromptFailure,
  logIsolateStopFailureEffect,
  maybeCompleteExecution,
  maybeCompleteIsolatePrompt,
  maybeWriteStreamDelta,
  messageSpanAttributes,
  nextQueuedMessage,
  persistSandboxEvent,
  processMessageQueue,
  processNonHeartbeatEvent,
  processQueuedMessage,
  processQueuedMessageEffect,
  processSandboxEvent,
  promptFailureMessage,
  recordHeartbeat,
  reportNonSandboxFailure,
  reportPromptFailure,
  rejectPendingRuntimeInteractionsForMessage,
  requestRuntimeInteraction,
  resolveRuntimeInteraction,
  resolveStopRuntimeId,
  runIsolatePrompt,
  runIsolatePromptEvents,
  runPromptExecution,
  runQueuedMessage,
  runSandboxPrompt,
  runSandboxPromptEffect,
  stopExecution,
  stopIsolatePromptEffect,
  stopIsolateRuntime,
  stopProcessingMessage,
  stopRuntimeExecution,
  streamForMessage,
  writeTokenDelta,
} from "./processing"

export function installSessionDOProcessingBindings(SessionDO: {
  prototype: Record<string, unknown>
}) {
  Object.assign(SessionDO.prototype, {
    processMessageQueue(parentContext?: LocalSpanContext) {
      return processMessageQueue(this, parentContext)
    },
    canProcessQueue() {
      return canProcessQueue(this)
    },
    nextQueuedMessage() {
      return nextQueuedMessage(this)
    },
    runQueuedMessage(message: MessageRow, parentContext?: LocalSpanContext) {
      return runQueuedMessage(this, message, parentContext)
    },
    buildQueuedMessageContext(message: MessageRow) {
      return buildQueuedMessageContext(this, message)
    },
    messageSpanAttributes(ctx: QueuedMessageContext) {
      return messageSpanAttributes(this, ctx)
    },
    processQueuedMessage(message: MessageRow, parentContext?: LocalSpanContext) {
      return processQueuedMessage(this, message, parentContext)
    },
    processQueuedMessageEffect(ctx: QueuedMessageContext) {
      return processQueuedMessageEffect(this, ctx)
    },
    ensureRuntimeReady(ctx: QueuedMessageContext) {
      return ensureRuntimeReady(this, ctx)
    },
    ensureSandboxEffect() {
      return ensureSandboxEffect(this)
    },
    ensureIsolateReadySpan(ctx: QueuedMessageContext) {
      return ensureIsolateReadySpan(this, ctx)
    },
    runPromptExecution(ctx: QueuedMessageContext) {
      return runPromptExecution(this, ctx)
    },
    runSandboxPrompt(ctx: QueuedMessageContext) {
      return runSandboxPrompt(this, ctx)
    },
    runSandboxPromptEffect(ctx: QueuedMessageContext) {
      return runSandboxPromptEffect(this, ctx)
    },
    requestRuntimeInteraction(request: OpenCodeInteractionRequest) {
      return requestRuntimeInteraction(this, request)
    },
    resolveRuntimeInteraction(client: ClientInfo, response: OpenCodeInteractionResponse) {
      return resolveRuntimeInteraction(this, client, response)
    },
    rejectPendingRuntimeInteractionsForMessage(messageId: string, reason: string) {
      return rejectPendingRuntimeInteractionsForMessage(this, messageId, reason)
    },
    runIsolatePrompt(ctx: QueuedMessageContext) {
      return runIsolatePrompt(this, ctx)
    },
    runIsolatePromptEvents(ctx: QueuedMessageContext) {
      return runIsolatePromptEvents(this, ctx)
    },
    maybeCompleteIsolatePrompt(ctx: QueuedMessageContext, result: { runtimeId: string }) {
      return maybeCompleteIsolatePrompt(this, ctx, result)
    },
    completeIsolatePrompt(ctx: QueuedMessageContext, result: { runtimeId: string }) {
      return completeIsolatePrompt(this, ctx, result)
    },
    handlePromptFailure(ctx: QueuedMessageContext, errorValue: unknown) {
      return handlePromptFailure(this, ctx, errorValue)
    },
    clearTerminalDiscoveryEffect(messageId: string) {
      return clearTerminalDiscoveryEffect(this, messageId)
    },
    promptFailureMessage(errorValue: unknown, isArchived: boolean) {
      return promptFailureMessage(this, errorValue, isArchived)
    },
    applyPromptFailure(ctx: QueuedMessageContext, errorValue: unknown, isArchived: boolean) {
      return applyPromptFailure(this, ctx, errorValue, isArchived)
    },
    reportPromptFailure(ctx: QueuedMessageContext, errorValue: unknown, errorMessage: string) {
      return reportPromptFailure(this, ctx, errorValue, errorMessage)
    },
    reportNonSandboxFailure(ctx: QueuedMessageContext, errorMessage: string) {
      return reportNonSandboxFailure(this, ctx, errorMessage)
    },
    failNonSandboxRuntime(ctx: QueuedMessageContext, errorMessage: string) {
      return failNonSandboxRuntime(this, ctx, errorMessage)
    },
    emitPromptErrorEvent(ctx: QueuedMessageContext, errorMessage: string) {
      return emitPromptErrorEvent(this, ctx, errorMessage)
    },
    processSandboxEvent(event: SandboxEvent) {
      return processSandboxEvent(this, event)
    },
    recordHeartbeat(now: number) {
      return recordHeartbeat(this, now)
    },
    processNonHeartbeatEvent(event: SandboxEvent, now: number) {
      return processNonHeartbeatEvent(this, event, now)
    },
    droppedEventMessageStatus(event: SandboxEvent) {
      return droppedEventMessageStatus(this, event)
    },
    dropStatusForMessage(event: SandboxEvent, message: MessageRow | null) {
      return dropStatusForMessage(this, event, message)
    },
    persistSandboxEvent(event: SandboxEvent, now: number) {
      return persistSandboxEvent(this, event, now)
    },
    maybeWriteStreamDelta(event: SandboxEvent) {
      return maybeWriteStreamDelta(this, event)
    },
    writeTokenDelta(event: TokenSandboxEvent) {
      return writeTokenDelta(this, event)
    },
    streamForMessage(messageId: string | undefined) {
      return streamForMessage(this, messageId)
    },
    applyStreamDelta(stream: IsolateStreamState, nextText: string) {
      return applyStreamDelta(this, stream, nextText)
    },
    maybeCompleteExecution(event: SandboxEvent, messageId: string | null, now: number) {
      return maybeCompleteExecution(this, event, messageId, now)
    },
    completeExecutionIfMessage(
      event: ExecutionCompleteSandboxEvent,
      messageId: string | null,
      now: number,
    ) {
      return completeExecutionIfMessage(this, event, messageId, now)
    },
    completionStatus(success: boolean) {
      return completionStatus(this, success)
    },
    finalizeExecutionStream(event: ExecutionCompleteSandboxEvent, messageId: string) {
      return finalizeExecutionStream(this, event, messageId)
    },
    completeExecution(event: ExecutionCompleteSandboxEvent, messageId: string, now: number) {
      return completeExecution(this, event, messageId, now)
    },
    stopExecution() {
      return stopExecution(this)
    },
    stopProcessingMessage(processing: MessageRow) {
      return stopProcessingMessage(this, processing)
    },
    resolveStopRuntimeId(agentRuntime: QueuedMessageContext["agentRuntime"]) {
      return resolveStopRuntimeId(this, agentRuntime)
    },
    stopRuntimeExecution(
      agentRuntime: QueuedMessageContext["agentRuntime"],
      processing: MessageRow,
      participant: ParticipantRow | null,
      runtimeId: string,
    ) {
      return stopRuntimeExecution(this, agentRuntime, processing, participant, runtimeId)
    },
    stopIsolateRuntime(
      processing: MessageRow,
      participant: ParticipantRow | null,
      runtimeId: string,
    ) {
      return stopIsolateRuntime(this, processing, participant, runtimeId)
    },
    stopIsolatePromptEffect(
      processing: MessageRow,
      participant: ParticipantRow | null,
      runtimeId: string,
    ) {
      return stopIsolatePromptEffect(this, processing, participant, runtimeId)
    },
    logIsolateStopFailureEffect(
      errorValue: unknown,
      participant: ParticipantRow | null,
      processing: MessageRow,
      runtimeId: string,
    ) {
      return logIsolateStopFailureEffect(this, errorValue, participant, processing, runtimeId)
    },
    broadcast(message: ServerMessage) {
      return broadcast(this, message)
    },
  })
}
