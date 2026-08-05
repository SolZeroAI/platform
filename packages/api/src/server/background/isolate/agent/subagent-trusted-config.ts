import { parseJson, stringifyJson } from "../../../lib/json"
import type { IsolateSubagentRunInput } from "../subagent"

export type IsolateSubagentTrustedConfig = Omit<IsolateSubagentRunInput, "delegation">

export function trustedConfigFromRunInput(
  input: IsolateSubagentRunInput,
): IsolateSubagentTrustedConfig {
  return {
    parentSessionId: input.parentSessionId,
    userId: input.userId,
    repoOwner: input.repoOwner,
    repoName: input.repoName,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    stepLimit: input.stepLimit,
    selectedTools: input.selectedTools,
    customMcpServers: input.customMcpServers,
  }
}

interface SqlResult {
  toArray(): unknown[]
}

export interface SubagentTrustedConfigSql {
  exec(query: string, ...params: unknown[]): SqlResult
}

interface TrustedConfigRow {
  config_json: string
}

export function registerSubagentTrustedConfig(
  sql: SubagentTrustedConfigSql,
  runId: string,
  config: IsolateSubagentTrustedConfig,
): void {
  ensureTrustedConfigTable(sql)
  sql.exec(
    `INSERT OR REPLACE INTO s0_isolate_subagent_trusted_config
       (run_id, config_json, created_at)
     VALUES (?1, ?2, ?3)`,
    runId,
    stringifyJson(config),
    Date.now(),
  )
}

export function readSubagentTrustedConfig(
  sql: SubagentTrustedConfigSql,
  runId: string,
): IsolateSubagentTrustedConfig | null {
  ensureTrustedConfigTable(sql)
  const rows = sql
    .exec(
      `SELECT config_json
       FROM s0_isolate_subagent_trusted_config
       WHERE run_id = ?1
       LIMIT 1`,
      runId,
    )
    .toArray() as TrustedConfigRow[]
  const row = rows[0]
  return row ? (parseJson(row.config_json) as IsolateSubagentTrustedConfig) : null
}

export function releaseSubagentTrustedConfig(sql: SubagentTrustedConfigSql, runId: string): void {
  ensureTrustedConfigTable(sql)
  sql.exec("DELETE FROM s0_isolate_subagent_trusted_config WHERE run_id = ?1", runId)
}

export function clearSubagentTrustedConfigs(sql: SubagentTrustedConfigSql): void {
  ensureTrustedConfigTable(sql)
  sql.exec("DELETE FROM s0_isolate_subagent_trusted_config")
}

function ensureTrustedConfigTable(sql: SubagentTrustedConfigSql): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS s0_isolate_subagent_trusted_config (
    run_id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`)
}
