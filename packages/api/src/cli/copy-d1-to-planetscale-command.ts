import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { Command, Flag } from "effect/cli"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import {
  DATABASE_ENV,
  PLANETSCALE_ORGANIZATION_ENV,
  PLANETSCALE_SERVICE_TOKEN_ENV,
  PLANETSCALE_SERVICE_TOKEN_ID_ENV,
  s0ConfigPathForStage,
} from "@solzero/shared"
import { pgRelations } from "../server/effect/db/control-plane-db"
import {
  CopyConflictError,
  copyControlPlane,
  drizzleCopyDestination,
  type CopyReport,
} from "./d1-to-planetscale-copy"
import { planPlanetscaleCutoverEdits } from "./d1-to-planetscale-cutover-diff"

export const COPY_D1_TO_PLANETSCALE_BANNER = [
  "This is a one-shot convenience copy, not an online or zero-downtime migration.",
  "Freeze source writes and drain running work before the final export; keep writes frozen through cutover.",
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

    try {
      sqlite.exec(readFileSync(resolved, "utf8"))
    } catch {
      sqlite.close()
      throw new Error("Invalid source SQL dump")
    }

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

  lines.push(`missingSourceTables=${report.missingSourceTables.join(",")}`)
  lines.push(`reconciledBuiltinSeed=${report.reconciledBuiltinSeed}`)
  lines.push("tables:")

  for (const table of report.tables) {
    lines.push(
      `  ${table.table} source=${table.sourceRows} destBefore=${table.destRowsBefore} destAfter=${table.destRowsAfter} inserted=${table.inserted} skipped=${table.skipped} conflicts=${table.conflicts} overwritten=${table.overwritten} verified=${table.verified} sourceChecksum=${table.sourceChecksum ?? "unverified"} destChecksum=${table.destChecksum ?? "unverified"}`,
    )
  }

  return lines.join("\n")
}

export const copyD1ToPlanetscaleCommand = Command.make(
  COPY_D1_TO_PLANETSCALE_NAME,
  {
    apply: Flag.Boolean("apply").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Write rows to PlanetScale. Default is dry-run and writes nothing."),
    ),
    overwrite: Flag.Boolean("overwrite").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Upsert destination rows that already exist with different values. Default fails closed.",
      ),
    ),
    verifyOnly: Flag.Boolean("verify-only").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Independently verify all source keys, counts and checksums without writing.",
      ),
    ),
    sourceWritesFrozen: Flag.Boolean("source-writes-frozen").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Acknowledge that source writes are frozen and the destination is offline. Required for --apply.",
      ),
    ),
    batchSize: Flag.Int("batch-size").pipe(
      Flag.withDefault(100),
      Flag.withDescription("Rows per read/write batch (1-500)."),
    ),
    sourceSqlite: Flag.File("source-sqlite", { mustExist: true }).pipe(
      Flag.withDescription(
        "Operator D1 dump. Use a sqlite file from wrangler d1 export, or the exported .sql.",
      ),
    ),
    destUrl: Flag.optional(Flag.String("dest-url")).pipe(
      Flag.withDescription(
        "PlanetScale postgres URL. Prefer the DATABASE_URL environment variable to avoid command-line credential exposure.",
      ),
    ),
    config: Flag.optional(Flag.File("config")).pipe(
      Flag.withDescription(
        "Operator stage JSONC to diff. Defaults to the prod file selected by S0_CONFIG_PROFILE.",
      ),
    ),
    envFile: Flag.optional(Flag.File("env-file")).pipe(
      Flag.withDescription("Operator env file to diff. Defaults to config/.env."),
    ),
    patchOut: Flag.optional(Flag.String("patch-out")).pipe(
      Flag.withDescription(
        "Optional sidecar directory for the printed jsonc and env diffs. Never rewrites the live jsonc on dry-run.",
      ),
    ),
  },
  (flags) =>
    Effect.gen(function* () {
      yield* Console.log(COPY_D1_TO_PLANETSCALE_BANNER)

      if (flags.apply && !flags.sourceWritesFrozen)
        return yield* Effect.fail(
          new CopyConflictError(
            "--apply requires --source-writes-frozen. Freeze writes and drain runs before the final export.",
          ),
        )

      if (flags.apply && flags.verifyOnly)
        return yield* Effect.fail(
          new CopyConflictError("--apply and --verify-only are mutually exclusive."),
        )
      yield* Console.log("")
      const cwd = process.cwd()

      const jsoncPath = Option.getOrElse(flags.config, () =>
        resolve(cwd, s0ConfigPathForStage("prod", process.env.S0_CONFIG_PROFILE)),
      )

      const envPath = Option.getOrElse(flags.envFile, () => resolve(cwd, "config/.env"))
      const destUrl = Option.getOrElse(flags.destUrl, () => process.env.DATABASE_URL ?? "")

      if (!destUrl)
        return yield* Effect.fail(
          new CopyConflictError(
            "Supply DATABASE_URL or --dest-url; no implicit destination is selected.",
          ),
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
          writeFileSync(resolve(directory, "s0-planetscale-cutover.jsonc.diff"), edits.jsoncDiff, {
            flag: "wx",
            mode: 0o600,
          })
          writeFileSync(resolve(directory, "s0-planetscale-cutover.env.diff"), edits.envDiff, {
            flag: "wx",
            mode: 0o600,
          })
        },
      })

      if (!flags.apply) {
        yield* Console.log("Dry-run: planning the copy. Destination writes are disabled.")
      }

      const { source, client } = yield* Effect.try({
        try: () => {
          const source = openSourceSqlite(flags.sourceSqlite)

          try {
            return {
              source,
              client: postgres(destUrl, {
                max: 1,
                prepare: false,
                fetch_types: false,
                connect_timeout: 20,
              }),
            }
          } catch {
            source.close()
            throw new Error("Destination client setup failed")
          }
        },
        catch: () =>
          new CopyConflictError(
            "Could not open the source dump or destination client. File and connection details are suppressed.",
          ),
      })

      const destDrizzle = drizzle({ client, relations: pgRelations })

      const dest = drizzleCopyDestination(destDrizzle, {
        sizeBytes: async () => {
          const rows = await client.unsafe("SELECT pg_database_size(current_database()) AS bytes")
          // SAFETY: pg_database_size returns one row whose bytes column is the numeric database size.
          const parsed = Number((rows[0] as { bytes?: unknown } | undefined)?.bytes)

          return Number.isFinite(parsed) ? parsed : null
        },
      })

      const report = yield* copyControlPlane({
        source,
        dest,
        apply: flags.apply,
        overwrite: flags.overwrite,
        verifyOnly: flags.verifyOnly,
        batchSize: flags.batchSize,
      }).pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            try {
              await client.end({ timeout: 1 })
            } finally {
              source.close()
            }
          }),
        ),
      )

      yield* Console.log(formatCopyReport(report))
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
        "nub run db:copy-d1-to-planetscale -- --apply --source-writes-frozen --source-sqlite ./d1-export.sql",
      description:
        "Write the copy. Deploy yourself after it succeeds. Production stays on D1 until then.",
    },
  ]),
)
