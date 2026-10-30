// @ts-nocheck
import { type RuntimeActivityEvent } from "@solzero/shared"
import { generateId, hashToken } from "../../auth/crypto"
import * as Arr from "effect/Array"
import { runEffectPromise } from "../../../lib/effect-promise"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { decodeJsonRecord, parseJson } from "../../../lib/json"
import { toErrorWithFallback } from "../../../lib/effect-errors"
import type {
  ArtifactRow,
  MessageRow,
  ParticipantRow,
  RuntimeActivityRow,
  SandboxRow,
  SessionRow,
} from "../types"
import { WS_TOKEN_TTL_MS, parseArtifactMetadata, type WsTokenBody } from "../durable-object"

type SessionDODelegate = any

export async function handleStop(host: SessionDODelegate): Promise<Response> {
  await host.stopExecution()

  return Response.json({ status: "stopping" })
}

export function handleListEvents(host: SessionDODelegate, url: URL): Response {
  const limit = Math.min(Number.parseInt(url.searchParams.get("limit") || "100"), 500)

  const events = Option.match(Option.fromNullishOr(url.searchParams.get("messageId")), {
    onNone: () => host.repository.events.listEvents(limit),
    onSome: (messageId) => host.repository.events.listEventsForMessage(messageId),
  })

  return Response.json({
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      data: parseJson(event.data),
      messageId: event.message_id,
      createdAt: event.created_at,
    })),
  })
}

export function handleListRuntimeActivity(host: SessionDODelegate, url: URL): Response {
  const limit = Math.min(Number.parseInt(url.searchParams.get("limit") || "100"), 500)

  return Response.json({
    activity: host.listSerializedRuntimeActivity(limit),
  })
}

export function listSerializedRuntimeActivity(
  host: SessionDODelegate,
  limit: number,
): RuntimeActivityEvent[] {
  const rows = host.repository.listRuntimeActivity(limit)

  return rows.map((row, index) =>
    host.serializeRuntimeActivity(
      row,
      Option.getOrNull(Option.map(Arr.get(rows, index - 1), (previous) => previous.createdAt)),
    ),
  )
}

export function handleListMessages(host: SessionDODelegate, url: URL): Response {
  const limit = Math.min(Number.parseInt(url.searchParams.get("limit") || "100"), 500)
  const messages = host.repository.listMessages(limit)

  return Response.json({
    messages: messages.map((message) => ({
      id: message.id,
      authorId: message.author_id,
      content: message.content,
      source: message.source,
      status: message.status,
      createdAt: message.created_at,
      startedAt: message.started_at,
      completedAt: message.completed_at,
    })),
  })
}

export function handleListArtifacts(host: SessionDODelegate): Response {
  const artifacts = host.repository.listArtifacts()

  return Response.json({
    artifacts: artifacts.map((artifact) => host.serializeArtifact(artifact)),
  })
}

export async function handleGenerateWsToken(
  host: SessionDODelegate,
  request: Request,
): Promise<Response> {
  const body =
    /* SAFETY: The JSON body is the WsTokenBody shape read by this caller after the response arrives. */ (await request.json()) as WsTokenBody

  return Option.match(Option.fromNullishOr(body.userId || undefined), {
    onNone: () => Promise.resolve(Response.json({ error: "userId is required" }, { status: 400 })),
    onSome: (userId) => host.generateWsTokenForUser(userId, body),
  })
}

export function generateWsTokenForUser(
  host: SessionDODelegate,
  userId: string,
  body: WsTokenBody,
): Promise<Response> {
  return Option.match(host.ensureWsParticipant(userId, body), {
    onNone: () =>
      Promise.resolve(Response.json({ error: "Failed to create participant" }, { status: 500 })),
    onSome: (participant) => host.issueWsToken(participant),
  })
}

export function ensureWsParticipant(
  host: SessionDODelegate,
  userId: string,
  body: WsTokenBody,
): Option.Option<ParticipantRow> {
  return Option.match(host.repository.getParticipantByUserId(userId), {
    onNone: () => host.createWsParticipant(userId, body),
    onSome: (existing) => Option.some(existing),
  })
}

