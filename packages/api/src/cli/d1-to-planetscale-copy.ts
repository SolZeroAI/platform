import { createHash } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import { and, eq, getTableColumns, or, sql } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import type { drizzle } from "drizzle-orm/postgres-js"
import * as Effect from "effect/Effect"
import { agentSkills } from "../server/effect/db/schema.pg"
import {
  CONTROL_PLANE_COPY_TABLES,
  type ControlPlaneCopyTable,
} from "./d1-to-planetscale-copy-tables"
import {
  canonicalCopyRow,
  mapSqliteRowToPostgres,
  normalizePostgresRow,
  primaryKeyToken,
  rowsEqual,
} from "./d1-to-planetscale-copy-map"

type CopyRow = Record<string, unknown>

type CopyDrizzleDatabase = Pick<
  ReturnType<typeof drizzle>,
  "select" | "insert" | "delete" | "transaction"
>

export interface CopyTableMetrics {
  readonly table: string
  readonly sourceRows: number
  readonly destRowsBefore: number
  readonly destRowsAfter: number
  readonly inserted: number
  readonly skipped: number
  readonly conflicts: number
  readonly overwritten: number
  readonly verified: boolean
  readonly sourceChecksum: string | null
  readonly destChecksum: string | null
}

export interface CopyReport {
  readonly status: "planned" | "success" | "verified"
  readonly apply: boolean
  readonly overwrite: boolean
  readonly durationMs: number
  readonly sourceBytes: number | null
  readonly destBytes: number | null
  readonly tables: readonly CopyTableMetrics[]
  readonly missingSourceTables: readonly string[]
  readonly reconciledBuiltinSeed: boolean
  readonly inserted: number
  readonly skipped: number
  readonly conflicts: number
  readonly overwritten: number
}

export interface CopyDestination {
  readonly countRows: (table: PgTable) => Promise<number>
  readonly findRows: (spec: ControlPlaneCopyTable, keys: readonly CopyRow[]) => Promise<CopyRow[]>
  readonly insertRows: (table: PgTable, rows: readonly CopyRow[]) => Promise<void>
  readonly upsertRows: (spec: ControlPlaneCopyTable, rows: readonly CopyRow[]) => Promise<void>
  readonly deleteBuiltinSeed: () => Promise<void>
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

export function sqliteSourceBytes(client: DatabaseSync): number | null {
  const row = client
    .prepare("SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()")
    .get()

  return typeof row?.bytes === "number" ? row.bytes : null
}

export function sqliteTableNames(client: DatabaseSync): Set<string> {
  return new Set(
    client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name)),
  )
}

export function makeDrizzleCopyDestination(
  db: CopyDrizzleDatabase,
  options?: { sizeBytes?: () => Promise<number | null> },
): CopyDestination {
  const database = db

  return {
    countRows: async (table) =>
      Number((await database.select({ count: sql`count(*)` }).from(table))[0]?.count),
    findRows: async (spec, keys) => {
      if (!keys.length) return []
      const columns = getTableColumns(spec.postgres)

      return database
        .select()
        .from(spec.postgres)
        .where(
          or(
            ...keys.map((row) => and(...spec.primaryKeys.map((key) => eq(columns[key], row[key])))),
          ),
        )
    },
    insertRows: async (table, rows) => {
      if (rows.length) await database.insert(table).values([...rows])
    },
    upsertRows: async (spec, rows) => {
      const columns = getTableColumns(spec.postgres)

      for (const row of rows) {
        await database
          .insert(spec.postgres)
          .values(row)
          .onConflictDoUpdate({
            target: spec.primaryKeys.map((key) => columns[key]),
            set: Object.fromEntries(
              Object.entries(row).filter(([key]) => !spec.primaryKeys.includes(key)),
            ),
          })
      }
    },
    deleteBuiltinSeed: async () => {
      await database.delete(agentSkills).where(eq(agentSkills.id, "skill_s0_create_pr"))
    },
    sizeBytes: async () => options?.sizeBytes?.() ?? null,
    withTransaction: (fn) =>
      database.transaction((tx) => fn(makeDrizzleCopyDestination(tx, options)), {
        isolationLevel: "serializable",
      }),
  }
}

