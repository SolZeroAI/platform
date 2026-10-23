import { createHash, randomUUID } from "node:crypto"
import { createReadStream, createWriteStream, constants } from "node:fs"
import { copyFile, lstat, mkdir, open, readFile, unlink } from "node:fs/promises"
import { resolve } from "node:path"
import { createInterface } from "node:readline"
import { pipeline } from "node:stream/promises"
import { Transform } from "node:stream"
import { openAsBlob } from "node:fs"
import * as Schema from "effect/Schema"
import { durableMigrationInventorySchema, storageMetadataSchema } from "../migration/protocol"
import { decodePortableValue } from "../migration/portable-value"

const kindSchema = Schema.Literals(["kv", "r2", "session", "isolate"])
const infoSchema = Schema.Struct({
  kind: kindSchema,
  resourceId: Schema.String,
  writable: Schema.Boolean,
})
const headerSchema = Schema.Struct({
  type: Schema.Literal("header"),
  version: Schema.Literal(1),
  id: Schema.String,
  source: Schema.Struct({ url: Schema.String, kind: kindSchema, resourceId: Schema.String }),
})
const checksum = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
const lineSchema = Schema.Union([
  headerSchema,
  Schema.Struct({
    type: Schema.Literal("value"),
    key: Schema.String,
    hash: checksum,
    size: Schema.Number,
    metadata: storageMetadataSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("object"),
    name: Schema.String,
    inventory: durableMigrationInventorySchema,
  }),
  Schema.Struct({
    type: Schema.Literal("sql"),
    name: Schema.String,
    table: Schema.String,
    offset: Schema.Number,
    hash: checksum,
    size: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal("object-kv"),
    name: Schema.String,
    after: Schema.String,
    hash: checksum,
    size: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal("end"),
    entries: Schema.Number,
    manifestHash: checksum,
    bodyHash: checksum,
  }),
])
const sqlPageSchema = Schema.Struct({
  rows: Schema.Array(Schema.Array(Schema.String)),
  complete: Schema.Boolean,
})
const kvPageSchema = Schema.Struct({
  entries: Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.String })),
  complete: Schema.Boolean,
})
const progressSchema = Schema.NullOr(
  Schema.Struct({
    id: Schema.String,
    tables: Schema.Array(Schema.Struct({ name: Schema.String, offset: Schema.Number })),
    kvAfter: Schema.String,
    kvComplete: Schema.Boolean,
    complete: Schema.Boolean,
  }),
)
const inventorySchema = Schema.Struct({
  kind: kindSchema,
  entries: Schema.Array(
    Schema.Struct({ name: Schema.String, expiration: Schema.optional(Schema.Number) }),
  ),
  cursor: Schema.NullOr(Schema.String),
})
type ArchiveLine = typeof lineSchema.Type
type Header = typeof headerSchema.Type
export type StorageKind = typeof kindSchema.Type
type OperatorFetch = (path: string, init?: RequestInit) => Promise<Response>
export interface StorageTransferReport {
  readonly status: "exported" | "planned" | "verified"
  readonly entries: number
  readonly bodyHash: string
}
export class StorageTransferError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StorageTransferError"
  }
}

