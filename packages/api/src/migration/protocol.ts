import * as Schema from "effect/Schema"

export const storageMetadataSchema = Schema.Struct({
  customMetadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  httpMetadata: Schema.optional(
    Schema.Struct({
      contentType: Schema.optional(Schema.String),
      contentLanguage: Schema.optional(Schema.String),
      contentDisposition: Schema.optional(Schema.String),
      contentEncoding: Schema.optional(Schema.String),
      cacheControl: Schema.optional(Schema.String),
      cacheExpiry: Schema.optional(Schema.String),
    }),
  ),
  storageClass: Schema.optional(Schema.Literals(["Standard", "InfrequentAccess"])),
  metadata: Schema.optional(Schema.Unknown),
  expiration: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
})

const count = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)
const tableSchema = Schema.Struct({
  name: Schema.String,
  columns: Schema.Array(Schema.String),
  rowid: Schema.Boolean,
  rows: count,
})
export const durableMigrationInventorySchema = Schema.Struct({
  version: Schema.Literal(1),
  tables: Schema.Array(tableSchema),
})
export const durableMigrationRequestSchema = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("inventory") }),
  Schema.Struct({ operation: Schema.Literal("progress") }),
  Schema.Struct({ operation: Schema.Literal("read"), table: Schema.String, offset: Schema.Number }),
  Schema.Struct({ operation: Schema.Literal("read-kv"), after: Schema.String }),
  Schema.Struct({
    operation: Schema.Literal("begin"),
    id: Schema.String,
    inventory: durableMigrationInventorySchema,
  }),
  Schema.Struct({
    operation: Schema.Literal("write"),
    table: Schema.String,
    offset: Schema.Number,
    rows: Schema.Array(Schema.Array(Schema.String)),
  }),
  Schema.Struct({
    operation: Schema.Literal("write-kv"),
    after: Schema.String,
    entries: Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.String })),
    complete: Schema.Boolean,
  }),
  Schema.Struct({ operation: Schema.Literal("finish") }),
  Schema.Struct({ operation: Schema.Literal("reload") }),
])
