import type { OpenCodeInteractionResponse } from "@solzero/shared"
import { type ClientInfo, type ClientMessage } from "../../types"
import { type ParticipantRow, type SandboxRow } from "../types"
import { type ParsedTags } from "../websocket-manager"
import {
  acceptClientSocketWithAuth,
  acceptSandboxSocket,
  acceptWebSocketUpgrade,
  applyPresence,
  applySandboxSocketClose,
  authorizeSubscribe,
  broadcastClientLeft,
  buildAndCacheClientInfo,
  clientWsId,
  clientWsIdOption,
  completeSubscribe,
  dispatchClientMessage,
  getClientInfo,
  handleClientMessage,
  handleClientSocketClose,
  handleInteractionReply,
  handlePromptMessage,
  handleSandboxMessage,
  handleSandboxSocketClose,
  handleSubscribe,
  handleTyping,
  handleWebSocketUpgrade,
  logSandboxMessageError,
  recoverClientInfo,
  rejectSubscribeInvalidToken,
  rejectSubscribeMissingToken,
  replayCursor,
  routeWebSocketMessage,
  sendInvalidMessage,
  sendPong,
  sendReplayEvent,
  sendSubscribeReplay,
  updateClientPresence,
  validateActiveSandboxUpgrade,
  validateSandboxUpgrade,
  webSocketClose,
  webSocketError,
  webSocketMessage,
} from "./websocket"

export function installSessionDOWebSocketBindings(SessionDO: {
  prototype: Record<string, unknown>
}) {
  Object.assign(SessionDO.prototype, {
    webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
      return webSocketMessage(this, ws, message)
    },
    routeWebSocketMessage(ws: WebSocket, message: string) {
      return routeWebSocketMessage(this, ws, message)
    },
    webSocketClose(ws: WebSocket, code: number) {
      return webSocketClose(this, ws, code)
    },
    handleSandboxSocketClose(ws: WebSocket, code: number) {
      return handleSandboxSocketClose(this, ws, code)
    },
    applySandboxSocketClose(code: number) {
      return applySandboxSocketClose(this, code)
    },
    handleClientSocketClose(ws: WebSocket) {
      return handleClientSocketClose(this, ws)
    },
    broadcastClientLeft(client: ClientInfo) {
      return broadcastClientLeft(this, client)
    },
    webSocketError(ws: WebSocket) {
      return webSocketError(this, ws)
    },
    handleWebSocketUpgrade(request: Request, url: URL) {
      return handleWebSocketUpgrade(this, request, url)
    },
    validateSandboxUpgrade(request: Request) {
      return validateSandboxUpgrade(this, request)
    },
    validateActiveSandboxUpgrade(request: Request, sandbox: SandboxRow) {
      return validateActiveSandboxUpgrade(this, request, sandbox)
    },
    acceptWebSocketUpgrade(request: Request, isSandbox: boolean) {
      return acceptWebSocketUpgrade(this, request, isSandbox)
    },
    acceptSandboxSocket(request: Request, server: WebSocket) {
      return acceptSandboxSocket(this, request, server)
    },
    acceptClientSocketWithAuth(server: WebSocket) {
      return acceptClientSocketWithAuth(this, server)
    },
    handleSandboxMessage(message: string) {
      return handleSandboxMessage(this, message)
    },
    logSandboxMessageError(errorValue: unknown) {
      return logSandboxMessageError(this, errorValue)
    },
    handleClientMessage(ws: WebSocket, message: string) {
      return handleClientMessage(this, ws, message)
    },
    sendInvalidMessage(ws: WebSocket) {
      return sendInvalidMessage(this, ws)
    },
    dispatchClientMessage(ws: WebSocket, data: ClientMessage) {
      return dispatchClientMessage(this, ws, data)
    },
    sendPong(ws: WebSocket) {
      return sendPong(this, ws)
    },
    applyPresence(ws: WebSocket, status: ClientInfo["status"]) {
      return applyPresence(this, ws, status)
    },
    updateClientPresence(client: ClientInfo, status: ClientInfo["status"]) {
      return updateClientPresence(this, client, status)
    },
    clientWsId(parsed: ParsedTags) {
      return clientWsId(this, parsed)
    },
    clientWsIdOption(parsed: ParsedTags) {
      return clientWsIdOption(this, parsed)
    },
    handleSubscribe(ws: WebSocket, data: { token: string; clientId: string }) {
      return handleSubscribe(this, ws, data)
    },
    rejectSubscribeMissingToken(ws: WebSocket, parsed: ParsedTags, clientId: string) {
      return rejectSubscribeMissingToken(this, ws, parsed, clientId)
    },
    authorizeSubscribe(
      ws: WebSocket,
      parsed: ParsedTags,
      data: { token: string; clientId: string },
    ) {
      return authorizeSubscribe(this, ws, parsed, data)
    },
    rejectSubscribeInvalidToken(ws: WebSocket, parsed: ParsedTags, clientId: string) {
      return rejectSubscribeInvalidToken(this, ws, parsed, clientId)
    },
    completeSubscribe(
      ws: WebSocket,
      parsed: ParsedTags,
      data: { token: string; clientId: string },
      participant: ParticipantRow,
    ) {
      return completeSubscribe(this, ws, parsed, data, participant)
    },
    sendSubscribeReplay(ws: WebSocket) {
      return sendSubscribeReplay(this, ws)
    },
    sendReplayEvent(ws: WebSocket, row: { data: string }) {
      return sendReplayEvent(this, ws, row)
    },
    replayCursor(oldest: { created_at: number; id: string } | undefined) {
      return replayCursor(this, oldest)
    },
    handleTyping() {
      return handleTyping(this)
    },
    getClientInfo(ws: WebSocket) {
      return getClientInfo(this, ws)
    },
    recoverClientInfo(ws: WebSocket) {
      return recoverClientInfo(this, ws)
    },
    buildAndCacheClientInfo(
      ws: WebSocket,
      mapping: {
        participant_id: string
        user_id: string
        github_name: string | null
        github_login: string | null
        client_id: string
      },
    ) {
      return buildAndCacheClientInfo(this, ws, mapping)
    },
    handlePromptMessage(
      ws: WebSocket,
      data: {
        content: string
        model?: string
        reasoningEffort?: string
        attachments?: Array<{
          type: string
          name: string
          url?: string
          content?: string
        }>
      },
    ) {
      return handlePromptMessage(this, ws, data)
    },
    handleInteractionReply(ws: WebSocket, data: OpenCodeInteractionResponse) {
      return handleInteractionReply(this, ws, data)
    },
  })
}
