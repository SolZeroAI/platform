import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

// Centralized JSON boundary helpers. Importing these keeps `JSON.parse`/`JSON.stringify`
// and try/catch out of caller modules without forcing those modules to depend on `effect`
// directly (which would otherwise activate the Effect-file lint rules across them).

const decodeRecordOption = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
)
const decodeValueSync = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))
const encodeJsonString = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown))

const emptyRecord = (): Record<string, unknown> => ({})

/** Parse a JSON object string, returning `{}` for null/invalid/non-object input. */
export const parseJsonRecord = (value: string | null | undefined): Record<string, unknown> =>
  Option.getOrElse(decodeRecordOption(value), emptyRecord)

/** Parse a JSON string strictly, throwing on invalid input (like `JSON.parse`). */
export const parseJson = (value: string): unknown => decodeValueSync(value)

/** Serialize a value to a compact JSON string (throws on cycles, like `JSON.stringify`). */
export const stringifyJson = (value: unknown): string => encodeJsonString(value)
