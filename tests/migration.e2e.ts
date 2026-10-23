import { randomBytes } from "node:crypto"
import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, test } from "e2e"
import * as Effect from "effect/Effect"
import { copyControlPlane } from "../packages/api/src/cli/d1-to-planetscale-copy"
import { planPlanetscaleCutoverEdits } from "../packages/api/src/cli/d1-to-planetscale-cutover-diff"
import { withMigrationDatabases } from "./support/migration"

describe("offline migration contracts", { platforms: ["tools"] }, () => {
  test("the operator CLI plans, requires a freeze acknowledgement, applies and verifies a real Postgres connection", async () => {
    await withMigrationDatabases(async ({ source, postgres, url }) => {
      const directory = await mkdtemp(join(tmpdir(), "solzero-copy-cli-"))
      try {
        const dump = join(directory, "source.sqlite")
        source.exec(`VACUUM INTO '${dump.replaceAll("'", "''")}'`)
        const run = (flags: string[]) =>
          new Promise<{ status: number | null; stdout: string; stderr: string }>(
            (accept, reject) => {
              const child = spawn(
                process.execPath,
                [
                  "--import",
                  import.meta.resolve("tsx"),
                  resolve("scripts/copy-d1-to-planetscale.ts"),
                  "--source-sqlite",
                  dump,
                  ...flags,
                ],
                { env: { ...process.env, DATABASE_URL: url }, stdio: ["ignore", "pipe", "pipe"] },
              )
              let stdout = "",
                stderr = ""
              child.stdout.on("data", (chunk) => {
                stdout += chunk
              })
              child.stderr.on("data", (chunk) => {
                stderr += chunk
              })
              child.once("error", reject)
              child.once("exit", (status) => accept({ status, stdout, stderr }))
            },
          )
        const planned = await run([])
        expect(planned.status).toBe(0)
        expect(planned.stdout).toContain("status=planned")
        const denied = await run(["--apply"])
        expect(denied.status).not.toBe(0)
        expect((denied.stdout + denied.stderr).includes("--source-writes-frozen")).toBe(true)
        const applied = await run(["--apply", "--source-writes-frozen", "--batch-size", "2"])
        expect(applied.status).toBe(0)
        expect(applied.stdout).toContain("status=success")
        const proof = await run(["--verify-only"])
        expect(proof.status).toBe(0)
        expect(proof.stdout).toContain("status=verified")
        expect((await postgres.query("SELECT id FROM agent_skills")).rows).toEqual([
          { id: "skill_c0_create_pr" },
        ])
        expect(
          [planned, denied, applied, proof].some((result) =>
            (result.stdout + result.stderr).includes(new URL(url).password),
          ),
        ).toBe(false)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  })

  test("legacy built-in IDs, preferences, workflow webhook IDs and auth values survive a bounded verified copy", async () => {
    await withMigrationDatabases(
      async ({ source, postgres, destination, queryParameterCounts }) => {
        source.exec(`INSERT INTO user_agent_skill_preferences VALUES ('owner', 'skill_c0_create_pr', 1, 1, 1);
        INSERT INTO workflows VALUES ('workflow-original', 'owner', 'fixture', 'active', 1, 'manifest/original', 'code/original', 'webhook-original', 1, 1);
        INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES ('owner','Owner','owner@example.test',1,'2026-01-01','2026-01-01');`)
        const secret = randomBytes(48).toString("base64url")
        const insert = source.prepare(
          "INSERT INTO global_secrets (key,encrypted_value,created_at,updated_at) VALUES (?, ?, 1, 1)",
        )
        for (let index = 0; index < 7; index++) insert.run(`key-${index}`, secret)
        const planned = await Effect.runPromise(
          copyControlPlane({
            source,
            dest: destination,
            apply: false,
            overwrite: false,
            batchSize: 2,
          }),
        )
        expect(planned.status).toBe("planned")
        expect(
          (await postgres.query("SELECT count(*)::integer AS count FROM workflows")).rows,
        ).toEqual([{ count: 0 }])
        const copied = await Effect.runPromise(
          copyControlPlane({
            source,
            dest: destination,
            apply: true,
            overwrite: false,
            batchSize: 2,
          }),
        )
        expect(copied.reconciledBuiltinSeed).toBe(true)
        expect(
          copied.tables.every(
            (table) =>
              table.verified &&
              table.sourceChecksum === table.destChecksum &&
              table.sourceRows === table.destRowsAfter,
          ),
        ).toBe(true)
        expect(Math.max(...queryParameterCounts)).toBeLessThanOrEqual(34)
        expect((await postgres.query("SELECT id FROM agent_skills")).rows).toEqual([
          { id: "skill_c0_create_pr" },
        ])
        expect(
          (await postgres.query("SELECT skill_id FROM user_agent_skill_preferences")).rows,
        ).toEqual([{ skill_id: "skill_c0_create_pr" }])
        expect((await postgres.query("SELECT id, webhook_id FROM workflows")).rows).toEqual([
          { id: "workflow-original", webhook_id: "webhook-original" },
        ])
        expect((await postgres.query('SELECT "emailVerified" FROM "user"')).rows).toEqual([
          { emailVerified: true },
        ])
        expect(JSON.stringify(copied).includes(secret)).toBe(false)
        const verified = await Effect.runPromise(
          copyControlPlane({
            source,
            dest: destination,
            apply: false,
            overwrite: false,
            verifyOnly: true,
            batchSize: 2,
          }),
        )
        expect(verified.status).toBe("verified")
        const rerun = await Effect.runPromise(
          copyControlPlane({ source, dest: destination, apply: true, overwrite: false }),
        )
        expect(rerun.inserted).toBe(0)
        await postgres.exec("UPDATE workflows SET name = 'changed' WHERE id = 'workflow-original'")
        const mismatch = await Effect.runPromise(
          copyControlPlane({
            source,
            dest: destination,
            apply: false,
            overwrite: false,
            verifyOnly: true,
          }).pipe(Effect.flip),
        )
        expect(mismatch.message).toContain("checksums differ")
      },
    )
  })

  test("unmapped tables and source columns fail before destination writes", async () => {
    await withMigrationDatabases(async ({ source, postgres, destination }) => {
      source.exec("CREATE TABLE unexpected_state (id TEXT PRIMARY KEY)")
      const unknown = await Effect.runPromise(
        copyControlPlane({ source, dest: destination, apply: true, overwrite: true }).pipe(
          Effect.flip,
        ),
      )
      expect(unknown.message).toContain("Unmapped source tables")
      expect((await postgres.query("SELECT id FROM agent_skills")).rows).toEqual([
        { id: "skill_s0_create_pr" },
      ])
      source.exec("DROP TABLE unexpected_state; ALTER TABLE workflows ADD COLUMN future_data TEXT")
      const unmapped = await Effect.runPromise(
        copyControlPlane({ source, dest: destination, apply: true, overwrite: true }).pipe(
          Effect.flip,
        ),
      )
      expect(unmapped.message).toContain("Unmapped columns")
    })
  })

  test("conflicting rows roll back seed reconciliation and all earlier inserts", async () => {
    await withMigrationDatabases(async ({ source, postgres, destination }) => {
      source.exec("INSERT INTO mcpcf_config (id,created_at,updated_at) VALUES ('config',1,1)")
      await postgres.exec(
        "INSERT INTO mcpcf_config (id,base_url,created_at,updated_at) VALUES ('config','https://different.example.test',1,1)",
      )
      const conflicting = await Effect.runPromise(
        copyControlPlane({ source, dest: destination, apply: true, overwrite: false }).pipe(
          Effect.flip,
        ),
      )
      expect(conflicting.message).toContain("conflicting rows")
      expect((await postgres.query("SELECT id FROM agent_skills")).rows).toEqual([
        { id: "skill_s0_create_pr" },
      ])
      expect((await postgres.query("SELECT base_url FROM mcpcf_config")).rows).toEqual([
        { base_url: "https://different.example.test" },
      ])
    })
  })

  test("modified destination built-ins and unrelated rows are never silently removed", async () => {
    await withMigrationDatabases(async ({ source, postgres, destination }) => {
      await postgres.exec("UPDATE agent_skills SET description = 'operator edit'")
      const modified = await Effect.runPromise(
        copyControlPlane({ source, dest: destination, apply: true, overwrite: true }).pipe(
          Effect.flip,
        ),
      )
      expect(modified.message).toContain("not the untouched migration seed")
      expect((await postgres.query("SELECT description FROM agent_skills")).rows).toEqual([
        { description: "operator edit" },
      ])
    })
  })

  test("verification inside the transaction rolls back data altered by a destination trigger", async () => {
    await withMigrationDatabases(async ({ source, postgres, destination }) => {
      source.exec(
        "INSERT INTO workflows VALUES ('original', 'owner', 'original', 'active', 1, 'manifest', 'code', 'webhook', 1, 1)",
      )
      await postgres.exec(
        "CREATE FUNCTION alter_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.name := 'changed'; RETURN NEW; END $$; CREATE TRIGGER alter_import BEFORE INSERT ON workflows FOR EACH ROW EXECUTE FUNCTION alter_import()",
      )
      const failed = await Effect.runPromise(
        copyControlPlane({ source, dest: destination, apply: true, overwrite: false }).pipe(
          Effect.flip,
        ),
      )
      expect(failed.message).toContain("checksums differ")
      expect(
        (await postgres.query("SELECT count(*)::integer AS count FROM workflows")).rows,
      ).toEqual([{ count: 0 }])
      expect((await postgres.query("SELECT id FROM agent_skills")).rows).toEqual([
        { id: "skill_s0_create_pr" },
      ])
    })
  })

  test("cutover reports omit all secret values, including unchanged assignments inside diff hunks", async () => {
    const secret = randomBytes(48).toString("base64url")
    const edits = planPlanetscaleCutoverEdits({
      jsonc: "{}\n",
      jsoncPath: "config/prod.config.jsonc",
      envPath: "config/.env",
      envFile: `DATABASE=d1\nUNRELATED_SECRET=${secret}\nPLANETSCALE_SERVICE_TOKEN=${secret}\nAPP_DB_MODE=local\n`,
    })
    expect(edits.envDiff.includes(secret)).toBe(false)
    expect(edits.envDiff).not.toContain("UNRELATED_SECRET")
    expect(edits.envDiff).toContain("DATABASE=planetscale")
    expect(edits.nextEnv.includes(secret)).toBe(true)
  })
})
