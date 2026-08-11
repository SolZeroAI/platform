import {
  formatAgentRuntimeLabel,
  DEFAULT_ISOLATE_STEP_LIMIT,
  normalizeIsolateStepLimit,
  resolveAgentRuntime,
  resolveSessionSubagentMode,
  stringifyOpenCodeMcpServers,
  stringifySessionTools,
  type AgentRuntime,
  type SessionKind,
  type OpenCodeMcpServers,
  type SessionToolSpec,
  type SubagentMode,
} from "@solzero/shared"
import type {
  MessageSource,
  MessageStatus,
  PromptExecutionMode,
  SandboxStatus,
  SessionStatus,
} from "../types"
import type {
  ArtifactRow,
  MessageRow,
  ParticipantRow,
  RuntimeActivityCreateInput,
  RuntimeActivityRow,
  RuntimeLifecycleRow,
  SandboxActivityRow,
  SandboxRow,
  SessionRow,
} from "./types"
import { toRuntimeActivityRow, toRuntimeLifecycleRow } from "./types"
import { generateId } from "../auth/crypto"
import { stringifyJson } from "../../lib/json"
import { SessionEventRepository } from "./repository-events"
import * as Match from "effect/Match"
import * as Option from "effect/Option"

interface SqlResult {
  toArray(): unknown[]
  one(): unknown
}

interface SqlStorage {
  exec(query: string, ...params: unknown[]): SqlResult
}

export class SessionRepository {
  /** Event-log persistence is a separate concern; access it through this collaborator. */
  readonly events: SessionEventRepository

  constructor(
    private readonly sql: SqlStorage,
    private readonly onRuntimeActivityCreated?: (
      row: RuntimeActivityRow,
      previousCreatedAt: number | null,
    ) => void,
  ) {
    this.events = new SessionEventRepository(sql)
  }

  private shouldRecordRuntimeActivity(): boolean {
    return Option.isSome(this.getSession())
  }

  private getRuntimeActivityLabel(): string {
    return Option.match(this.getSession(), {
      onNone: () => "Runtime",
      onSome: (session) => formatAgentRuntimeLabel(session.agent_runtime),
    })
  }