function canonical(value: unknown): string {
  function sort(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(sort)
    if (typeof item === "object" && item !== null)
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, sort(entry)]),
      )
    return item
  }
  return JSON.stringify(sort(value))
}
function operator(url: string, token: string): OperatorFetch {
  const base = new URL(url)
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/" ||
    (base.protocol !== "https:" &&
      !(
        base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
      )) ||
    token.length < 32
  )
    throw new StorageTransferError(
      "Use a root HTTPS operator URL and a token of at least 32 characters; HTTP is allowed only on loopback.",
    )
  return async (path, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set("Authorization", `Bearer ${token}`)
    const response = await fetch(new URL(path, base), {
      ...init,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok && response.status !== 404)
      throw new StorageTransferError(
        `Storage operator returned HTTP ${response.status}; response details are suppressed.`,
      )
    return response
  }
}
async function rpc(fetcher: OperatorFetch, name: string, request: unknown): Promise<unknown> {
  const response = await fetcher(`/object?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  })
  if (!response.ok)
    throw new StorageTransferError(
      "Durable Object migration RPC is unavailable; deploy the compatible exporter on the source before transfer.",
    )
  return response.json()
}
async function blobHash(path: string): Promise<{ hash: string; size: number }> {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.mode & 0o077)
    throw new StorageTransferError("Migration blobs must be private regular files, not links.")
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return { hash: hash.digest("hex"), size: stat.size }
}
async function writeBlob(
  directory: string,
  response: Response,
): Promise<{ hash: string; size: number }> {
  if (!response.ok || !response.body)
    throw new StorageTransferError(
      "Source value is missing or has no readable body; re-export the frozen source.",
    )
  const part = resolve(directory, "blobs", `${randomUUID()}.partial`)
  const hash = createHash("sha256")
  let size = 0
  const digest = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk)
      size += chunk.length
      done(null, chunk)
    },
  })
  await pipeline(response.body, digest, createWriteStream(part, { flags: "wx", mode: 0o600 }))
  const result = { hash: hash.digest("hex"), size }
  const destination = resolve(directory, "blobs", result.hash)
  try {
    await copyFile(part, destination, constants.COPYFILE_EXCL)
  } catch (cause) {
    if (
      !(
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === "EEXIST"
      ) ||
      (await blobHash(destination)).hash !== result.hash
    )
      throw cause
  }
  await unlink(part)
  return result
}

export async function exportStorage(input: {
  url: string
  token: string
  kind: StorageKind
  directory: string
  frozen: boolean
  objectNames?: readonly string[]
  allowWritableVerification?: boolean
}): Promise<StorageTransferReport> {
  if (!input.frozen)
    throw new StorageTransferError("Freeze source writes and drain work before exporting.")
  const fetcher = operator(input.url, input.token)
  const info = Schema.decodeUnknownSync(infoSchema)(await (await fetcher("/info")).json())
  if (info.kind !== input.kind || (info.writable && !input.allowWritableVerification))
    throw new StorageTransferError(
      "The source operator must be read-only and bind the requested resource kind.",
    )
  await mkdir(input.directory, { mode: 0o700 })
  await mkdir(resolve(input.directory, "blobs"), { mode: 0o700 })
  const file = await open(resolve(input.directory, "manifest.ndjson"), "wx", 0o600)
  const manifestHash = createHash("sha256"),
    bodyHash = createHash("sha256")
  let entries = 0
  const header: Header = {
    type: "header",
    version: 1,
    id: randomUUID(),
    source: { url: new URL(input.url).origin, kind: input.kind, resourceId: info.resourceId },
  }
  async function write(line: ArchiveLine) {
    const encoded = canonical(line) + "\n"
    await file.writeFile(encoded)
    if (line.type !== "end") manifestHash.update(encoded)
    if (line.type !== "header" && line.type !== "end") {
      bodyHash.update(encoded)
      entries++
    }
  }
  try {
    await write(header)
    if (input.kind === "r2" || input.kind === "kv") {
      let cursor: string | null = null,
        previousKey: string | undefined
      do {
        const listed = Schema.decodeUnknownSync(inventorySchema)(
          await (
            await fetcher(`/inventory${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)
          ).json(),
        )
        if (listed.kind !== input.kind || (listed.cursor !== null && listed.cursor === cursor))
          throw new StorageTransferError("Source inventory kind or pagination is invalid.")
        for (const entry of listed.entries) {
          if (
            previousKey !== undefined &&
            Buffer.compare(Buffer.from(previousKey), Buffer.from(entry.name)) >= 0
          )
            throw new StorageTransferError(
              "Source inventory is unordered or contains duplicate keys.",
            )
          previousKey = entry.name
          const response = await fetcher(`/value?key=${encodeURIComponent(entry.name)}`)
          const metadata = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
            JSON.parse(decodeURIComponent(response.headers.get("x-s0-metadata") ?? "{}")),
          )
          const withExpiration =
            entry.expiration === undefined
              ? metadata
              : { ...metadata, expiration: entry.expiration }
          await write({
            type: "value",
            key: entry.name,
            metadata: withExpiration,
            ...(await writeBlob(input.directory, response)),
          })
        }
        cursor = listed.cursor
      } while (cursor !== null)
    } else {
      if (!input.objectNames)
        throw new StorageTransferError(
          "Durable Object export requires explicit logical names from the control-plane inventory.",
        )
      const names = [...input.objectNames].sort((a, b) =>
        Buffer.compare(Buffer.from(a), Buffer.from(b)),
      )
      if (new Set(names).size !== names.length || names.some((name) => !name))
        throw new StorageTransferError("Object names must be nonempty and unique.")
      for (const name of names) {
        const inventory = Schema.decodeUnknownSync(durableMigrationInventorySchema)(
          await rpc(fetcher, name, { operation: "inventory" }),
        )
        await write({ type: "object", name, inventory })
        for (const table of inventory.tables)
          for (let offset = 0; offset < table.rows; ) {
            const data = Schema.decodeUnknownSync(sqlPageSchema)(
              await rpc(fetcher, name, { operation: "read", table: table.name, offset }),
            )
            if (!data.rows.length || offset + data.rows.length > table.rows)
              throw new StorageTransferError("Source SQL page count changed during export.")
            await write({
              type: "sql",
              name,
              table: table.name,
              offset,
              ...(await writeBlob(input.directory, Response.json(data))),
            })
            offset += data.rows.length
          }
        let after = "",
          complete = false
        do {
          const data = Schema.decodeUnknownSync(kvPageSchema)(
            await rpc(fetcher, name, { operation: "read-kv", after }),
          )
          if (!data.complete && !data.entries.length)
            throw new StorageTransferError("Source object KV pagination made no progress.")
          await write({
            type: "object-kv",
            name,
            after,
            ...(await writeBlob(input.directory, Response.json(data))),
          })
          after = data.entries.at(-1)?.key ?? after
          complete = data.complete
        } while (!complete)
      }
    }
    const result = { status: "exported" as const, entries, bodyHash: bodyHash.digest("hex") }
    await write({
      type: "end",
      entries,
      bodyHash: result.bodyHash,
      manifestHash: manifestHash.digest("hex"),
    })
    return result
  } finally {
    await file.close()
  }
}

