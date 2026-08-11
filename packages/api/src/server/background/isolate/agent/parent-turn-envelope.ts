import * as Option from "effect/Option"
import type { IsolatePromptRequest } from "./types"

const PARENT_TURN_ENVELOPE_TABLE = "s0_isolate_parent_turn_recovery"

export interface IsolateParentTurnEnvelope {
  messageId: string
  requestedModel: string
  reasoningEffort?: string
  repoWarning: string | null
  githubAccessToken?: string | null
  finalizingAfterStepLimit: boolean
}

interface SqlResult {
  toArray(): unknown[]
}

export interface ParentTurnEnvelopeSql {
  exec(query: string, ...params: unknown[]): SqlResult
}

interface ParentTurnEnvelopeRow {
  message_id: string
  requested_model: string
  reasoning_effort: string | null
  repo_warning: string | null
  github_access_token: string | null
  finalizing_after_step_limit: number
}

/**
 * Projects only trusted runtime metadata from a prompt request. In particular,
 * the prompt body, tracing context, and stream callback cannot enter the durable
 * recovery envelope.
 */
export function parentTurnEnvelopeFromPrompt(
  request: IsolatePromptRequest,
  repoWarning: string | null,
): IsolateParentTurnEnvelope {
  return {
    messageId: request.messageId,
    requestedModel: request.model,
    reasoningEffort: request.reasoningEffort,
    repoWarning,
    githubAccessToken: request.githubAccessToken,
    finalizingAfterStepLimit: false,
  }
}

export function registerParentTurnEnvelope(
  sql: ParentTurnEnvelopeSql,
  envelope: IsolateParentTurnEnvelope,
): void {
  ensureParentTurnEnvelopeTable(sql)
  sql.exec(
    `INSERT OR REPLACE INTO ${PARENT_TURN_ENVELOPE_TABLE}
       (singleton, message_id, requested_model, reasoning_effort, repo_warning,
        github_access_token, finalizing_after_step_limit, created_at)
     VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    envelope.messageId,
    envelope.requestedModel,
    envelope.reasoningEffort ?? null,
    envelope.repoWarning,
    envelope.githubAccessToken ?? null,
    Number(envelope.finalizingAfterStepLimit),
    Date.now(),
  )
}

export function readParentTurnEnvelope(
  sql: ParentTurnEnvelopeSql,
): Option.Option<IsolateParentTurnEnvelope> {
  ensureParentTurnEnvelopeTable(sql)
  const rows = sql
    .exec(
      `SELECT message_id, requested_model, reasoning_effort, repo_warning,
              github_access_token, finalizing_after_step_limit
       FROM ${PARENT_TURN_ENVELOPE_TABLE}
       WHERE singleton = 1
       LIMIT 1`,
    )
    .toArray() as ParentTurnEnvelopeRow[]

  return Option.fromNullishOr(rows[0]).pipe(
    Option.map((row) => ({
      messageId: row.message_id,
      requestedModel: row.requested_model,
      reasoningEffort: Option.getOrUndefined(Option.fromNullishOr(row.reasoning_effort)),
      repoWarning: row.repo_warning,
      githubAccessToken: Option.getOrUndefined(Option.fromNullishOr(row.github_access_token)),
      finalizingAfterStepLimit: row.finalizing_after_step_limit === 1,
    })),
  )
}

export function setParentTurnFinalizationMode(
  sql: ParentTurnEnvelopeSql,
  finalizingAfterStepLimit: boolean,
): void {
  ensureParentTurnEnvelopeTable(sql)
  sql.exec(
    `UPDATE ${PARENT_TURN_ENVELOPE_TABLE}
     SET finalizing_after_step_limit = ?1
     WHERE singleton = 1`,
    Number(finalizingAfterStepLimit),
  )
}

export function clearParentTurnEnvelope(sql: ParentTurnEnvelopeSql): void {
  ensureParentTurnEnvelopeTable(sql)
  sql.exec(`DELETE FROM ${PARENT_TURN_ENVELOPE_TABLE} WHERE singleton = 1`)
}

function ensureParentTurnEnvelopeTable(sql: ParentTurnEnvelopeSql): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS ${PARENT_TURN_ENVELOPE_TABLE} (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    message_id TEXT NOT NULL,
    requested_model TEXT NOT NULL,
    reasoning_effort TEXT,
    repo_warning TEXT,
    github_access_token TEXT,
    finalizing_after_step_limit INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`)
}
