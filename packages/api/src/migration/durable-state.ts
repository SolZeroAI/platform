import { encodePortableValue, decodePortableValue } from "./portable-value"
import * as Schema from "effect/Schema"
import { durableMigrationRequestSchema } from "./protocol"

const MARKER = "__s0_migration_transfer"
const PAGE_LIMIT = 100
const BYTE_LIMIT = 8 * 1024 * 1024

export interface DurableMigrationTable {
  name: string
  columns: string[]
  rowid: boolean
  rows: number
}

export interface DurableMigrationInventory {
  version: 1
  tables: DurableMigrationTable[]
}

interface Transfer {
  id: string
  tables: Array<DurableMigrationTable & { offset: number }>
  kvAfter: string
  kvComplete: boolean
  complete: boolean
}

function identifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

function inventory(sql: SqlStorage): DurableMigrationInventory {
  const tables = sql
    .exec<{ name: string; type: string; schema: string; wr: number }>("PRAGMA table_list")
    .toArray()
    .filter(
      (table) =>
        table.schema === "main" &&
        ["table", "virtual"].includes(table.type) &&
        !table.name.startsWith("sqlite_") &&
        !table.name.startsWith("_cf_"),
    )

  const ordered: typeof tables = []

  const visiting = new Set<string>(),
    visited = new Set<string>()

  function visit(table: (typeof tables)[number]) {
    if (visited.has(table.name)) return

    if (visiting.has(table.name))
      throw new Error("Cyclic Durable Object foreign keys require an explicit import mapping")
    visiting.add(table.name)

    for (const dependency of sql
      .exec<{ table: string }>(`PRAGMA foreign_key_list(${identifier(table.name)})`)
      .toArray()) {
      const parent = tables.find((candidate) => candidate.name === dependency.table)

      if (parent && parent.name !== table.name) visit(parent)
    }

    visiting.delete(table.name)
    visited.add(table.name)
    ordered.push(table)
  }

  for (const table of tables.sort((a, b) => a.name.localeCompare(b.name))) visit(table)

  return {
    version: 1,
    tables: ordered.map((table) => ({
      name: table.name,
      rowid: !table.wr,
      columns: sql
        .exec<{ name: string; hidden: number }>(`PRAGMA table_xinfo(${identifier(table.name)})`)
        .toArray()
        .filter((column) => column.hidden === 0)
        .map((column) => column.name),
      rows: sql
        .exec<{ count: number }>(`SELECT count(*) AS count FROM ${identifier(table.name)}`)
        .one().count,
    })),
  }
}

function bounded<T>(value: T): T {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > BYTE_LIMIT)
    throw new Error("Migration page exceeds the bounded payload limit")

  return value
}

