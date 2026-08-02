import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type { ClientInfo } from "../types"
import { stringifyJson } from "../../lib/json"
import type { SessionRepository } from "./repository"

export type ParsedTags = { kind: "sandbox"; sandboxId?: string } | { kind: "client"; wsId?: string }

export interface SessionWebSocketManager {
  acceptClientSocket(ws: WebSocket, wsId: string): void
  acceptAndSetSandboxSocket(ws: WebSocket, sandboxId?: string): { replaced: boolean }
  classify(ws: WebSocket): ParsedTags
  getSandboxSocket(): Option.Option<WebSocket>
  clearSandboxSocket(): void
  clearSandboxSocketIfMatch(ws: WebSocket): boolean
  setClient(ws: WebSocket, info: ClientInfo): void
  getClient(ws: WebSocket): Option.Option<ClientInfo>
  removeClient(ws: WebSocket): Option.Option<ClientInfo>
  persistClientMapping(wsId: string, participantId: string, clientId: string): void
  hasPersistedMapping(wsId: string): boolean
  recoverClientMapping(ws: WebSocket): Option.Option<{
    participant_id: string
    client_id: string
    user_id: string
    github_name: string | null
    github_login: string | null
  }>
  send(ws: WebSocket, message: string | object): boolean
  close(ws: WebSocket, code: number, reason: string): void
  forEachClientSocket(mode: "all_clients" | "authenticated_only", fn: (ws: WebSocket) => void): void
  enforceAuthTimeout(ws: WebSocket, wsId: string): Promise<void>
  enableAutoPingPong(): void
  getAuthenticatedClients(): IterableIterator<ClientInfo>
  getConnectedClientCount(): number
}

