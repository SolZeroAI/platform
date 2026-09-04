import { getTableColumns, getTableName } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-sqlite"
import type { DatabaseSync } from "node:sqlite"
import * as Effect from "effect/Effect"
import type { Table } from "drizzle-orm"
import {
  CONTROL_PLANE_COPY_TABLES,
  type ControlPlaneCopyTable,
} from "./d1-to-planetscale-copy-tables"
import {
  mapSqliteRowToPostgres,
  normalizePostgresRow,
  primaryKeyToken,
  rowsEqual,
} from "./d1-to-planetscale-copy-map"

export interface CopyTableMetrics {
  readonly table: string
  readonly sourceRows: number
  readonly destRowsBefore: number
  readonly destRowsAfter: number
  readonly inserted: number
  readonly skipped: number
  readonly conflicts: number
  readonly overwritten: number
}

export interface CopyReport {
  readonly status: "planned" | "success" | "failed"
  readonly apply: boolean
  readonly overwrite: boolean
  readonly durationMs: number
  readonly sourceBytes: number | null
  readonly destBytes: number | null
  readonly tables: readonly CopyTableMetrics[]
  readonly inserted: number
  readonly skipped: number
  readonly conflicts: number
  readonly overwritten: number
  readonly error?: string
}

export interface CopyDestination {
  readonly selectAll: (table: Table) => Promise<Record<string, unknown>[]>
  readonly insertRows: (table: Table, rows: readonly Record<string, unknown>[]) => Promise<void>
  readonly upsertRows: (
    spec: ControlPlaneCopyTable,
    rows: readonly Record<string, unknown>[],
  ) => Promise<void>
  readonly sizeBytes: () => Promise<number | null>
  readonly withTransaction: <T>(fn: (dest: CopyDestination) => Promise<T>) => Promise<T>
}

export class CopyConflictError extends Error {
  readonly _tag = "CopyConflictError"
  constructor(message: string) {
    super(message)
    this.name = "CopyConflictError"
  }
}

export function openSqliteCopySource(client: DatabaseSync) {
  return drizzle({ client })
}

export function sqliteSourceBytes(client: DatabaseSync): number | null {
  const row = client
    .prepare("SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()")
    .get() as { bytes?: number } | undefined
  return typeof row?.bytes === "number" ? row.bytes : null
}

export function sqliteTableNames(client: DatabaseSync): Set<string> {
  const rows = client
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{
    name: string
  }>
  return new Set(rows.map((row) => row.name))
}

type CopyDrizzle = {
  select: () => { from: (table: never) => Promise<readonly Record<string, unknown>[]> }
  insert: (table: never) => {
    values: (rows: readonly Record<string, unknown>[]) => Promise<unknown>
  }
  transaction: <T>(fn: (tx: CopyDrizzle) => Promise<T>) => Promise<T>
}

interface PlannedCopyTable {
  readonly spec: ControlPlaneCopyTable
  readonly toInsert: readonly Record<string, unknown>[]
  readonly toOverwrite: readonly Record<string, unknown>[]
  readonly sourceRows: number
  readonly destRowsBefore: number
  readonly skipped: number
  readonly conflicts: number
}

export function makeDrizzleCopyDestination(
  db: object,
  options?: { sizeBytes?: () => Promise<number | null> },
): CopyDestination {
  const drizzleDb = db as CopyDrizzle
  return {
    selectAll: async (table) => {
      const result = await drizzleDb.select().from(table as never)
      return [...result]
    },
    insertRows: async (table, rows) => {
      if (rows.length === 0) return
      await drizzleDb.insert(table as never).values(rows)
    },
    upsertRows: async (spec, rows) => {
      for (const row of rows) {
        const columns = getTableColumns(spec.postgres)
        const targets = spec.primaryKeys.map((key) => columns[key])
        const insert = drizzleDb.insert(spec.postgres as never).values([row]) as {
          onConflictDoUpdate?: (config: {
            target: unknown
            set: Record<string, unknown>
          }) => Promise<unknown>
        }
        const set = Object.fromEntries(
          Object.entries(row).filter(([key]) => !spec.primaryKeys.includes(key)),
        )
        if (typeof insert.onConflictDoUpdate === "function") {
          await insert.onConflictDoUpdate({ target: targets, set })
          continue
        }
        await drizzleDb.insert(spec.postgres as never).values([row])
      }
    },
    sizeBytes: async () => options?.sizeBytes?.() ?? null,
    withTransaction: (fn) =>
      drizzleDb.transaction((tx) => fn(makeDrizzleCopyDestination(tx, options))),
  }
}

