import { readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const migrationsDir = resolve(__dirname, "../../packages/infra/d1-migrations")

function getMigrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((filename) => filename.endsWith(".sql"))
    .sort()
}

describe("D1 migrations", () => {
  it("apply cleanly from scratch", () => {
    const db = new DatabaseSync(":memory:")

    try {
      for (const filename of getMigrationFiles()) {
        const sql = readFileSync(resolve(migrationsDir, filename), "utf8")

        expect(() => db.exec(sql)).not.toThrow()
      }

      const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{
        name: string
      }>

      expect(sessionColumns.filter((column) => column.name === "session_kind")).toHaveLength(1)
      expect(sessionColumns.filter((column) => column.name === "agent_runtime")).toHaveLength(1)
      expect(sessionColumns.filter((column) => column.name === "source")).toHaveLength(1)
      expect(sessionColumns.filter((column) => column.name === "isolate_step_limit")).toHaveLength(
        1,
      )
      expect(sessionColumns.filter((column) => column.name === "secret_keys_json")).toHaveLength(1)
      expect(sessionColumns.filter((column) => column.name === "subagents")).toHaveLength(1)

      const globalSecretColumns = db.prepare("PRAGMA table_info(global_secrets)").all() as Array<{
        name: string
      }>
      expect(globalSecretColumns.filter((column) => column.name === "tags")).toHaveLength(1)

      const repoSecretTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'repo_secrets'")
        .all()
      expect(repoSecretTable).toHaveLength(0)

      const providerPreferenceColumns = db
        .prepare("PRAGMA table_info(user_provider_preferences)")
        .all() as Array<{ name: string }>
      expect(
        providerPreferenceColumns.filter((column) => column.name === "default_isolate_step_limit"),
      ).toHaveLength(1)
      expect(
        providerPreferenceColumns.filter((column) => column.name === "opencode_permission_json"),
      ).toHaveLength(1)

      const adminAuditColumns = db.prepare("PRAGMA table_info(admin_audit_events)").all() as Array<{
        name: string
      }>

      expect(adminAuditColumns.filter((column) => column.name === "admin_email")).toHaveLength(1)
      expect(adminAuditColumns.filter((column) => column.name === "target_type")).toHaveLength(1)

      const mcpcfConfigColumns = db.prepare("PRAGMA table_info(mcpcf_config)").all() as Array<{
        name: string
      }>
      const mcpcfServerColumns = db.prepare("PRAGMA table_info(mcpcf_servers)").all() as Array<{
        name: string
      }>

      expect(mcpcfConfigColumns.filter((column) => column.name === "base_url")).toHaveLength(1)
      expect(
        mcpcfConfigColumns.filter((column) => column.name === "user_oauth_provider_id"),
      ).toHaveLength(1)
      expect(mcpcfServerColumns.filter((column) => column.name === "auth_type")).toHaveLength(1)
      expect(mcpcfServerColumns.filter((column) => column.name === "tools_json")).toHaveLength(1)

      const userMcpcfConfigColumns = db
        .prepare("PRAGMA table_info(user_mcpcf_server_configs)")
        .all() as Array<{ name: string }>
      expect(
        userMcpcfConfigColumns.filter((column) => column.name === "auth_token_secret_key"),
      ).toHaveLength(1)
      expect(
        userMcpcfConfigColumns.filter((column) => column.name === "default_tools_enabled"),
      ).toHaveLength(1)
      expect(
        userMcpcfConfigColumns.filter((column) => column.name === "disabled_tools_json"),
      ).toHaveLength(1)

      const cronRunsColumns = db.prepare("PRAGMA table_info(cron_runs)").all() as Array<{
        name: string
      }>
      expect(cronRunsColumns.filter((column) => column.name === "job_id")).toHaveLength(1)
      expect(cronRunsColumns.filter((column) => column.name === "trigger")).toHaveLength(1)
      expect(cronRunsColumns.filter((column) => column.name === "result_json")).toHaveLength(1)
      expect(cronRunsColumns.filter((column) => column.name === "error_message")).toHaveLength(1)

      const agentSkillColumns = db.prepare("PRAGMA table_info(agent_skills)").all() as Array<{
        name: string
      }>
      expect(agentSkillColumns.filter((column) => column.name === "runtime_scope")).toHaveLength(1)
      expect(agentSkillColumns.filter((column) => column.name === "source_hash")).toHaveLength(1)
      expect(agentSkillColumns.filter((column) => column.name === "deleted_at")).toHaveLength(1)
      expect(db.prepare("PRAGMA table_info(user_agent_skill_preferences)").all()).not.toHaveLength(
        0,
      )
      expect(
        db
          .prepare(
            "SELECT slug, runtime_scope, origin, default_enabled FROM agent_skills WHERE id = ?",
          )
          .get("skill_s0_create_pr"),
      ).toEqual({
        slug: "s0-create-pr",
        runtime_scope: "harness",
        origin: "built-in",
        default_enabled: 1,
      })

      const botsColumns = db.prepare("PRAGMA table_info(bots)").all() as Array<{ name: string }>
      const botRoutineColumns = db.prepare("PRAGMA table_info(bot_routines)").all() as Array<{
        name: string
      }>
      expect(botsColumns.filter((column) => column.name === "session_id")).toHaveLength(1)
      expect(botRoutineColumns.filter((column) => column.name === "cadence_json")).toHaveLength(1)
      expect(botRoutineColumns.filter((column) => column.name === "until")).toHaveLength(1)
      expect(botRoutineColumns.filter((column) => column.name === "watch_json")).toHaveLength(1)
    } finally {
      db.close()
    }
  })

  it("enables sub-agents for existing isolate sessions and disables them for sandboxes", () => {
    const db = new DatabaseSync(":memory:")

    try {
      for (const filename of getMigrationFiles().filter((filename) => filename < "0029_")) {
        db.exec(readFileSync(resolve(migrationsDir, filename), "utf8"))
      }

      const insert = db.prepare(
        `INSERT INTO sessions (
          id, user_id, repo_owner, repo_name, model, session_kind, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      insert.run("isolate-1", "user-1", "", "", "litellm/gpt-5.4-mini", "isolate", "created", 1, 1)
      insert.run("sandbox-1", "user-1", "", "", "litellm/gpt-5.4-mini", "sandbox", "created", 1, 1)

      db.exec(readFileSync(resolve(migrationsDir, "0029_session_subagents.sql"), "utf8"))

      expect(db.prepare("SELECT subagents FROM sessions WHERE id = ?").get("isolate-1")).toEqual({
        subagents: "enabled",
      })
      expect(db.prepare("SELECT subagents FROM sessions WHERE id = ?").get("sandbox-1")).toEqual({
        subagents: "disabled",
      })
    } finally {
      db.close()
    }
  })

  it("rewrites stored session tools from context_forge_server to mcpcf_server", () => {
    const db = new DatabaseSync(":memory:")

    try {
      const migrationFiles = getMigrationFiles()
      for (const filename of migrationFiles.filter((filename) => filename < "0017_")) {
        db.exec(readFileSync(resolve(migrationsDir, filename), "utf8"))
      }

      db.prepare(
        `INSERT INTO sessions (
          id, user_id, repo_owner, repo_name, model, status, created_at, updated_at, tools_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "session_1",
        "user_1",
        "",
        "",
        "litellm/gpt-5.4-mini",
        "created",
        1,
        1,
        JSON.stringify([{ kind: "context_forge_server", serverId: "server_grafana" }]),
      )

      db.exec(readFileSync(resolve(migrationsDir, "0017_mcpcf_registry.sql"), "utf8"))

      const row = db.prepare("SELECT tools_json FROM sessions WHERE id = ?").get("session_1") as {
        tools_json: string
      }
      expect(JSON.parse(row.tools_json)).toEqual([
        { kind: "mcpcf_server", serverId: "server_grafana" },
      ])
    } finally {
      db.close()
    }
  })
})
