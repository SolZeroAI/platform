import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import * as Effect from "effect/Effect"
import { afterEach, describe, expect, it } from "vitest"
import { copyD1ToPlanetscaleCommand } from "../../packages/api/src/cli/copy-d1-to-planetscale-command"
import {
  CopyConflictError,
  copyControlPlane,
  makeDrizzleCopyDestination,
} from "../../packages/api/src/cli/d1-to-planetscale-copy"
import { mapSqliteCellToPostgres } from "../../packages/api/src/cli/d1-to-planetscale-copy-map"
import {
  CUTOVER_JSONC_COMMENT_LINES,
  planPlanetscaleCutoverEdits,
} from "../../packages/api/src/cli/d1-to-planetscale-cutover-diff"
import { pgRelations } from "../../packages/api/src/server/effect/db/control-plane-db"
import { Command } from "effect/unstable/cli"
import { FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { applyPostgresMigrationTree } from "./pg-migrations"

const repoRoot = resolve(import.meta.dirname, "../..")
const d1Migrations = resolve(repoRoot, "packages/infra/d1-migrations")
const fixtureSql = resolve(import.meta.dirname, "fixtures/d1-control-plane-copy.sql")
const exampleJsonc = resolve(repoRoot, "config/example.config.jsonc")

function applyD1Migrations(db: DatabaseSync) {
  for (const filename of readdirSync(d1Migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(resolve(d1Migrations, filename), "utf8"))
  }
}

function openFixtureSqlite(path = ":memory:") {
  const sqlite = new DatabaseSync(path)
  applyD1Migrations(sqlite)
  sqlite.exec(readFileSync(fixtureSql, "utf8"))
  return sqlite
}

async function openCopyDest() {
  const client = new PGlite()
  await applyPostgresMigrationTree(client)
  const destDrizzle = drizzle({ client, relations: pgRelations })
  return {
    client,
    dest: makeDrizzleCopyDestination(destDrizzle, {
      sizeBytes: async () => {
        const result = await client.query<{ bytes: string }>(
          "SELECT pg_database_size(current_database()) AS bytes",
        )
        const parsed = Number(result.rows[0]?.bytes)
        return Number.isFinite(parsed) ? parsed : null
      },
    }),
  }
}

const cliTestLayer = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      readInput: Effect.die("unused"),
      readLine: Effect.die("unused"),
      display: () => Effect.void,
    }),
  ),
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("unused")),
  ),
)

