import { getTableColumns } from "drizzle-orm"
import type { Table } from "drizzle-orm"

const JSONB_COLUMN_TYPES = new Set(["PgJsonb", "PgJson"])
const BOOLEAN_COLUMN_TYPES = new Set(["PgBoolean"])
const BIGINT_NUMBER_COLUMN_TYPES = new Set(["PgBigInt53", "PgBigInt64"])

function columnTypeName(column: { columnType: string }): string {
  return column.columnType
}

function sqliteIntegerAsBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true"
}

function asJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value
  return JSON.parse(value)
}

function asUnixMsNumber(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return value
}

export function mapSqliteCellToPostgres(value: unknown, destColumnType: string): unknown {
  if (BOOLEAN_COLUMN_TYPES.has(destColumnType)) return sqliteIntegerAsBoolean(value)
  if (JSONB_COLUMN_TYPES.has(destColumnType)) return asJsonValue(value)
  if (BIGINT_NUMBER_COLUMN_TYPES.has(destColumnType)) return asUnixMsNumber(value)
  return value
}

export function mapSqliteRowToPostgres(
  row: Record<string, unknown>,
  destTable: Table,
): Record<string, unknown> {
  const columns = getTableColumns(destTable)
  const mapped: Record<string, unknown> = {}
  for (const [key, column] of Object.entries(columns)) {
    if (!Object.hasOwn(row, key)) continue
    mapped[key] = mapSqliteCellToPostgres(row[key], columnTypeName(column))
  }
  return mapped
}

export function normalizePostgresRow(
  row: Record<string, unknown>,
  destTable: Table,
): Record<string, unknown> {
  return mapSqliteRowToPostgres(row, destTable)
}

export function primaryKeyToken(
  row: Record<string, unknown>,
  primaryKeys: readonly string[],
): string {
  return primaryKeys.map((key) => JSON.stringify(row[key] ?? null)).join("\0")
}

export function rowsEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(sortRecord(left)) === JSON.stringify(sortRecord(right))
}

function sortRecord(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).sort(([left], [right]) => left.localeCompare(right)),
  )
}