function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

interface SourceTables {
  readonly tables: SourceTable[]
  readonly missing: string[]
}

interface SourceTable {
  readonly spec: ControlPlaneCopyTable
  readonly fields: readonly string[]
  readonly count: number
  readonly page: (offset: number, limit: number) => CopyRow[]
}

function sourceTables(source: DatabaseSync): SourceTables {
  const names = sqliteTableNames(source)
  const known = new Set(CONTROL_PLANE_COPY_TABLES.map((spec) => spec.name))

  const unknown = [...names].filter(
    (name) =>
      !known.has(name) &&
      !name.startsWith("sqlite_") &&
      !name.startsWith("_cf_") &&
      !["d1_migrations", "__drizzle_migrations", "__alchemy_migrations"].includes(name),
  )

  if (unknown.length)
    throw new CopyConflictError(
      `Unmapped source tables: ${unknown.sort().join(", ")}. No source table may be silently omitted.`,
    )
  const tables: SourceTable[] = []
  const missing: string[] = []

  for (const spec of CONTROL_PLANE_COPY_TABLES) {
    if (!names.has(spec.name)) {
      missing.push(spec.name)
      continue
    }

    const sqliteColumns = getTableColumns(spec.sqlite)
    const postgresColumns = getTableColumns(spec.postgres)

    const present = new Set(
      source
        .prepare(`PRAGMA table_info(${quote(spec.name)})`)
        .all()
        .map((row) => String(row.name)),
    )

    const mapped = Object.entries(sqliteColumns).filter(
      ([key, column]) => present.has(column.name) && Object.hasOwn(postgresColumns, key),
    )

    const unmapped = [...present].filter(
      (name) => !mapped.some(([, column]) => column.name === name),
    )

    if (
      unmapped.length ||
      spec.primaryKeys.some((key) => !mapped.some(([field]) => field === key))
    ) {
      throw new CopyConflictError(
        `Unmapped columns or missing primary key in source table ${spec.name}. Update the migration mapping before copying.`,
      )
    }

    const selection = mapped
      .map(([key, column]) => `${quote(column.name)} AS ${quote(key)}`)
      .join(", ")

    const order = spec.primaryKeys.map((key) => quote(sqliteColumns[key].name)).join(", ")

    const statement = source.prepare(
      `SELECT ${selection} FROM ${quote(spec.name)} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )

    const count = Number(
      source.prepare(`SELECT count(*) AS count FROM ${quote(spec.name)}`).get()?.count,
    )

    tables.push({
      spec,
      fields: mapped.map(([key]) => key),
      count,
      page: (offset, limit) =>
        statement.all(limit, offset).map((row) => mapSqliteRowToPostgres(row, spec.postgres)),
    })
  }

  if (!tables.length)
    throw new CopyConflictError("The source contains no mapped control-plane tables.")

  return { tables, missing }
}

const originalBuiltinSeed = {
  id: "skill_s0_create_pr",
  scope: "global",
  ownerUserId: null,
  slug: "s0-create-pr",
  name: "s0-create-pr",
  description:
    "Create a GitHub pull request from a SolZero-managed repository. Use when the user asks to open, create, or submit a pull request for the current repository.",
  runtimeScope: "harness",
  origin: "built-in",
  sourceId: null,
  sourceHash: null,
  contentHash: "builtin:s0-create-pr:v1",
  defaultEnabled: 1,
  createdByUserId: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
} satisfies CopyRow

async function needsSeedReconciliation(
  source: DatabaseSync,
  tables: readonly SourceTable[],
  dest: CopyDestination,
): Promise<boolean> {
  const skills = tables.find((table) => table.spec.name === "agent_skills")

  if (!skills) return false

  const legacy = source
    .prepare("SELECT id FROM agent_skills WHERE id IN ('skill_c0_create_pr', 'skill_s0_create_pr')")
    .all()

  if (legacy.length > 1)
    throw new CopyConflictError(
      "Source contains duplicate legacy and canonical PR built-ins. Reconcile explicitly before copying.",
    )

  if (legacy[0]?.id !== "skill_c0_create_pr") return false
  const [seed] = await dest.findRows(skills.spec, [originalBuiltinSeed])

  if (!seed) return false

  if (!rowsEqual(normalizePostgresRow(seed, skills.spec.postgres), originalBuiltinSeed))
    throw new CopyConflictError(
      "Destination PR built-in is not the untouched migration seed. Refusing to delete it.",
    )

  const preferences = CONTROL_PLANE_COPY_TABLES.find(
    (spec) => spec.name === "user_agent_skill_preferences",
  )!

  if (await dest.countRows(preferences.postgres))
    throw new CopyConflictError(
      "Destination has skill preferences. Use a fresh destination before reconciling the built-in seed.",
    )

  return true
}

async function verifyTable(source: SourceTable, dest: CopyDestination, batchSize: number) {
  const sourceHash = createHash("sha256")
  const destHash = createHash("sha256")
  const count = await dest.countRows(source.spec.postgres)

  if (count !== source.count)
    throw new CopyConflictError(
      `Verification failed for ${source.spec.name}: destination count differs from source.`,
    )

  for (let offset = 0; offset < source.count; offset += batchSize) {
    const rows = source.page(offset, batchSize)
    const destination = await dest.findRows(source.spec, rows)

    const byKey = new Map(
      destination.map((row) => [
        primaryKeyToken(row, source.spec.primaryKeys),
        normalizePostgresRow(row, source.spec.postgres),
      ]),
    )

    for (const row of rows) {
      const found = byKey.get(primaryKeyToken(row, source.spec.primaryKeys))

      if (!found)
        throw new CopyConflictError(
          `Verification failed for ${source.spec.name}: missing primary key.`,
        )
      const projected = Object.fromEntries(source.fields.map((field) => [field, found[field]]))
      sourceHash.update(canonicalCopyRow(row) + "\n")
      destHash.update(canonicalCopyRow(projected) + "\n")
    }
  }

  const sourceChecksum = sourceHash.digest("hex")
  const destChecksum = destHash.digest("hex")

  if (sourceChecksum !== destChecksum)
    throw new CopyConflictError(
      `Verification failed for ${source.spec.name}: row checksums differ.`,
    )

  return { count, sourceChecksum, destChecksum }
}

interface CopyInput {
  source: DatabaseSync
  dest: CopyDestination
  apply: boolean
  overwrite: boolean
  verifyOnly?: boolean
  batchSize?: number
}

async function runCopy(input: CopyInput): Promise<CopyReport> {
  const started = Date.now()
  const batchSize = input.batchSize ?? 100

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500)
    throw new CopyConflictError("Batch size must be an integer from 1 to 500.")

  if (input.apply && input.verifyOnly)
    throw new CopyConflictError("--apply and --verify-only are mutually exclusive.")
  const { tables: sources, missing } = sourceTables(input.source)

  for (const name of missing) {
    const spec = CONTROL_PLANE_COPY_TABLES.find((table) => table.name === name)!

    if (await input.dest.countRows(spec.postgres))
      throw new CopyConflictError(
        `Destination ${name} has rows but the source table is absent. Reconcile this dataset explicitly before copying.`,
      )
  }

  const reconcileSeed = await needsSeedReconciliation(input.source, sources, input.dest)
  const metrics: CopyTableMetrics[] = []

  const perform = async (dest: CopyDestination) => {
    if (input.apply && (await needsSeedReconciliation(input.source, sources, dest)))
      await dest.deleteBuiltinSeed()

    for (const source of sources) {
      const before = await dest.countRows(source.spec.postgres)

      let inserted = 0,
        skipped = 0,
        conflicts = 0

      for (let offset = 0; offset < source.count; offset += batchSize) {
        const rows = source.page(offset, batchSize)
        const destination = await dest.findRows(source.spec, rows)

        const byKey = new Map(
          destination.map((row) => [
            primaryKeyToken(row, source.spec.primaryKeys),
            normalizePostgresRow(row, source.spec.postgres),
          ]),
        )

        const additions: CopyRow[] = [],
          updates: CopyRow[] = []

        for (const row of rows) {
          const found = byKey.get(primaryKeyToken(row, source.spec.primaryKeys))

          if (!found) {
            additions.push(row)
            continue
          }

          const projected = Object.fromEntries(source.fields.map((field) => [field, found[field]]))

          if (rowsEqual(projected, row)) skipped++
          else updates.push(row)
        }

        inserted += additions.length
        conflicts += updates.length

        if (updates.length && !input.overwrite && !input.verifyOnly)
          throw new CopyConflictError(
            `Destination ${source.spec.name} has conflicting rows. Use a fresh destination or explicitly authorize --overwrite.`,
          )

        if (input.apply) {
          await dest.insertRows(source.spec.postgres, additions)

          if (updates.length) await dest.upsertRows(source.spec, updates)
        }
      }

      const allowedSeed =
        reconcileSeed && !input.apply && source.spec.name === "agent_skills" ? 1 : 0

      if (!input.verifyOnly && before - skipped - conflicts > allowedSeed)
        throw new CopyConflictError(
          `Destination ${source.spec.name} contains unrelated rows. Refusing to mix datasets.`,
        )
      metrics.push({
        table: source.spec.name,
        sourceRows: source.count,
        destRowsBefore: before,
        destRowsAfter: await dest.countRows(source.spec.postgres),
        inserted,
        skipped,
        conflicts,
        overwritten: input.apply ? conflicts : 0,
        verified: false,
        sourceChecksum: null,
        destChecksum: null,
      })
    }

    if (input.apply || input.verifyOnly)
      for (const source of sources) await verifyTable(source, dest, batchSize)
  }

  if (input.apply) await input.dest.withTransaction(perform)
  else await perform(input.dest)

  // Read again after commit; reports never infer destination counts or checksums from writes.
  if (input.apply || input.verifyOnly)
    for (let index = 0; index < sources.length; index++) {
      const proof = await verifyTable(sources[index], input.dest, batchSize)
      metrics[index] = {
        ...metrics[index],
        destRowsAfter: proof.count,
        verified: true,
        sourceChecksum: proof.sourceChecksum,
        destChecksum: proof.destChecksum,
      }
    }

  const sum = (field: "inserted" | "skipped" | "conflicts" | "overwritten") =>
    metrics.reduce((total, table) => total + table[field], 0)

  return {
    status: input.apply ? "success" : input.verifyOnly ? "verified" : "planned",
    apply: input.apply,
    overwrite: input.overwrite,
    durationMs: Date.now() - started,
    sourceBytes: sqliteSourceBytes(input.source),
    destBytes: await input.dest.sizeBytes(),
    tables: metrics,
    missingSourceTables: missing,
    reconciledBuiltinSeed: reconcileSeed && input.apply,
    inserted: sum("inserted"),
    skipped: sum("skipped"),
    conflicts: sum("conflicts"),
    overwritten: sum("overwritten"),
  }
}

export const copyControlPlane = Effect.fn("cli.copyControlPlane")((input: CopyInput) =>
  Effect.tryPromise({
    try: async () => {
      input.source.exec("BEGIN")

      try {
        return await runCopy(input)
      } finally {
        input.source.exec("ROLLBACK")
      }
    },
    // Driver messages can contain SQL parameters and decrypted credentials. Never put them in reports.
    catch: (cause) =>
      cause instanceof CopyConflictError
        ? cause
        : new CopyConflictError(
            "Copy failed while reading, mapping, or writing a table. Driver details are omitted to protect row data.",
          ),
  }),
)
