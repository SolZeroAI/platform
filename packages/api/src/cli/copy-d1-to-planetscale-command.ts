import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { Command, Flag } from "effect/unstable/cli"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import {
  DATABASE_ENV,
  LOCAL_PGLITE_DATABASE_URL,
  PLANETSCALE_ORGANIZATION_ENV,
  PLANETSCALE_SERVICE_TOKEN_ENV,
  PLANETSCALE_SERVICE_TOKEN_ID_ENV,
} from "@solzero/shared"
import { pgRelations } from "../server/effect/db/control-plane-db"
import {
  CopyConflictError,
  copyControlPlane,
  makeDrizzleCopyDestination,
  type CopyReport,
} from "./d1-to-planetscale-copy"
import { planPlanetscaleCutoverEdits } from "./d1-to-planetscale-cutover-diff"

export const COPY_D1_TO_PLANETSCALE_BANNER = [
  "This is a one-shot convenience copy, not an online or zero-downtime migration.",
  "Writes can land on D1 during the copy window. After the copy succeeds, you deploy.",
  "Production stays on D1 until that deploy.",
].join("\n")

export const COPY_D1_TO_PLANETSCALE_NAME = "copy-d1-to-planetscale"

export function openSourceSqlite(path: string): DatabaseSync {
  const resolved = resolve(path)
  if (!existsSync(resolved)) {
    throw new Error(`Source dump not found: ${resolved}`)
  }
  if (resolved.endsWith(".sql")) {
    const sqlite = new DatabaseSync(":memory:")
    sqlite.exec(readFileSync(resolved, "utf8"))
    return sqlite
  }
  return new DatabaseSync(resolved, { readOnly: true })
}

export function formatCopyReport(report: CopyReport): string {
  const lines = [
    `status=${report.status}`,
    `apply=${report.apply}`,
    `overwrite=${report.overwrite}`,
    `durationMs=${report.durationMs}`,
    `sourceBytes=${report.sourceBytes ?? "unknown"}`,
    `destBytes=${report.destBytes ?? "unknown"}`,
    `inserted=${report.inserted}`,
    `skipped=${report.skipped}`,
    `conflicts=${report.conflicts}`,
    `overwritten=${report.overwritten}`,
  ]
  if (report.error) lines.push(`error=${report.error}`)
  lines.push("tables:")
  for (const table of report.tables) {
    lines.push(
      `  ${table.table} source=${table.sourceRows} destBefore=${table.destRowsBefore} destAfter=${table.destRowsAfter} inserted=${table.inserted} skipped=${table.skipped} conflicts=${table.conflicts} overwritten=${table.overwritten}`,
    )
  }
  return lines.join("\n")
}

