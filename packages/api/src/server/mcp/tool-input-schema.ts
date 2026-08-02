import { type Tool } from "@modelcontextprotocol/sdk/types.js"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

function isMcpObjectInputSchema(value: unknown): value is Tool["inputSchema"] {
  return (
    typeof value === "object" && value !== null && (value as { type?: unknown }).type === "object"
  )
}

/**
 * Effect's `toStandardJSONSchemaV1` wraps a `Schema.Class` input in a top-level
 * `{ $ref: "#/definitions/Name", definitions: { Name: {...} } }`. MCP `inputSchema` needs the
 * inlined object schema, so resolve a local root `$ref` to its definition when present.
 */
function localRefTarget(value: unknown): Option.Option<unknown> {
  return Option.fromNullishOr(value).pipe(
    Option.filter(
      (candidate): candidate is Record<string, unknown> =>
        typeof candidate === "object" && candidate !== null,
    ),
    Option.flatMap((record) =>
      Option.fromNullishOr(record.$ref).pipe(
        Option.filter((ref): ref is string => typeof ref === "string"),
        Option.flatMap((ref) =>
          Option.all([
            Option.fromNullishOr(ref.split("/")[1]),
            Option.fromNullishOr(ref.split("/")[2]),
          ]).pipe(
            Option.flatMap(([bucketKey, name]) =>
              Option.fromNullishOr(record[bucketKey]).pipe(
                Option.filter(
                  (bucket): bucket is Record<string, unknown> =>
                    typeof bucket === "object" && bucket !== null,
                ),
                Option.flatMap((bucket) => Option.fromNullishOr(bucket[name])),
              ),
            ),
          ),
        ),
      ),
    ),
  )
}

function toMcpObjectInputSchema(value: unknown): Option.Option<Tool["inputSchema"]> {
  return Option.fromNullishOr(Option.getOrElse(localRefTarget(value), () => value)).pipe(
    Option.filter(isMcpObjectInputSchema),
  )
}

/** Derive an MCP tool `inputSchema` (object JSON Schema) from an Effect `Schema`. */
export function objectInputSchema<S extends Schema.Decoder<unknown, never>>(
  schema: S,
): Tool["inputSchema"] {
  const jsonSchema = Schema.toStandardJSONSchemaV1(schema)["~standard"].jsonSchema.input({
    target: "draft-07",
  })
  return Option.getOrThrowWith(
    toMcpObjectInputSchema(jsonSchema),
    () => new Error("Effect schema did not produce an MCP object input schema"),
  )
}