export function createWsParticipant(
  host: SessionDODelegate,
  userId: string,
  body: WsTokenBody,
): Option.Option<ParticipantRow> {
  const id = generateId()
  host.repository.createParticipant({
    id,
    userId,
    githubLogin: body.githubLogin ?? null,
    githubName: body.githubName ?? null,
    githubEmail: body.githubEmail ?? null,
    role: "member",
    joinedAt: Date.now(),
  })

  return host.repository.getParticipantById(id)
}

export async function issueWsToken(
  host: SessionDODelegate,
  participant: ParticipantRow,
): Promise<Response> {
  const now = Date.now()
  host.repository.pruneExpiredParticipantWsTokens(now)

  const plainToken = generateId(32)
  const tokenHash = await runEffectPromise(hashToken(plainToken))
  host.repository.createParticipantWsToken({
    id: generateId(),
    participantId: participant.id,
    tokenHash,
    createdAt: now,
    expiresAt: now + WS_TOKEN_TTL_MS,
  })

  return Response.json({
    token: plainToken,
    participantId: participant.id,
  })
}

export async function handleVerifySandboxToken(
  host: SessionDODelegate,
  request: Request,
): Promise<Response> {
  const body =
    /* SAFETY: The JSON body is the { token: string } shape read by this caller after the response arrives. */ (await request.json()) as {
      token: string
    }

  return Option.match(Option.fromNullishOr(body.token || undefined), {
    onNone: () => Response.json({ valid: false, error: "Missing token" }, { status: 400 }),
    onSome: (token) => host.verifySandboxToken(token),
  })
}

export function verifySandboxToken(host: SessionDODelegate, token: string): Response {
  return Option.match(host.repository.getSandbox(), {
    onNone: () => Response.json({ valid: false, error: "No sandbox" }, { status: 404 }),
    onSome: (sandbox) => host.matchSandboxToken(token, sandbox),
  })
}

export function matchSandboxToken(
  host: SessionDODelegate,
  token: string,
  sandbox: SandboxRow,
): Response {
  return Match.value(sandbox.status).pipe(
    Match.when("stopped", () =>
      Response.json({ valid: false, error: "Sandbox stopped" }, { status: 410 }),
    ),
    Match.when("stale", () =>
      Response.json({ valid: false, error: "Sandbox stopped" }, { status: 410 }),
    ),
    Match.orElse(() => host.matchSandboxAuthToken(token, sandbox)),
  )
}

export function matchSandboxAuthToken(
  host: SessionDODelegate,
  token: string,
  sandbox: SandboxRow,
): Response {
  return Match.value(token === sandbox.auth_token).pipe(
    Match.when(true, () => Response.json({ valid: true })),
    Match.orElse(() => Response.json({ valid: false, error: "Invalid token" }, { status: 401 })),
  )
}

export function serializeArtifact(host: SessionDODelegate, artifact: ArtifactRow) {
  const metadata = parseArtifactMetadata(artifact.metadata)

  const prNumber = Option.getOrUndefined(
    Option.flatMap(metadata, (resolved) =>
      Option.liftPredicate(
        resolved.prNumber,
        (value): value is number => typeof value === "number",
      ),
    ),
  )

  return {
    id: artifact.id,
    type: artifact.type,
    url: artifact.url,
    metadata: Option.getOrNull(metadata),
    prNumber,
    createdAt: artifact.created_at,
  }
}

export function serializeRuntimeActivity(
  host: SessionDODelegate,
  row: RuntimeActivityRow,
  previousCreatedAt: number | null,
) {
  return {
    id: row.id,
    type: row.type,
    sandboxId: row.runtimeId,
    summary: row.summary,
    statusFrom: row.statusFrom,
    statusTo: row.statusTo,
    keepAlive: row.keepAlive,
    reason: row.reason,
    data: Option.getOrElse(decodeJsonRecord(row.dataJson), () => ({})),
    createdAt: row.createdAt,
    durationSincePreviousMs: Option.getOrNull(
      Option.map(Option.fromNullishOr(previousCreatedAt), (previous) =>
        Math.max(0, row.createdAt - previous),
      ),
    ),
  }
}

