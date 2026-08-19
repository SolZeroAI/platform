import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

// Centralized JSON boundary helpers. Importing these keeps `JSON.parse`/`JSON.stringify`
// and try/catch out of caller modules without forcing those modules to depend on `effect`
// directly (which would otherwise activate the Effect-file lint rules across them).

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject
export interface JsonObject {
  readonly [key: string]: JsonValue
}

export const JsonValueSchema: Schema.Codec<JsonValue> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.Array(JsonValueSchema),
    Schema.Record(Schema.String, JsonValueSchema),
  ]),
)
export const JsonObjectSchema = Schema.Record(Schema.String, JsonValueSchema)

const decodeRecordOption = Schema.decodeUnknownOption(Schema.fromJsonString(JsonObjectSchema))
const decodeValueSync = Schema.decodeUnknownSync(Schema.fromJsonString(JsonValueSchema))
const encodeJsonString = Schema.encodeUnknownSync(Schema.UnknownFromJsonString)

const emptyObject = (): JsonObject => ({})

/** Parse a JSON object string, returning `{}` for null/invalid/non-object input. */
export const parseJsonRecord = (value: string | null | undefined): JsonObject =>
  Option.getOrElse(decodeRecordOption(value), emptyObject)

/** Parse a JSON string strictly, throwing on invalid input (like `JSON.parse`). */
export const parseJson = (value: string): JsonValue => decodeValueSync(value)

/** Serialize a value to a compact JSON string (throws on cycles, like `JSON.stringify`). */
export const stringifyJson = (value: unknown): string => encodeJsonString(value)