export class SessionWebSocketManagerImpl implements SessionWebSocketManager {
  private readonly clients = new Map<WebSocket, ClientInfo>()
  private sandboxSocket: WebSocket | null = null

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly repository: SessionRepository,
    private readonly authTimeoutMs: number,
  ) {}

  acceptClientSocket(ws: WebSocket, wsId: string): void {
    this.ctx.acceptWebSocket(ws, [`wsid:${wsId}`])
  }

  acceptAndSetSandboxSocket(ws: WebSocket, sandboxId?: string): { replaced: boolean } {
    const tags = Option.match(Option.fromNullishOr(sandboxId).pipe(Option.filter(Boolean)), {
      onNone: () => ["sandbox"],
      onSome: (id) => ["sandbox", `sid:${id}`],
    })
    this.ctx.acceptWebSocket(ws, tags)

    const staleSandboxSocket = Option.fromNullishOr(this.sandboxSocket).pipe(
      Option.filter((socket) => socket !== ws && socket.readyState === WebSocket.OPEN),
    )
    const replaced = Option.isSome(staleSandboxSocket)
    Option.match(staleSandboxSocket, {
      onNone: () => undefined,
      onSome: (socket) => socket.close(1000, "replaced by new sandbox connection"),
    })
    this.sandboxSocket = ws
    return { replaced }
  }

  classify(ws: WebSocket): ParsedTags {
    const tags = this.ctx.getTags(ws)
    return Match.value(tags.includes("sandbox")).pipe(
      Match.when(
        true,
        (): ParsedTags => ({
          kind: "sandbox",
          sandboxId: tags.find((tag) => tag.startsWith("sid:"))?.slice(4),
        }),
      ),
      Match.orElse(
        (): ParsedTags => ({
          kind: "client",
          wsId: tags.find((tag) => tag.startsWith("wsid:"))?.slice(5),
        }),
      ),
    )
  }

  getSandboxSocket(): Option.Option<WebSocket> {
    const current = Option.fromNullishOr(this.sandboxSocket).pipe(
      Option.filter((socket) => socket.readyState === WebSocket.OPEN),
    )
    return Option.orElse(current, () => this.findSandboxSocket())
  }

  private findSandboxSocket(): Option.Option<WebSocket> {
    const expectedSandboxId = Option.getOrNull(this.repository.getSandbox())?.sandbox_id ?? null
    const match = Option.fromNullishOr(
      this.ctx.getWebSockets().find((ws) => this.isUsableSandboxSocket(ws, expectedSandboxId)),
    )
    Option.match(match, {
      onNone: () => undefined,
      onSome: (socket) => {
        this.sandboxSocket = socket
      },
    })
    return match
  }

  private isUsableSandboxSocket(ws: WebSocket, expectedSandboxId: string | null): boolean {
    const parsed = this.classify(ws)
    return (
      parsed.kind === "sandbox" &&
      ws.readyState === WebSocket.OPEN &&
      !(expectedSandboxId && parsed.sandboxId && parsed.sandboxId !== expectedSandboxId)
    )
  }

  clearSandboxSocket(): void {
    this.sandboxSocket = null
  }

  clearSandboxSocketIfMatch(ws: WebSocket): boolean {
    const matched = this.sandboxSocket === ws
    Match.value(matched).pipe(
      Match.when(true, () => {
        this.sandboxSocket = null
      }),
      Match.orElse(() => undefined),
    )
    return matched || this.sandboxSocket === null
  }

  setClient(ws: WebSocket, info: ClientInfo): void {
    this.clients.set(ws, info)
  }

  getClient(ws: WebSocket): Option.Option<ClientInfo> {
    return Option.fromNullishOr(this.clients.get(ws))
  }

  removeClient(ws: WebSocket): Option.Option<ClientInfo> {
    const client = Option.fromNullishOr(this.clients.get(ws))
    this.clients.delete(ws)
    return client
  }

  persistClientMapping(wsId: string, participantId: string, clientId: string): void {
    this.repository.upsertWsClientMapping({
      wsId,
      participantId,
      clientId,
      createdAt: Date.now(),
    })
  }

  hasPersistedMapping(wsId: string): boolean {
    return this.repository.hasWsClientMapping(wsId)
  }

  recoverClientMapping(ws: WebSocket): Option.Option<{
    participant_id: string
    client_id: string
    user_id: string
    github_name: string | null
    github_login: string | null
  }> {
    const parsed = this.classify(ws)
    const clientWsId = Match.value(parsed).pipe(
      Match.when({ kind: "client" }, (clientTags) => Option.fromNullishOr(clientTags.wsId)),
      Match.orElse(() => Option.none<string>()),
    )
    return Option.flatMap(clientWsId, (wsId) => this.repository.getWsClientMapping(wsId))
  }

  send(ws: WebSocket, message: string | object): boolean {
    return Match.value(ws.readyState === WebSocket.OPEN).pipe(
      Match.when(false, () => false),
      Match.orElse(() => this.trySend(ws, message)),
    )
  }

  private trySend(ws: WebSocket, message: string | object): boolean {
    // oxlint-disable-next-line effect/avoid-try-catch -- Sync platform boundary: WebSocket.send throws on a closed/errored socket and must degrade to `false`; this Promise-based DO helper has no Effect context to thread.
    try {
      const payload = Match.value(message).pipe(
        Match.when(Match.string, (value) => value),
        Match.orElse((value) => stringifyJson(value)),
      )
      ws.send(payload)
      return true
    } catch {
      return false
    }
  }

  close(ws: WebSocket, code: number, reason: string): void {
    // oxlint-disable-next-line effect/avoid-try-catch -- Sync platform boundary: WebSocket.close throws when already closed and must be ignored; this Promise-based DO helper has no Effect context to thread.
    try {
      ws.close(code, reason)
    } catch {
      // Ignore when already closed.
    }
  }

  forEachClientSocket(
    mode: "all_clients" | "authenticated_only",
    fn: (ws: WebSocket) => void,
  ): void {
    this.ctx.getWebSockets().forEach((ws) => {
      const parsed = this.classify(ws)
      const shouldSend =
        parsed.kind !== "sandbox" && (mode === "all_clients" || this.isAuthenticated(ws, parsed))
      Match.value(shouldSend).pipe(
        Match.when(true, () => fn(ws)),
        Match.orElse(() => undefined),
      )
    })
  }

  private isAuthenticated(ws: WebSocket, parsed: ParsedTags): boolean {
    return Match.value(this.clients.has(ws)).pipe(
      Match.when(true, () => true),
      Match.orElse(() => this.hasClientTokenMapping(parsed)),
    )
  }

  private hasClientTokenMapping(parsed: ParsedTags): boolean {
    return Match.value(parsed).pipe(
      Match.when({ kind: "client" }, (clientTags) =>
        Option.match(Option.fromNullishOr(clientTags.wsId), {
          onNone: () => false,
          onSome: (wsId) => this.repository.hasWsClientMapping(wsId),
        }),
      ),
      Match.orElse(() => false),
    )
  }

  async enforceAuthTimeout(ws: WebSocket, wsId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.authTimeoutMs))
    const stillUnauthenticated =
      ws.readyState === WebSocket.OPEN && !this.clients.has(ws) && !this.hasPersistedMapping(wsId)
    Match.value(stillUnauthenticated).pipe(
      Match.when(true, () => this.close(ws, 4008, "authentication timeout")),
      Match.orElse(() => undefined),
    )
  }

  enableAutoPingPong(): void {
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        stringifyJson({ type: "ping" }),
        stringifyJson({ type: "pong", timestamp: Date.now() }),
      ),
    )
  }

  getAuthenticatedClients(): IterableIterator<ClientInfo> {
    return this.clients.values()
  }

  getConnectedClientCount(): number {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.OPEN && this.classify(ws).kind === "client")
      .length
  }
}

/**
 * Promise/`null`-facing view of {@link SessionWebSocketManager} for the non-Effect sandbox
 * lifecycle manager. It only needs the sandbox-socket presence check and clear operation, so this
 * boundary re-surfaces the migrated `Option` read as `WebSocket | null`.
 */
export interface SessionRuntimeWebSocket {
  getSandboxSocket(): WebSocket | null
  clearSandboxSocket(): void
}

/** Adapts a {@link SessionWebSocketManager} into the `null`-facing {@link SessionRuntimeWebSocket}. */
export function toSessionRuntimeWebSocket(
  manager: SessionWebSocketManager,
): SessionRuntimeWebSocket {
  return {
    getSandboxSocket: () => Option.getOrNull(manager.getSandboxSocket()),
    clearSandboxSocket: () => manager.clearSandboxSocket(),
  }
}