  private getLatestRuntimeActivityCreatedAt(): Option.Option<number> {
    const result = this.sql
      .exec("SELECT created_at FROM sandbox_activity ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .toArray() as Array<{ created_at: number }>
    return Option.map(Option.fromNullishOr(result[0]), (row) => row.created_at)
  }

  private createRuntimeActivity(
    input: RuntimeActivityCreateInput & { sandboxId?: string | null },
  ): RuntimeActivityRow {
    const runtimeId = input.runtimeId ?? input.sandboxId ?? null
    const row: RuntimeActivityRow = {
      id: input.id ?? generateId(),
      runtimeId,
      type: input.type,
      summary: input.summary,
      statusFrom: input.statusFrom ?? null,
      statusTo: input.statusTo ?? null,
      keepAlive: input.keepAlive ?? null,
      reason: input.reason ?? null,
      dataJson: stringifyJson(input.data ?? {}),
      createdAt: input.createdAt ?? Date.now(),
    }
    const previousCreatedAt = this.getLatestRuntimeActivityCreatedAt()
    const keepAliveColumn = Match.value(row.keepAlive).pipe(
      Match.when(true, () => 1),
      Match.when(false, () => 0),
      Match.orElse(() => null),
    )
    this.sql.exec(
      `INSERT INTO sandbox_activity (id, sandbox_id, type, summary, status_from, status_to, keep_alive, reason, data, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      row.id,
      row.runtimeId,
      row.type,
      row.summary,
      row.statusFrom,
      row.statusTo,
      keepAliveColumn,
      row.reason,
      row.dataJson,
      row.createdAt,
    )
    this.onRuntimeActivityCreated?.(row, Option.getOrNull(previousCreatedAt))
    return row
  }

  private runtimeStatusChangeSummary(to: SandboxStatus | string): string {
    const label = this.getRuntimeActivityLabel()
    return Match.value(to.toLowerCase()).pipe(
      Match.when("ready", () => `${label} started`),
      Match.when("stopped", () => `${label} stopped`),
      Match.when("failed", () => `${label} failed`),
      Match.orElse(() => `${label} status changed to ${to}`),
    )
  }

  private recordRuntimeStatusChange(input: {
    runtimeId?: string | null
    sandboxId?: string | null
    from: SandboxStatus | string | null
    to: SandboxStatus | string
    reason?: string | null
    createdAt?: number
    data?: Record<string, unknown>
  }): Option.Option<RuntimeActivityRow> {
    return Match.value(this.shouldRecordRuntimeActivity() && input.from !== input.to).pipe(
      Match.when(false, () => Option.none<RuntimeActivityRow>()),
      Match.orElse(() =>
        Option.some(
          this.createRuntimeActivity({
            runtimeId: input.runtimeId ?? input.sandboxId ?? null,
            type: "status_changed",
            summary: this.runtimeStatusChangeSummary(input.to),
            statusFrom: input.from,
            statusTo: input.to,
            reason: input.reason ?? null,
            data: input.data,
            createdAt: input.createdAt,
          }),
        ),
      ),
    )
  }

  recordRuntimeActivity(
    input: RuntimeActivityCreateInput & { sandboxId?: string | null },
  ): Option.Option<RuntimeActivityRow> {
    return Match.value(this.shouldRecordRuntimeActivity()).pipe(
      Match.when(false, () => Option.none<RuntimeActivityRow>()),
      Match.orElse(() => Option.some(this.createRuntimeActivity(input))),
    )
  }

  getSession(): Option.Option<SessionRow> {
    const result = this.sql.exec("SELECT * FROM session LIMIT 1").toArray() as SessionRow[]
    return Option.map(Option.fromNullishOr(result[0]), normalizeSessionRow)
  }

  upsertSession(input: {
    id: string
    sessionName: string
    sessionKind: SessionKind
    agentRuntime: AgentRuntime
    title: string | null
    repoOwner: string
    repoName: string
    githubInstallationId?: number | null
    githubRepoId?: number | null
    repoDefaultBranch?: string | null
    branchName?: string | null
    tools?: SessionToolSpec[] | null
    customMcpServers?: OpenCodeMcpServers | null
    secretKeys?: string[] | null
    isolateStepLimit?: number | null
    subagents?: SubagentMode | null
    model: string
    reasoningEffort?: string | null
    status: SessionStatus
    createdAt: number
    updatedAt: number
  }): void {
    const secretKeysJson = stringifyJson(
      Array.from(new Set((input.secretKeys ?? []).filter((key) => key.length > 0))),
    )
    this.sql.exec(
      `INSERT OR REPLACE INTO session (id, session_name, session_kind, agent_runtime, title, repo_owner, repo_name, github_installation_id, github_repo_id, repo_default_branch, branch_name, tools_json, custom_mcp_json, secret_keys_json, isolate_step_limit, subagents, model, reasoning_effort, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)`,
      input.id,
      input.sessionName,
      input.sessionKind,
      input.agentRuntime,
      input.title,
      input.repoOwner,
      input.repoName,
      input.githubInstallationId ?? null,
      input.githubRepoId ?? null,
      input.repoDefaultBranch ?? null,
      input.branchName ?? null,
      stringifySessionTools(input.tools),
      stringifyOpenCodeMcpServers(input.customMcpServers),
      secretKeysJson,
      normalizeIsolateStepLimit(input.isolateStepLimit, DEFAULT_ISOLATE_STEP_LIMIT),
      resolveSessionSubagentMode(input.sessionKind, input.subagents),
      input.model,
      input.reasoningEffort ?? null,
      input.status,
      input.createdAt,
      input.updatedAt,
    )
  }

  updateSessionTooling(input: {
    sessionId: string
    repoOwner: string
    repoName: string
    tools?: SessionToolSpec[] | null
    customMcpServers?: OpenCodeMcpServers | null
    isolateStepLimit?: number | null
    subagents?: SubagentMode | null
    updatedAt: number
  }): void {
    const currentSession = Option.getOrNull(this.getSession())
    const currentStepLimit = currentSession?.isolate_step_limit ?? DEFAULT_ISOLATE_STEP_LIMIT
    const subagents = resolveSessionSubagentMode(
      currentSession?.session_kind,
      input.subagents,
      currentSession?.subagents,
    )
    this.sql.exec(
      `UPDATE session
       SET repo_owner = ?1,
           repo_name = ?2,
           tools_json = ?3,
           custom_mcp_json = ?4,
           isolate_step_limit = ?5,
           subagents = ?6,
           updated_at = ?7
       WHERE id = ?8`,
      input.repoOwner,
      input.repoName,
      stringifySessionTools(input.tools),
      stringifyOpenCodeMcpServers(input.customMcpServers),
      normalizeIsolateStepLimit(input.isolateStepLimit, currentStepLimit),
      subagents,
      input.updatedAt,
      input.sessionId,
    )
  }

  updateSessionStatus(sessionId: string, status: SessionStatus, updatedAt: number): void {
    this.sql.exec(
      "UPDATE session SET status = ?1, updated_at = ?2 WHERE id = ?3",
      status,
      updatedAt,
      sessionId,
    )
  }

  updateSandboxOpencodeSessionId(opencodeSessionId: string | null): void {
    this.sql.exec(
      "UPDATE sandbox SET opencode_session_id = ?1 WHERE id = (SELECT id FROM sandbox LIMIT 1)",
      opencodeSessionId,
    )
  }

  updateSandboxOpencodeServer(port: number | null, configSignature: string | null): void {
    this.sql.exec(
      "UPDATE sandbox SET opencode_server_port = ?1, opencode_config_signature = ?2 WHERE id = (SELECT id FROM sandbox LIMIT 1)",
      port,
      configSignature,
    )
  }

  getSandbox(): Option.Option<SandboxRow> {
    const result = this.sql.exec("SELECT * FROM sandbox LIMIT 1").toArray() as SandboxRow[]
    return Option.fromNullishOr(result[0])
  }

  getRuntimeLifecycle(): Option.Option<RuntimeLifecycleRow> {
    return Option.map(this.getSandbox(), toRuntimeLifecycleRow)
  }

  createSandbox(input: { id: string; status: SandboxStatus; createdAt: number }): void {
    this.sql.exec(
      "INSERT INTO sandbox (id, status, created_at) VALUES (?1, ?2, ?3)",
      input.id,
      input.status,
      input.createdAt,
    )
  }

  updateSandboxStatus(status: SandboxStatus): void {
    const runtime = Option.getOrNull(this.getRuntimeLifecycle())
    this.sql.exec(
      "UPDATE sandbox SET status = ?1 WHERE id = (SELECT id FROM sandbox LIMIT 1)",
      status,
    )
    this.recordRuntimeStatusChange({
      runtimeId: runtime?.runtimeId ?? null,
      from: runtime?.status ?? null,
      to: status,
    })
  }

  resetSandbox(status: SandboxStatus): void {
    const runtime = Option.getOrNull(this.getRuntimeLifecycle())
    this.sql.exec(
      `UPDATE sandbox
       SET sandbox_id = NULL,
           auth_token = NULL,
           opencode_session_id = NULL,
           opencode_server_port = NULL,
           opencode_config_signature = NULL,
           status = ?1,
           last_heartbeat = NULL,
           last_activity = NULL,
           last_spawn_error = NULL,
           last_spawn_error_at = NULL,
           created_at = 0
       WHERE id = (SELECT id FROM sandbox LIMIT 1)`,
      status,
    )
    this.recordRuntimeStatusChange({
      runtimeId: runtime?.runtimeId ?? null,
      from: runtime?.status ?? null,
      to: status,
      reason: "reset",
    })
  }

  updateRuntimeForSpawn(input: {
    status: SandboxStatus
    runtimeId: string
    authToken: string
    createdAt: number
  }): void {
    const previousRuntime = Option.getOrNull(this.getRuntimeLifecycle())
    this.sql.exec(
      `UPDATE sandbox
       SET status = ?1,
           sandbox_id = ?2,
           auth_token = ?3,
           opencode_session_id = NULL,
           opencode_server_port = NULL,
           opencode_config_signature = NULL,
           last_heartbeat = NULL,
           last_activity = NULL,
           last_spawn_error = NULL,
           last_spawn_error_at = NULL,
           created_at = ?4
       WHERE id = (SELECT id FROM sandbox LIMIT 1)`,
      input.status,
      input.runtimeId,
      input.authToken,
      input.createdAt,
    )
    Match.value(
      this.shouldRecordRuntimeActivity() && previousRuntime?.runtimeId !== input.runtimeId,
    ).pipe(
      Match.when(true, () => {
        const label = this.getRuntimeActivityLabel()
        this.createRuntimeActivity({
          runtimeId: input.runtimeId,
          type: "created",
          summary: `${label} created`,
          statusTo: input.status,
          data: {
            previousRuntimeId: previousRuntime?.runtimeId ?? null,
            previousSandboxId: previousRuntime?.runtimeId ?? null,
          },
          createdAt: input.createdAt,
        })
      }),
      Match.orElse(() => undefined),
    )
    this.recordRuntimeStatusChange({
      runtimeId: input.runtimeId,
      from: previousRuntime?.status ?? null,
      to: input.status,
      createdAt: input.createdAt,
    })
  }

  updateSandboxForSpawn(input: {
    status: SandboxStatus
    sandboxId: string
    authToken: string
    createdAt: number
  }): void {
    this.updateRuntimeForSpawn({
      status: input.status,
      runtimeId: input.sandboxId,
      authToken: input.authToken,
      createdAt: input.createdAt,
    })
  }

  updateSandboxHeartbeat(timestamp: number): void {
    this.sql.exec(
      "UPDATE sandbox SET last_heartbeat = ?1 WHERE id = (SELECT id FROM sandbox LIMIT 1)",
      timestamp,
    )
  }

  updateSandboxLastActivity(timestamp: number): void {
    this.sql.exec(
      "UPDATE sandbox SET last_activity = ?1 WHERE id = (SELECT id FROM sandbox LIMIT 1)",
      timestamp,
    )
  }

  updateSandboxSpawnError(errorMessage: string | null, timestamp: number | null): void {
    this.sql.exec(
      "UPDATE sandbox SET last_spawn_error = ?1, last_spawn_error_at = ?2 WHERE id = (SELECT id FROM sandbox LIMIT 1)",
      errorMessage,
      timestamp,
    )
    Match.value(Boolean(errorMessage)).pipe(
      Match.when(true, () => {
        const label = this.getRuntimeActivityLabel()
        this.recordRuntimeActivity({
          runtimeId: Option.getOrNull(this.getRuntimeLifecycle())?.runtimeId ?? null,
          type: "error",
          summary: `${label} start failed`,
          data: { error: errorMessage },
          createdAt: timestamp ?? Date.now(),
        })
      }),
      Match.orElse(() => undefined),
    )
  }

  listRuntimeActivity(limit: number): RuntimeActivityRow[] {
    return this.sql
      .exec(
        `SELECT id, sandbox_id, type, summary, status_from, status_to, keep_alive, reason, data, created_at FROM (
           SELECT rowid AS activity_rowid, * FROM sandbox_activity
           ORDER BY created_at DESC, rowid DESC LIMIT ?1
         ) sub ORDER BY created_at ASC, activity_rowid ASC`,
        limit,
      )
      .toArray()
      .map((row) => toRuntimeActivityRow(row as SandboxActivityRow))
  }

  getParticipantByUserId(userId: string): Option.Option<ParticipantRow> {
    const result = this.sql
      .exec("SELECT * FROM participants WHERE user_id = ?1 LIMIT 1", userId)
      .toArray() as ParticipantRow[]
    return Option.fromNullishOr(result[0])
  }

  getParticipantById(participantId: string): Option.Option<ParticipantRow> {
    const result = this.sql
      .exec("SELECT * FROM participants WHERE id = ?1 LIMIT 1", participantId)
      .toArray() as ParticipantRow[]
    return Option.fromNullishOr(result[0])
  }

  getParticipantByWsTokenHash(
    tokenHash: string,
    now: number,
    tokenTtlMs: number,
  ): Option.Option<ParticipantRow> {
    const result = this.sql
      .exec(
        `SELECT p.*
         FROM participant_ws_tokens t
         JOIN participants p ON p.id = t.participant_id
         WHERE t.token_hash = ?1 AND t.expires_at >= ?2
         LIMIT 1`,
        tokenHash,
        now,
      )
      .toArray() as ParticipantRow[]
    return Option.orElse(Option.fromNullishOr(result[0]), () =>
      Option.fromNullishOr(
        (
          this.sql
            .exec(
              `SELECT * FROM participants
         WHERE ws_auth_token = ?1 AND ws_token_created_at >= ?2
         LIMIT 1`,
              tokenHash,
              now - tokenTtlMs,
            )
            .toArray() as ParticipantRow[]
        )[0],
      ),
    )
  }

  getWsTokenDiagnostics(now: number): {
    participantCount: number
    activeTokenCount: number
    storedTokenCount: number
    latestTokenCreatedAt: number | null
    latestTokenAgeMs: number | null
  } {
    const row = this.sql
      .exec(
        `SELECT
          (SELECT COUNT(*) FROM participants) AS participant_count,
          (SELECT COUNT(*) FROM participant_ws_tokens WHERE expires_at >= ?1) AS active_token_count,
          (SELECT COUNT(*) FROM participant_ws_tokens) AS stored_token_count,
          (SELECT MAX(created_at) FROM participant_ws_tokens) AS latest_token_created_at`,
        now,
      )
      .one() as {
      participant_count: number
      active_token_count: number
      stored_token_count: number
      latest_token_created_at: number | null
    } | null

    const latestTokenCreatedAt = Option.getOrNull(
      Option.map(Option.fromNullishOr(row?.latest_token_created_at), (value) => Number(value)),
    )
    return {
      participantCount: Number(row?.participant_count ?? 0),
      activeTokenCount: Number(row?.active_token_count ?? 0),
      storedTokenCount: Number(row?.stored_token_count ?? 0),
      latestTokenCreatedAt,
      latestTokenAgeMs: Option.getOrNull(
        Option.map(Option.fromNullishOr(latestTokenCreatedAt), (value) => Math.max(0, now - value)),
      ),
    }
  }

  createParticipantWsToken(input: {
    id: string
    participantId: string
    tokenHash: string
    createdAt: number
    expiresAt: number
  }): void {
    this.sql.exec(
      `INSERT INTO participant_ws_tokens (id, participant_id, token_hash, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
      input.id,
      input.participantId,
      input.tokenHash,
      input.createdAt,
      input.expiresAt,
    )
    this.updateParticipantWsToken(input.participantId, input.tokenHash, input.createdAt)
  }

  pruneExpiredParticipantWsTokens(now: number): void {
    this.sql.exec("DELETE FROM participant_ws_tokens WHERE expires_at < ?1", now)
  }

  createParticipant(input: {
    id: string
    userId: string
    githubLogin?: string | null
    githubName?: string | null
    githubEmail?: string | null
    role: "owner" | "member"
    joinedAt: number
  }): void {
    this.sql.exec(
      `INSERT INTO participants (id, user_id, github_login, github_name, github_email, role, joined_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      input.id,
      input.userId,
      input.githubLogin ?? null,
      input.githubName ?? null,
      input.githubEmail ?? null,
      input.role,
      input.joinedAt,
    )
  }

  updateParticipantWsToken(participantId: string, tokenHash: string, timestamp: number): void {
    this.sql.exec(
      "UPDATE participants SET ws_auth_token = ?1, ws_token_created_at = ?2 WHERE id = ?3",
      tokenHash,
      timestamp,
      participantId,
    )
  }

  listParticipants(): ParticipantRow[] {
    return this.sql
      .exec("SELECT * FROM participants ORDER BY joined_at ASC")
      .toArray() as ParticipantRow[]
  }

  createMessage(input: {
    id: string
    authorId: string
    content: string
    source: MessageSource
    model?: string | null
    reasoningEffort?: string | null
    executionMode: PromptExecutionMode
    attachments?: string | null
    callbackContext?: string | null
    status: MessageStatus
    createdAt: number
  }): void {
    this.sql.exec(
      `INSERT INTO messages (id, author_id, content, source, model, reasoning_effort, execution_mode, attachments, callback_context, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      input.id,
      input.authorId,
      input.content,
      input.source,
      input.model ?? null,
      input.reasoningEffort ?? null,
      input.executionMode,
      input.attachments ?? null,
      input.callbackContext ?? null,
      input.status,
      input.createdAt,
    )
  }

  getPendingOrProcessingCount(): number {
    const result = this.sql.exec(
      "SELECT COUNT(*) as count FROM messages WHERE status IN ('pending', 'processing')",
    )
    return (result.one() as { count: number } | undefined)?.count ?? 0
  }

  getProcessingMessage(): Option.Option<MessageRow> {
    const result = this.sql
      .exec("SELECT * FROM messages WHERE status = 'processing' LIMIT 1")
      .toArray() as MessageRow[]
    return Option.fromNullishOr(result[0])
  }

  getMessageById(messageId: string): Option.Option<MessageRow> {
    const result = this.sql
      .exec("SELECT * FROM messages WHERE id = ?1 LIMIT 1", messageId)
      .toArray() as MessageRow[]
    return Option.fromNullishOr(result[0])
  }

  listMessagesByStatus(status: MessageStatus, limit: number): MessageRow[] {
    return this.sql
      .exec(
        "SELECT * FROM messages WHERE status = ?1 ORDER BY created_at DESC LIMIT ?2",
        status,
        limit,
      )
      .toArray() as MessageRow[]
  }

  getNextPendingMessage(): Option.Option<MessageRow> {
    const result = this.sql
      .exec("SELECT * FROM messages WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1")
      .toArray() as MessageRow[]
    return Option.fromNullishOr(result[0])
  }

  updateMessageToProcessing(messageId: string, startedAt: number): void {
    this.sql.exec(
      "UPDATE messages SET status = 'processing', started_at = ?1 WHERE id = ?2",
      startedAt,
      messageId,
    )
  }

  updateMessageCompletion(
    messageId: string,
    status: MessageStatus,
    completedAt: number,
    errorMessage?: string,
  ): void {
    this.sql.exec(
      "UPDATE messages SET status = ?1, completed_at = ?2, error_message = ?3 WHERE id = ?4",
      status,
      completedAt,
      errorMessage ?? null,
      messageId,
    )
  }

  failPendingAndProcessingMessages(completedAt: number, errorMessage: string): void {
    this.sql.exec(
      `UPDATE messages
       SET status = 'failed', completed_at = ?1, error_message = ?2
       WHERE status IN ('pending', 'processing')`,
      completedAt,
      errorMessage,
    )
  }

  getMessageCount(): number {
    const result = this.sql.exec("SELECT COUNT(*) as count FROM messages")
    return (result.one() as { count: number } | undefined)?.count ?? 0
  }

  listMessages(limit: number): MessageRow[] {
    return this.sql
      .exec("SELECT * FROM messages ORDER BY created_at DESC LIMIT ?1", limit)
      .toArray() as MessageRow[]
  }

  createArtifact(input: {
    id: string
    type: string
    url: string | null
    metadata: string | null
    createdAt: number
  }): void {
    this.sql.exec(
      "INSERT INTO artifacts (id, type, url, metadata, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      input.id,
      input.type,
      input.url,
      input.metadata,
      input.createdAt,
    )
  }

  getLatestArtifactByType(type: string): Option.Option<ArtifactRow> {
    const result = this.sql
      .exec(
        "SELECT * FROM artifacts WHERE type = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
        type,
      )
      .toArray() as ArtifactRow[]
    return Option.fromNullishOr(result[0])
  }

  private rewriteArtifact(
    existing: ArtifactRow,
    input: { url: string | null; metadata: string | null; createdAt: number },
  ): ArtifactRow {
    this.sql.exec(
      `UPDATE artifacts
         SET url = ?1,
             metadata = ?2,
             created_at = ?3
         WHERE id = ?4`,
      input.url,
      input.metadata,
      input.createdAt,
      existing.id,
    )
    return {
      ...existing,
      url: input.url,
      metadata: input.metadata,
      created_at: input.createdAt,
    }
  }

  private writeNewArtifact(input: {
    id: string
    type: string
    url: string | null
    metadata: string | null
    createdAt: number
  }): ArtifactRow {
    this.createArtifact(input)
    return {
      id: input.id,
      type: input.type,
      url: input.url,
      metadata: input.metadata,
      created_at: input.createdAt,
    }
  }

  upsertArtifactByType(input: {
    id: string
    type: string
    url: string | null
    metadata: string | null
    createdAt: number
  }): ArtifactRow {
    return Option.match(this.getLatestArtifactByType(input.type), {
      onNone: () => this.writeNewArtifact(input),
      onSome: (existing) => this.rewriteArtifact(existing, input),
    })
  }

  listArtifacts(): ArtifactRow[] {
    return this.sql
      .exec("SELECT * FROM artifacts ORDER BY created_at DESC")
      .toArray() as ArtifactRow[]
  }

  upsertWsClientMapping(input: {
    wsId: string
    participantId: string
    clientId: string
    createdAt: number
  }): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO ws_client_mapping (ws_id, participant_id, client_id, created_at)
       VALUES (?1, ?2, ?3, ?4)`,
      input.wsId,
      input.participantId,
      input.clientId,
      input.createdAt,
    )
  }

  hasWsClientMapping(wsId: string): boolean {
    const rows = this.sql
      .exec("SELECT ws_id FROM ws_client_mapping WHERE ws_id = ?1 LIMIT 1", wsId)
      .toArray() as Array<{ ws_id: string }>
    return rows.length > 0
  }

  getWsClientMapping(wsId: string): Option.Option<{
    participant_id: string
    client_id: string
    user_id: string
    github_name: string | null
    github_login: string | null
  }> {
    const rows = this.sql
      .exec(
        `SELECT m.participant_id, m.client_id, p.user_id, p.github_name, p.github_login
         FROM ws_client_mapping m
         JOIN participants p ON p.id = m.participant_id
         WHERE m.ws_id = ?1 LIMIT 1`,
        wsId,
      )
      .toArray() as Array<{
      participant_id: string
      client_id: string
      user_id: string
      github_name: string | null
      github_login: string | null
    }>
    return Option.fromNullishOr(rows[0])
  }
}

/**
 * Promise/`null`-facing view of {@link SessionRepository} for the non-Effect sandbox lifecycle
 * manager and Cloudflare sandbox provider. Those modules are not Effect files, so this boundary
 * re-surfaces the migrated `Option` reads as `T | null` without forcing them to depend on `effect`.
 */
export interface SessionRuntimeRepository {
  getSession(): SessionRow | null
  getSandbox(): SandboxRow | null
  listParticipants(): ParticipantRow[]
  resetSandbox(status: SandboxStatus): void
  updateSandboxStatus(status: SandboxStatus): void
  updateSandboxLastActivity(timestamp: number): void
  updateSandboxSpawnError(errorMessage: string | null, timestamp: number | null): void
  updateSandboxForSpawn(input: {
    status: SandboxStatus
    sandboxId: string
    authToken: string
    createdAt: number
  }): void
  updateSandboxOpencodeSessionId(opencodeSessionId: string | null): void
  updateSandboxOpencodeServer(port: number | null, configSignature: string | null): void
  recordRuntimeActivity(
    input: RuntimeActivityCreateInput & { sandboxId?: string | null },
  ): RuntimeActivityRow | null
}

/** Adapts an {@link SessionRepository} into the `null`-facing {@link SessionRuntimeRepository}. */
export function toSessionRuntimeRepository(
  repository: SessionRepository,
): SessionRuntimeRepository {
  return {
    getSession: () => Option.getOrNull(repository.getSession()),
    getSandbox: () => Option.getOrNull(repository.getSandbox()),
    listParticipants: () => repository.listParticipants(),
    resetSandbox: (status) => repository.resetSandbox(status),
    updateSandboxStatus: (status) => repository.updateSandboxStatus(status),
    updateSandboxLastActivity: (timestamp) => repository.updateSandboxLastActivity(timestamp),
    updateSandboxSpawnError: (errorMessage, timestamp) =>
      repository.updateSandboxSpawnError(errorMessage, timestamp),
    updateSandboxForSpawn: (input) => repository.updateSandboxForSpawn(input),
    updateSandboxOpencodeSessionId: (opencodeSessionId) =>
      repository.updateSandboxOpencodeSessionId(opencodeSessionId),
    updateSandboxOpencodeServer: (port, configSignature) =>
      repository.updateSandboxOpencodeServer(port, configSignature),
    recordRuntimeActivity: (input) => Option.getOrNull(repository.recordRuntimeActivity(input)),
  }
}

function normalizeSessionRow(row: SessionRow): SessionRow {
  return {
    ...row,
    agent_runtime: resolveAgentRuntime({
      agentRuntime: row.agent_runtime,
      sessionKind: row.session_kind,
    }),
    subagents: resolveSessionSubagentMode(row.session_kind, row.subagents),
  }
}