export const copyD1ToPlanetscaleCommand = Command.make(
  COPY_D1_TO_PLANETSCALE_NAME,
  {
    apply: Flag.boolean("apply").pipe(
      Flag.withDescription("Write rows to PlanetScale. Default is dry-run and writes nothing."),
    ),
    overwrite: Flag.boolean("overwrite").pipe(
      Flag.withDescription(
        "Upsert destination rows that already exist with different values. Default fails closed.",
      ),
    ),
    sourceSqlite: Flag.file("source-sqlite", { mustExist: true }).pipe(
      Flag.withDescription(
        "Operator D1 dump. Use a sqlite file from wrangler d1 export, or the exported .sql.",
      ),
    ),
    destUrl: Flag.optional(Flag.string("dest-url")).pipe(
      Flag.withDescription(
        "PlanetScale or Hyperdrive postgres URL. Defaults to DATABASE_URL or the local PGLite URL.",
      ),
    ),
    config: Flag.optional(Flag.file("config")).pipe(
      Flag.withDescription("Operator s0 jsonc to diff. Defaults to config/prod.config.jsonc."),
    ),
    envFile: Flag.optional(Flag.file("env-file")).pipe(
      Flag.withDescription("Operator env file to diff. Defaults to config/.env."),
    ),
    patchOut: Flag.optional(Flag.string("patch-out")).pipe(
      Flag.withDescription(
        "Optional sidecar directory for the printed jsonc and env diffs. Never rewrites the live jsonc on dry-run.",
      ),
    ),
  },
  (flags) =>
    Effect.gen(function* () {
      yield* Console.log(COPY_D1_TO_PLANETSCALE_BANNER)
      yield* Console.log("")
      const cwd = process.cwd()
      const jsoncPath = Option.getOrElse(flags.config, () =>
        resolve(cwd, "config/prod.config.jsonc"),
      )
      const envPath = Option.getOrElse(flags.envFile, () => resolve(cwd, "config/.env"))
      const destUrl = Option.getOrElse(
        flags.destUrl,
        () => process.env.DATABASE_URL ?? LOCAL_PGLITE_DATABASE_URL,
      )
      const jsonc = existsSync(jsoncPath) ? readFileSync(jsoncPath, "utf8") : "{\n}\n"
      const envFile = existsSync(envPath) ? readFileSync(envPath, "utf8") : ""
      const edits = planPlanetscaleCutoverEdits({
        jsonc,
        envFile,
        jsoncPath,
        envPath,
      })
      yield* Console.log(
        "Cutover edits after a successful copy. Apply these yourself, then deploy.",
      )
      yield* Console.log(
        `Engine remains process env ${DATABASE_ENV} (d1 | planetscale; missing/empty = d1).`,
      )
      yield* Console.log(
        `Remote PlanetScale tokens: ${PLANETSCALE_SERVICE_TOKEN_ID_ENV}, ${PLANETSCALE_SERVICE_TOKEN_ENV}, ${PLANETSCALE_ORGANIZATION_ENV}.`,
      )
      yield* Console.log("")
      yield* Console.log(edits.jsoncDiff)
      yield* Console.log(edits.envDiff)
      Option.match(flags.patchOut, {
        onNone: () => undefined,
        onSome: (directory) => {
          writeFileSync(resolve(directory, "s0-planetscale-cutover.jsonc.diff"), edits.jsoncDiff)
          writeFileSync(resolve(directory, "s0-planetscale-cutover.env.diff"), edits.envDiff)
        },
      })
      if (!flags.apply) {
        yield* Console.log("Dry-run: planning the copy. Destination writes are disabled.")
      }
      const source = openSourceSqlite(flags.sourceSqlite)
      const client = postgres(destUrl, {
        max: 1,
        prepare: false,
        fetch_types: false,
        connect_timeout: 20,
      })
      const destDrizzle = drizzle({ client, relations: pgRelations })
      const dest = makeDrizzleCopyDestination(destDrizzle, {
        sizeBytes: async () => {
          const rows = await client.unsafe("SELECT pg_database_size(current_database()) AS bytes")
          const parsed = Number((rows[0] as { bytes?: unknown } | undefined)?.bytes)
          return Number.isFinite(parsed) ? parsed : null
        },
      })
      const report = yield* copyControlPlane({
        source,
        dest,
        apply: flags.apply,
        overwrite: flags.overwrite,
      }).pipe(
        Effect.tapError((error) =>
          Console.log(error instanceof CopyConflictError ? error.message : String(error)),
        ),
      )
      yield* Console.log(formatCopyReport(report))
      yield* Effect.tryPromise({
        try: () => client.end({ timeout: 1 }),
        catch: (cause) => new Error(`Failed to close postgres client: ${String(cause)}`),
      })
      source.close()
      if (report.status === "failed") {
        return yield* Effect.fail(new CopyConflictError(report.error ?? "copy failed"))
      }
    }),
).pipe(
  Command.withDescription(
    [
      COPY_D1_TO_PLANETSCALE_BANNER,
      "",
      "Copy control-plane rows from an operator D1 sqlite dump into PlanetScale Postgres.",
      "Default is --dry-run behavior: omit --apply to plan the copy and print the jsonc/env diff.",
      "This CLI does not bind D1 and PlanetScale on the Worker together and does not deploy.",
    ].join("\n"),
  ),
  Command.withExamples([
    {
      command:
        "nub run db:copy-d1-to-planetscale -- --source-sqlite ./d1-export.sql --dest-url $DATABASE_URL",
      description: "Dry-run the copy and print the jsonc and env edits for the next deploy.",
    },
    {
      command:
        "nub run db:copy-d1-to-planetscale -- --apply --source-sqlite ./d1-export.sql --dest-url $DATABASE_URL",
      description:
        "Write the copy. Deploy yourself after it succeeds. Production stays on D1 until then.",
    },
  ]),
)