/** Privileged Worker-to-DO RPC only. Do not mark the host method @callable or route it through the application HTTP API. */
export async function durableMigration(
  ctx: DurableObjectState,
  input: unknown,
  options: { empty: boolean; quiescent: boolean },
): Promise<unknown> {
  const request = Schema.decodeUnknownSync(durableMigrationRequestSchema, {
    onExcessProperty: "error",
  })(input)

  if (!options.quiescent || ctx.getWebSockets().length)
    throw new Error("Drain the object and disconnect clients before migration")
  const sql = ctx.storage.sql
  const current = inventory(sql)

  if (request.operation === "inventory") return current

  if (request.operation === "read") {
    const table = current.tables.find((table) => table.name === request.table)

    if (!table || !Number.isSafeInteger(request.offset) || request.offset < 0)
      throw new Error("Invalid migration table or offset")
    const fields = [...(table.rowid ? ["rowid"] : []), ...table.columns.map(identifier)].join(",")

    const rows = Array.from(
      sql
        .exec(
          `SELECT ${fields} FROM ${identifier(table.name)} ORDER BY ${table.rowid ? "rowid" : table.columns.map(identifier).join(",")} LIMIT ? OFFSET ?`,
          PAGE_LIMIT,
          request.offset,
        )
        .raw(),
      (row) => row.map(encodePortableValue),
    )

    return bounded({ rows, complete: request.offset + rows.length >= table.rows })
  }

  if (request.operation === "read-kv") {
    const entries = [
      ...(await ctx.storage.list({ startAfter: request.after, limit: PAGE_LIMIT + 1 })),
    ]
      .filter(([key]) => key !== MARKER)
      .slice(0, PAGE_LIMIT)
      .map(([key, value]) => ({ key, value: encodePortableValue(value) }))

    // The transfer marker is excluded; look ahead instead of inferring EOF from the filtered page size.
    const after = entries.at(-1)?.key ?? request.after

    const remaining = [...(await ctx.storage.list({ startAfter: after, limit: 2 }))].filter(
      ([key]) => key !== MARKER,
    )

    return bounded({ entries, complete: remaining.length === 0 })
  }

  if (request.operation === "begin") {
    if (!options.empty || !/^[0-9a-f-]{36}$/.test(request.id) || request.inventory.version !== 1)
      throw new Error("Import requires a fresh, empty object and a transfer UUID")

    if (ctx.storage.kv.get(MARKER))
      throw new Error("An import already exists; resume its pages or use a fresh target")

    if (
      request.inventory.tables.length !== current.tables.length ||
      new Set(request.inventory.tables.map((table) => table.name)).size !== current.tables.length
    )
      throw new Error(
        "Durable Object table sets differ; import requires an explicit compatibility migration",
      )

    for (const table of request.inventory.tables) {
      const target = current.tables.find((candidate) => candidate.name === table.name)

      if (
        !target ||
        target.rowid !== table.rowid ||
        JSON.stringify(target.columns) !== JSON.stringify(table.columns) ||
        !Number.isSafeInteger(table.rows) ||
        table.rows < 0
      )
        throw new Error(
          "Durable Object schema differs; provide an explicit compatibility migration before import",
        )
    }

    for (;;) {
      const keys = [...(await ctx.storage.list({ limit: PAGE_LIMIT }))].map(([key]) => key)

      if (!keys.length) break
      await ctx.storage.delete(keys)
    }

    const transfer: Transfer = {
      id: request.id,
      tables: request.inventory.tables.map((table) => ({
        ...table,
        columns: [...table.columns],
        offset: 0,
      })),
      kvAfter: "",
      kvComplete: false,
      complete: false,
    }

    ctx.storage.transactionSync(() => {
      sql.exec("PRAGMA defer_foreign_keys = ON")

      for (const table of [...current.tables].reverse())
        sql.exec(`DELETE FROM ${identifier(table.name)}`)
      ctx.storage.kv.put(MARKER, transfer)
    })
    await ctx.storage.deleteAlarm()

    return { ready: true }
  }

  const transfer = ctx.storage.kv.get<Transfer>(MARKER)

  if (request.operation === "progress") return transfer ?? null

  if (!transfer) throw new Error("Begin an import before writing state")

  if (request.operation === "reload") {
    if (!transfer.complete) throw new Error("Finish and verify the import before reloading")
    ctx.abort("Reloading imported state; reconnect and verify before cutover")
  }

  if (transfer.complete) throw new Error("This import is complete and cannot accept more writes")

  if (request.operation === "write") {
    const table = transfer.tables.find((table) => table.name === request.table)

    if (
      !table ||
      request.offset !== table.offset ||
      !Array.isArray(request.rows) ||
      !request.rows.length ||
      request.rows.length > PAGE_LIMIT ||
      table.offset + request.rows.length > table.rows
    )
      throw new Error("Invalid or out-of-order migration page")
    bounded(request)
    const fields = [...(table.rowid ? ["rowid"] : []), ...table.columns.map(identifier)]
    ctx.storage.transactionSync(() => {
      for (const row of request.rows) {
        if (row.length !== fields.length) throw new Error("Invalid migration row shape")

        const values = row.map((value) => {
          const decoded = decodePortableValue(value)

          if (
            decoded === null ||
            typeof decoded === "string" ||
            (typeof decoded === "number" && Number.isFinite(decoded)) ||
            decoded instanceof ArrayBuffer
          )
            return decoded
          throw new Error("Invalid SQLite migration cell")
        })

        sql.exec(
          `INSERT INTO ${identifier(table.name)} (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`,
          ...values,
        )
      }

      table.offset += request.rows.length
      ctx.storage.kv.put(MARKER, transfer)
    })

    return { written: request.rows.length }
  }

  if (request.operation === "write-kv") {
    if (
      request.after !== transfer.kvAfter ||
      !Array.isArray(request.entries) ||
      request.entries.length > PAGE_LIMIT ||
      transfer.kvComplete
    )
      throw new Error("Invalid or out-of-order KV migration page")
    bounded(request)
    ctx.storage.transactionSync(() => {
      for (const entry of request.entries) {
        if (entry.key === MARKER || ctx.storage.kv.get(entry.key) !== undefined)
          throw new Error("Duplicate or reserved migration key")
        ctx.storage.kv.put(entry.key, decodePortableValue(entry.value))
      }

      transfer.kvAfter = request.entries.at(-1)?.key ?? transfer.kvAfter
      transfer.kvComplete = request.complete
      ctx.storage.kv.put(MARKER, transfer)
    })

    return { written: request.entries.length }
  }

  if (request.operation === "finish") {
    if (
      !transfer.kvComplete ||
      transfer.tables.some(
        (table) =>
          table.rows !== table.offset ||
          current.tables.find((found) => found.name === table.name)?.rows !== table.rows,
      )
    )
      throw new Error("Import is incomplete; refusing to finish")
    transfer.complete = true
    ctx.storage.kv.put(MARKER, transfer)
    await ctx.storage.deleteAlarm()

    return { complete: true, reloadRequired: true }
  }

  throw new Error("Unknown migration operation")
}