export async function handleArchive(host: SessionDODelegate, request: Request): Promise<Response> {
  const body =
    /* SAFETY: The JSON body is the { userId?: string } shape read by this caller after the response arrives. */ (await request.json()) as {
      userId?: string
    }

  return Option.match(Option.fromNullishOr(body.userId), {
    onNone: () => Promise.resolve(Response.json({ error: "userId is required" }, { status: 400 })),
    onSome: () => host.archiveSession(),
  })
}

export function archiveSession(host: SessionDODelegate): Promise<Response> {
  return Option.match(Option.fromNullishOr(host.getSession()), {
    onNone: () => Promise.resolve(Response.json({ error: "Session not found" }, { status: 404 })),
    onSome: (session) => host.archiveResolvedSession(session),
  })
}

export function archiveResolvedSession(
  host: SessionDODelegate,
  session: SessionRow,
): Promise<Response> {
  const previousStatus = session.status
  const archivedAt = Date.now()
  const processingMessage = host.repository.getProcessingMessage()
  const sandboxId = Option.getOrNull(host.repository.getSandbox())?.sandbox_id ?? "unknown"

  host.repository.updateSessionStatus(session.id, "archived", archivedAt)

  return host
    .teardownArchivedRuntime(session)
    .then(() => host.finalizeArchive(processingMessage, sandboxId))
    .catch((errorValue) => host.revertArchive(session, previousStatus, errorValue))
}

export async function teardownArchivedRuntime(
  host: SessionDODelegate,
  session: SessionRow,
): Promise<void> {
  await Match.value(session.session_kind).pipe(
    Match.when("sandbox", () =>
      runEffectPromise(host.lifecycleManager.destroySandbox(session.session_name ?? session.id)),
    ),
    Match.orElse(async () => {
      await runEffectPromise(host.isolateRuntime.stopPrompt(session.id))
      host.repository.resetSandbox("stopped")
    }),
  )
  await host.ctx.storage.deleteAlarm()
}

export function revertArchive(
  host: SessionDODelegate,
  session: SessionRow,
  previousStatus: SessionRow["status"],
  errorValue: unknown,
): Response {
  host.repository.updateSessionStatus(session.id, previousStatus, Date.now())

  const message = toErrorWithFallback(
    errorValue,
    "Failed to destroy sandbox during archive",
  ).message

  return Response.json({ error: message }, { status: 500 })
}

export function finalizeArchive(
  host: SessionDODelegate,
  processingMessage: Option.Option<MessageRow>,
  sandboxId: string,
): Response {
  host.repository.failPendingAndProcessingMessages(Date.now(), "Session archived")
  Option.match(processingMessage, {
    onNone: () => undefined,
    onSome: (message) => host.broadcastArchivedProcessing(message, sandboxId),
  })
  host.broadcast({ type: "session_status", status: "archived" })

  return Response.json({ status: "archived" })
}

export function broadcastArchivedProcessing(
  host: SessionDODelegate,
  message: MessageRow,
  sandboxId: string,
): void {
  host.broadcast({
    type: "sandbox_event",
    event: {
      type: "execution_complete",
      messageId: message.id,
      success: false,
      error: "Session archived",
      sandboxId,
      timestamp: Date.now() / 1000,
    },
  })
  host.broadcast({ type: "processing_status", isProcessing: false })
}

export async function handleUnarchive(
  host: SessionDODelegate,
  request: Request,
): Promise<Response> {
  const body =
    /* SAFETY: The JSON body is the { userId?: string } shape read by this caller after the response arrives. */ (await request.json()) as {
      userId?: string
    }

  return Option.match(Option.fromNullishOr(body.userId), {
    onNone: () => Promise.resolve(Response.json({ error: "userId is required" }, { status: 400 })),
    onSome: () => host.unarchiveSession(),
  })
}

export function unarchiveSession(host: SessionDODelegate): Response {
  return Option.match(Option.fromNullishOr(host.getSession()), {
    onNone: () => Response.json({ error: "Session not found" }, { status: 404 }),
    onSome: (session) => host.unarchiveResolvedSession(session),
  })
}

export function unarchiveResolvedSession(host: SessionDODelegate, session: SessionRow): Response {
  host.repository.updateSessionStatus(session.id, "active", Date.now())
  host.broadcast({ type: "session_status", status: "active" })

  return Response.json({ status: "active" })
}