async function* archiveLines(directory: string) {
  const path = resolve(directory, "manifest.ndjson"),
    stat = await lstat(path)
  if (!stat.isFile() || stat.mode & 0o077)
    throw new StorageTransferError("The manifest must be a private regular file.")
  const stream = createReadStream(path),
    lines = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (Buffer.byteLength(line) > 8 * 1024 * 1024)
        throw new StorageTransferError("Manifest line is too large.")
      yield {
        raw: line + "\n",
        value: Schema.decodeUnknownSync(lineSchema, { onExcessProperty: "error" })(
          JSON.parse(line),
        ),
      }
    }
  } finally {
    lines.close()
    stream.destroy()
  }
}
export async function validateStorageArchive(
  directory: string,
): Promise<{ header: Header; entries: number; bodyHash: string }> {
  for (const path of [directory, resolve(directory, "blobs")]) {
    const stat = await lstat(path)
    if (!stat.isDirectory() || stat.mode & 0o077)
      throw new StorageTransferError(
        "Migration directories must be private directories, not links.",
      )
  }
  const manifestHash = createHash("sha256"),
    bodyHash = createHash("sha256")
  let header: Header | undefined,
    ended = false,
    entries = 0,
    footerDigest = ""
  let previousKey: string | undefined
  let active:
    | {
        name: string
        tables: Array<{ name: string; rows: number; fields: number; offset: number }>
        after: string
        complete: boolean
      }
    | undefined
  const objects = new Set<string>()
  function finishedObject() {
    if (active && (!active.complete || active.tables.some((table) => table.rows !== table.offset)))
      throw new StorageTransferError(
        "Object pages are incomplete or unordered; refusing all writes.",
      )
  }
  for await (const { raw, value } of archiveLines(directory)) {
    if (ended || (!header && value.type !== "header"))
      throw new StorageTransferError("Manifest has no header, or data after its footer.")
    if (value.type === "header") {
      if (header) throw new StorageTransferError("Duplicate manifest header.")
      header = value
    } else if (value.type === "end") {
      finishedObject()
      if (
        value.entries !== entries ||
        value.manifestHash !== manifestHash.digest("hex") ||
        value.bodyHash !== bodyHash.digest("hex")
      )
        throw new StorageTransferError("Manifest integrity or entry count differs.")
      ended = true
      footerDigest = value.bodyHash
      continue
    } else {
      entries++
      bodyHash.update(raw)
      if ("hash" in value) {
        if (!Number.isSafeInteger(value.size) || value.size < 0)
          throw new StorageTransferError("Invalid archive blob size.")
        const found = await blobHash(resolve(directory, "blobs", value.hash))
        if (found.hash !== value.hash || found.size !== value.size)
          throw new StorageTransferError(
            "Migration blob size or checksum differs; no destination writes are allowed.",
          )
      }
      if (value.type === "value") {
        if (
          !["r2", "kv"].includes(header!.source.kind) ||
          (previousKey !== undefined &&
            Buffer.compare(Buffer.from(previousKey), Buffer.from(value.key)) >= 0)
        )
          throw new StorageTransferError(
            "Value keys are duplicated, unordered, or incompatible with the store kind.",
          )
        previousKey = value.key
      } else {
        if (!["session", "isolate"].includes(header!.source.kind))
          throw new StorageTransferError("Object pages are incompatible with the store kind.")
        if (value.type === "object") {
          finishedObject()
          if (
            !value.name ||
            objects.has(value.name) ||
            new Set(value.inventory.tables.map((table) => table.name)).size !==
              value.inventory.tables.length
          )
            throw new StorageTransferError("Duplicate object or table inventory.")
          objects.add(value.name)
          active = {
            name: value.name,
            tables: value.inventory.tables.map((table) => ({
              name: table.name,
              rows: table.rows,
              fields: table.columns.length + Number(table.rowid),
              offset: 0,
            })),
            after: "",
            complete: false,
          }
        } else if (value.type === "sql") {
          const table = active?.tables.find((table) => table.offset < table.rows)
          const page = Schema.decodeUnknownSync(sqlPageSchema)(await payload(directory, value.hash))
          if (
            !active ||
            value.name !== active.name ||
            !table ||
            table.name !== value.table ||
            table.offset !== value.offset ||
            !page.rows.length ||
            page.rows.length > 100 ||
            table.offset + page.rows.length > table.rows ||
            active.after ||
            active.complete
          )
            throw new StorageTransferError("Invalid or out-of-order SQL page.")
          for (const row of page.rows) {
            if (row.length !== table.fields)
              throw new StorageTransferError("Invalid SQL row shape.")
            for (const cell of row) {
              const decoded = decodePortableValue(cell)
              if (
                !(
                  decoded === null ||
                  typeof decoded === "string" ||
                  (typeof decoded === "number" && Number.isFinite(decoded)) ||
                  decoded instanceof ArrayBuffer
                )
              )
                throw new StorageTransferError("Invalid SQL cell.")
            }
          }
          table.offset += page.rows.length
          if (page.complete !== (table.offset === table.rows))
            throw new StorageTransferError("Invalid SQL completion marker.")
        } else if (value.type === "object-kv") {
          const page = Schema.decodeUnknownSync(kvPageSchema)(await payload(directory, value.hash))
          if (
            !active ||
            value.name !== active.name ||
            active.complete ||
            value.after !== active.after ||
            active.tables.some((table) => table.rows !== table.offset) ||
            page.entries.length > 100 ||
            (!page.complete && !page.entries.length)
          )
            throw new StorageTransferError("Invalid or out-of-order object KV page.")
          for (const entry of page.entries) {
            if (
              entry.key === "__s0_migration_transfer" ||
              Buffer.compare(Buffer.from(entry.key), Buffer.from(active.after)) <= 0
            )
              throw new StorageTransferError("Duplicate or reserved object KV key.")
            decodePortableValue(entry.value)
            active.after = entry.key
          }
          active.complete = page.complete
        }
      }
    }
    manifestHash.update(raw)
  }
  if (!ended || !header)
    throw new StorageTransferError("The export is incomplete; a verified footer is required.")
  return { header, entries, bodyHash: footerDigest }
}