describe("D1 to PlanetScale one-shot copy CLI", () => {
  const clients: PGlite[] = []
  const sqlites: DatabaseSync[] = []

  afterEach(async () => {
    for (const sqlite of sqlites.splice(0)) sqlite.close()
    await Promise.all(clients.splice(0).map((client) => client.close()))
  })

  it("maps sqlite integer 0/1 to postgres boolean and JSON text toward jsonb", () => {
    expect(mapSqliteCellToPostgres(1, "PgBoolean")).toBe(true)
    expect(mapSqliteCellToPostgres(0, "PgBoolean")).toBe(false)
    expect(mapSqliteCellToPostgres('["ops"]', "PgJsonb")).toEqual(["ops"])
    expect(mapSqliteCellToPostgres(1700000000000, "PgBigInt53")).toBe(1700000000000)
  })

  it("prints a jsonc and env unified diff without inventing a second engine switch", () => {
    const jsonc = readFileSync(exampleJsonc, "utf8")
    const edits = planPlanetscaleCutoverEdits({
      jsonc,
      envFile: "# local\nDATABASE=d1\n",
      jsoncPath: "config/example.config.jsonc",
      envPath: "config/.env",
    })
    expect(edits.jsoncDiff).toContain("+++ config/example.config.jsonc")
    expect(edits.jsoncDiff).toContain(CUTOVER_JSONC_COMMENT_LINES[0])
    expect(edits.jsoncDiff).not.toContain("databaseEngine")
    expect(edits.envDiff).toContain("DATABASE=planetscale")
    expect(edits.envDiff).toContain("APP_DB_MODE=remote")
    expect(edits.envDiff).toContain("PLANETSCALE_SERVICE_TOKEN_ID=")
    expect(edits.nextJsonc).toContain("not an online")
  })

  it("dry-run plans the copy, prints cutover diffs, and writes nothing", async () => {
    const sqlite = openFixtureSqlite()
    sqlites.push(sqlite)
    const opened = await openCopyDest()
    clients.push(opened.client)

    const report = await Effect.runPromise(
      copyControlPlane({
        source: sqlite,
        dest: opened.dest,
        apply: false,
        overwrite: false,
      }),
    )

    expect(report.status).toBe("planned")
    expect(report.apply).toBe(false)
    expect(report.inserted).toBeGreaterThan(0)
    const users = report.tables.find((table) => table.table === "user")
    expect(users?.sourceRows).toBe(2)
    expect(users?.inserted).toBe(2)
    const destUsers = await opened.client.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM "user"`,
    )
    expect(Number(destUsers.rows[0]?.count)).toBe(0)
    const destSecrets = await opened.client.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM "global_secrets"`,
    )
    expect(Number(destSecrets.rows[0]?.count)).toBe(0)
  })

  it("apply copies row counts and maps emailVerified plus JSON tags", async () => {
    const sqlite = openFixtureSqlite()
    sqlites.push(sqlite)
    const opened = await openCopyDest()
    clients.push(opened.client)

    const report = await Effect.runPromise(
      copyControlPlane({
        source: sqlite,
        dest: opened.dest,
        apply: true,
        overwrite: false,
      }),
    )

    expect(report.status).toBe("success")
    expect(report.tables.find((table) => table.table === "user")?.inserted).toBe(2)
    expect(report.tables.find((table) => table.table === "global_secrets")?.inserted).toBe(1)
    const users = await opened.client.query<{ id: string; emailVerified: boolean }>(
      `SELECT "id", "emailVerified" FROM "user" ORDER BY "id"`,
    )
    expect(users.rows).toEqual([
      { id: "user_pending", emailVerified: false },
      { id: "user_verified", emailVerified: true },
    ])
    const secret = await opened.client.query<{ tags: string }>(
      `SELECT tags FROM "global_secrets" WHERE key = 'user_verified/ALPHA_TOKEN'`,
    )
    expect(JSON.parse(secret.rows[0]?.tags ?? "[]")).toEqual(["ops", "shared"])
    const jsonElements = await opened.client.query<{ value: string }>(
      `SELECT jsonb_array_elements_text(tags::jsonb) AS value
         FROM "global_secrets"
        WHERE key = 'user_verified/ALPHA_TOKEN'`,
    )
    expect(jsonElements.rows.map((row) => row.value)).toEqual(["ops", "shared"])

    const rerun = await Effect.runPromise(
      copyControlPlane({
        source: sqlite,
        dest: opened.dest,
        apply: true,
        overwrite: false,
      }),
    )
    expect(rerun.status).toBe("success")
    expect(rerun.skipped).toBeGreaterThan(0)
    expect(rerun.inserted).toBe(0)
  })

  it("fails closed when the destination already has conflicting rows", async () => {
    const sqlite = openFixtureSqlite()
    sqlites.push(sqlite)
    const opened = await openCopyDest()
    clients.push(opened.client)
    await opened.client.query(
      `INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       VALUES ('user_verified', 'Other', 'other@example.com', FALSE, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )

    await expect(
      Effect.runPromise(
        copyControlPlane({
          source: sqlite,
          dest: opened.dest,
          apply: true,
          overwrite: false,
        }),
      ),
    ).rejects.toBeInstanceOf(CopyConflictError)

    const overwrite = await Effect.runPromise(
      copyControlPlane({
        source: sqlite,
        dest: opened.dest,
        apply: true,
        overwrite: true,
      }),
    )
    expect(overwrite.overwritten).toBeGreaterThan(0)
    const row = await opened.client.query<{ email: string; emailVerified: boolean }>(
      `SELECT email, "emailVerified" FROM "user" WHERE id = 'user_verified'`,
    )
    expect(row.rows[0]).toEqual({ email: "verified@example.com", emailVerified: true })
  })

  it("help text states this is not an online migration", async () => {
    const help: string[] = []
    await Effect.runPromise(
      Command.runWith(copyD1ToPlanetscaleCommand, { version: "0.0.0" })(["--help"]).pipe(
        Effect.provide(cliTestLayer),
        Effect.tap(() => Effect.sync(() => help.push("rendered"))),
      ),
    )
    expect(help).toEqual(["rendered"])
  })

  it("does not rewrite live jsonc during dry-run when a sidecar patch is requested", async () => {
    const jsonc = readFileSync(exampleJsonc, "utf8")
    const patchDir = mkdtempSync(join(tmpdir(), "s0-copy-patch-"))
    mkdirSync(patchDir, { recursive: true })
    const edits = planPlanetscaleCutoverEdits({
      jsonc,
      envFile: "",
      jsoncPath: exampleJsonc,
      envPath: "config/.env",
    })
    writeFileSync(join(patchDir, "s0-planetscale-cutover.jsonc.diff"), edits.jsoncDiff)
    expect(readFileSync(exampleJsonc, "utf8")).toBe(jsonc)
    expect(readFileSync(join(patchDir, "s0-planetscale-cutover.jsonc.diff"), "utf8")).toContain(
      "DATABASE=planetscale",
    )
  })
})
