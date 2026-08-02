import * as Option from "effect/Option"
import type { WsTokenBody } from "../durable-object"
import {
  type ArtifactRow,
  type MessageRow,
  type ParticipantRow,
  type RuntimeActivityRow,
  type SandboxRow,
  type SessionRow,
} from "../types"
import {
  archiveResolvedSession,
  archiveSession,
  broadcastArchivedProcessing,
  createWsParticipant,
  ensureWsParticipant,
  finalizeArchive,
  generateWsTokenForUser,
  handleArchive,
  handleGenerateWsToken,
  handleListArtifacts,
  handleListEvents,
  handleListMessages,
  handleListRuntimeActivity,
  handleStop,
  handleUnarchive,
  handleVerifySandboxToken,
  issueWsToken,
  listSerializedRuntimeActivity,
  matchSandboxAuthToken,
  matchSandboxToken,
  revertArchive,
  serializeArtifact,
  serializeRuntimeActivity,
  teardownArchivedRuntime,
  unarchiveResolvedSession,
  unarchiveSession,
  verifySandboxToken,
} from "./query-archive"

export function installSessionDOQueryArchiveBindings(SessionDO: {
  prototype: Record<string, unknown>
}) {
  Object.assign(SessionDO.prototype, {
    handleStop() {
      return handleStop(this)
    },
    handleListEvents(url: URL) {
      return handleListEvents(this, url)
    },
    handleListRuntimeActivity(url: URL) {
      return handleListRuntimeActivity(this, url)
    },
    listSerializedRuntimeActivity(limit: number) {
      return listSerializedRuntimeActivity(this, limit)
    },
    handleListMessages(url: URL) {
      return handleListMessages(this, url)
    },
    handleListArtifacts() {
      return handleListArtifacts(this)
    },
    handleGenerateWsToken(request: Request) {
      return handleGenerateWsToken(this, request)
    },
    generateWsTokenForUser(userId: string, body: WsTokenBody) {
      return generateWsTokenForUser(this, userId, body)
    },
    ensureWsParticipant(userId: string, body: WsTokenBody) {
      return ensureWsParticipant(this, userId, body)
    },
    createWsParticipant(userId: string, body: WsTokenBody) {
      return createWsParticipant(this, userId, body)
    },
    issueWsToken(participant: ParticipantRow) {
      return issueWsToken(this, participant)
    },
    handleVerifySandboxToken(request: Request) {
      return handleVerifySandboxToken(this, request)
    },
    verifySandboxToken(token: string) {
      return verifySandboxToken(this, token)
    },
    matchSandboxToken(token: string, sandbox: SandboxRow) {
      return matchSandboxToken(this, token, sandbox)
    },
    matchSandboxAuthToken(token: string, sandbox: SandboxRow) {
      return matchSandboxAuthToken(this, token, sandbox)
    },
    serializeArtifact(artifact: ArtifactRow) {
      return serializeArtifact(this, artifact)
    },
    serializeRuntimeActivity(row: RuntimeActivityRow, previousCreatedAt: number | null) {
      return serializeRuntimeActivity(this, row, previousCreatedAt)
    },
    handleArchive(request: Request) {
      return handleArchive(this, request)
    },
    archiveSession() {
      return archiveSession(this)
    },
    archiveResolvedSession(session: SessionRow) {
      return archiveResolvedSession(this, session)
    },
    teardownArchivedRuntime(session: SessionRow) {
      return teardownArchivedRuntime(this, session)
    },
    revertArchive(session: SessionRow, previousStatus: SessionRow["status"], errorValue: unknown) {
      return revertArchive(this, session, previousStatus, errorValue)
    },
    finalizeArchive(processingMessage: Option.Option<MessageRow>, sandboxId: string) {
      return finalizeArchive(this, processingMessage, sandboxId)
    },
    broadcastArchivedProcessing(message: MessageRow, sandboxId: string) {
      return broadcastArchivedProcessing(this, message, sandboxId)
    },
    handleUnarchive(request: Request) {
      return handleUnarchive(this, request)
    },
    unarchiveSession() {
      return unarchiveSession(this)
    },
    unarchiveResolvedSession(session: SessionRow) {
      return unarchiveResolvedSession(this, session)
    },
  })
}