export const copyControlPlane = Effect.fn("cli.copyControlPlane")(function* (input: {
  source: DatabaseSync
  dest: CopyDestination
  apply: boolean
  overwrite: boolean
}) {
  const started = Date.now()
  const sourceNames = sqliteTableNames(input.source)
  const sourceDb = openSqliteCopySource(input.source)
  const planned: PlannedCopyTable[] = []
  const tables: CopyTableMetrics[] = []
  let inserted = 0
  let skipped = 0
  let conflicts = 0
  let overwritten = 0

  for (const spec of CONTROL_PLANE_COPY_TABLES) {
    const tableName = getTableName(spec.sqlite)
    const sourceRows = sourceNames.has(tableName)
      ? ((yield* Effect.tryPromise({
          try: () => sourceDb.select().from(spec.sqlite),
          catch: (cause) => new Error(`Failed to read sqlite table ${spec.name}: ${String(cause)}`),
        })) as Record<string, unknown>[])
      : []
    const destRows = yield* Effect.tryPromise({
      try: () => input.dest.selectAll(spec.postgres),
      catch: (cause) =>
        new Error(`Failed to read postgres table ${spec.name}: ${formatCause(cause)}`),
    })
    const destByPk = new Map(
      destRows.map((row) => {
        const normalized = normalizePostgresRow(row, spec.postgres)
        return [primaryKeyToken(normalized, spec.primaryKeys), normalized] as const
      }),
    )
    const toInsert: Record<string, unknown>[] = []
    const toOverwrite: Record<string, unknown>[] = []
    let tableSkipped = 0
    let tableConflicts = 0

    for (const raw of sourceRows) {
      const mapped = mapSqliteRowToPostgres(raw, spec.postgres)
      const token = primaryKeyToken(mapped, spec.primaryKeys)
      const existing = destByPk.get(token)
      if (!existing) {
        toInsert.push(mapped)
        continue
      }
      if (rowsEqual(existing, mapped)) {
        tableSkipped += 1
        continue
      }
      tableConflicts += 1
      toOverwrite.push(mapped)
    }

    if (tableConflicts > 0 && !input.overwrite) {
      const report = finishReport({
        status: "failed",
        apply: input.apply,
        overwrite: input.overwrite,
        started,
        sourceBytes: sqliteSourceBytes(input.source),
        destBytes: yield* Effect.tryPromise({
          try: () => input.dest.sizeBytes(),
          catch: () => null,
        }),
        tables,
        inserted,
        skipped,
        conflicts: conflicts + tableConflicts,
        overwritten,
        error: `Destination ${spec.name} already has ${tableConflicts} conflicting row(s). Re-run with --overwrite to upsert, or copy into an empty PlanetScale database.`,
      })
      return yield* Effect.fail(new CopyConflictError(report.error ?? "conflicting rows"))
    }

    planned.push({
      spec,
      toInsert,
      toOverwrite,
      sourceRows: sourceRows.length,
      destRowsBefore: destRows.length,
      skipped: tableSkipped,
      conflicts: tableConflicts,
    })
  }

  if (input.apply) {
    yield* Effect.tryPromise({
      try: () =>
        input.dest.withTransaction(async (tx) => {
          for (const plan of planned) {
            await tx.insertRows(plan.spec.postgres, plan.toInsert)
            if (input.overwrite && plan.toOverwrite.length > 0) {
              await tx.upsertRows(plan.spec, plan.toOverwrite)
            }
          }
        }),
      catch: (cause) => new Error(`Failed to apply copy transaction: ${formatCause(cause)}`),
    })
  }

  for (const plan of planned) {
    const destAfter = input.apply ? plan.destRowsBefore + plan.toInsert.length : plan.destRowsBefore
    const tableOverwritten = input.apply && input.overwrite ? plan.toOverwrite.length : 0
    tables.push({
      table: plan.spec.name,
      sourceRows: plan.sourceRows,
      destRowsBefore: plan.destRowsBefore,
      destRowsAfter: destAfter,
      inserted: plan.toInsert.length,
      skipped: plan.skipped,
      conflicts: plan.conflicts,
      overwritten: tableOverwritten,
    })
    inserted += plan.toInsert.length
    skipped += plan.skipped
    conflicts += plan.conflicts
    overwritten += tableOverwritten
  }

  const destBytes = yield* Effect.tryPromise({
    try: () => input.dest.sizeBytes(),
    catch: () => null,
  })

  return finishReport({
    status: input.apply ? "success" : "planned",
    apply: input.apply,
    overwrite: input.overwrite,
    started,
    sourceBytes: sqliteSourceBytes(input.source),
    destBytes,
    tables,
    inserted,
    skipped,
    conflicts,
    overwritten,
  })
})

function formatCause(cause: unknown): string {
  if (cause instanceof Error) {
    const nested =
      "cause" in cause && cause.cause !== undefined ? ` cause=${formatCause(cause.cause)}` : ""
    return `${cause.message}${nested}`
  }
  return String(cause)
}

function finishReport(input: {
  status: CopyReport["status"]
  apply: boolean
  overwrite: boolean
  started: number
  sourceBytes: number | null
  destBytes: number | null
  tables: readonly CopyTableMetrics[]
  inserted: number
  skipped: number
  conflicts: number
  overwritten: number
  error?: string
}): CopyReport {
  return {
    status: input.status,
    apply: input.apply,
    overwrite: input.overwrite,
    durationMs: Date.now() - input.started,
    sourceBytes: input.sourceBytes,
    destBytes: input.destBytes,
    tables: input.tables,
    inserted: input.inserted,
    skipped: input.skipped,
    conflicts: input.conflicts,
    overwritten: input.overwritten,
    error: input.error,
  }
}