async function payload(directory: string, hash: string): Promise<unknown> {
  const path = resolve(directory, "blobs", hash)
  if ((await lstat(path)).size > 8 * 1024 * 1024)
    throw new StorageTransferError("Object page exceeds the payload limit.")
  return JSON.parse(await readFile(path, "utf8"))
}

export async function importStorage(input: {
  directory: string
  url: string
  token: string
  apply: boolean
  frozen: boolean
  verificationDirectory?: string
}): Promise<StorageTransferReport> {
  const archive = await validateStorageArchive(input.directory)
  const fetcher = operator(input.url, input.token)
  const info = Schema.decodeUnknownSync(infoSchema)(await (await fetcher("/info")).json())
  if (
    info.kind !== archive.header.source.kind ||
    info.resourceId === archive.header.source.resourceId ||
    new URL(input.url).origin === archive.header.source.url
  )
    throw new StorageTransferError(
      "Destination must be a distinct resource of the same kind, never the source.",
    )
  if (!input.apply)
    return { status: "planned", entries: archive.entries, bodyHash: archive.bodyHash }
  if (!input.frozen || !info.writable || !input.verificationDirectory)
    throw new StorageTransferError(
      "Applying requires an offline writable destination and a new private verification directory.",
    )
  let activeObject: string | undefined
  let progress: typeof progressSchema.Type = null
  let reachedKvResumePoint = true
  const objectNames: string[] = []
  async function finishObject() {
    if (!activeObject || progress?.complete) return
    await rpc(fetcher, activeObject, { operation: "finish" })
    // ctx.abort intentionally drops the RPC response. A fresh export below independently verifies persisted state after reload.
    try {
      await rpc(fetcher, activeObject, { operation: "reload" })
    } catch {
      /* verification is mandatory even when reload drops the response */
    }
  }
  for await (const { value } of archiveLines(input.directory)) {
    if (value.type === "value") {
      const existing = await fetcher(`/value?key=${encodeURIComponent(value.key)}`)
      if (existing.status === 404) {
        await fetcher(`/value?key=${encodeURIComponent(value.key)}`, {
          method: "PUT",
          headers: { "x-s0-metadata": encodeURIComponent(JSON.stringify(value.metadata)) },
          body: await openAsBlob(resolve(input.directory, "blobs", value.hash)),
        })
      } else {
        const hash = createHash("sha256")
        if (!existing.body) throw new StorageTransferError("Destination value cannot be verified.")
        const reader = existing.body.getReader()
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          hash.update(chunk.value)
        }
        if (hash.digest("hex") !== value.hash)
          throw new StorageTransferError(
            "Destination contains a different value; overwriting is not supported.",
          )
      }
    }
    if (value.type === "object") {
      await finishObject()
      activeObject = value.name
      objectNames.push(value.name)
      progress = Schema.decodeUnknownSync(progressSchema)(
        await rpc(fetcher, value.name, { operation: "progress" }),
      )
      if (progress && progress.id !== archive.header.id)
        throw new StorageTransferError("Destination object belongs to another transfer.")
      if (!progress) {
        await rpc(fetcher, value.name, {
          operation: "begin",
          id: archive.header.id,
          inventory: value.inventory,
        })
        progress = Schema.decodeUnknownSync(progressSchema)(
          await rpc(fetcher, value.name, { operation: "progress" }),
        )
      }
      reachedKvResumePoint = !progress?.kvAfter
    }
    if (value.type === "sql") {
      if (value.name !== activeObject)
        throw new StorageTransferError("SQL page is outside its object.")
      const data = Schema.decodeUnknownSync(sqlPageSchema)(
        await payload(input.directory, value.hash),
      )
      const offset = progress?.tables.find((table) => table.name === value.table)?.offset ?? 0
      if (offset <= value.offset)
        await rpc(fetcher, value.name, {
          operation: "write",
          table: value.table,
          offset: value.offset,
          rows: data.rows,
        })
    }
    if (value.type === "object-kv") {
      if (value.name !== activeObject)
        throw new StorageTransferError("KV page is outside its object.")
      const data = Schema.decodeUnknownSync(kvPageSchema)(
        await payload(input.directory, value.hash),
      )
      if (!progress?.kvComplete) {
        if (reachedKvResumePoint)
          await rpc(fetcher, value.name, {
            operation: "write-kv",
            after: value.after,
            entries: data.entries,
            complete: data.complete,
          })
        else if (data.entries.at(-1)?.key === progress?.kvAfter) reachedKvResumePoint = true
      }
    }
  }
  await finishObject()
  const verified = await exportStorage({
    directory: input.verificationDirectory,
    url: input.url,
    token: input.token,
    kind: info.kind,
    frozen: true,
    objectNames,
    allowWritableVerification: true,
  })
  if (verified.bodyHash !== archive.bodyHash || verified.entries !== archive.entries)
    throw new StorageTransferError(
      "Independent destination export differs from source; do not cut over.",
    )
  return { status: "verified", entries: archive.entries, bodyHash: archive.bodyHash }
}
