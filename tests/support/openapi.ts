import * as Schema from "effect/Schema"

const OpenApiProperty = Schema.Struct({
  default: Schema.optionalKey(Schema.Unknown),
})

const OpenApiObjectSchema = Schema.Struct({
  $ref: Schema.optionalKey(Schema.String),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
  properties: Schema.optionalKey(Schema.Record(Schema.String, OpenApiProperty)),
})

const OpenApiDocument = Schema.Struct({
  components: Schema.optionalKey(
    Schema.Struct({
      schemas: Schema.optionalKey(Schema.Record(Schema.String, OpenApiObjectSchema)),
    }),
  ),
})

export type OpenApiObjectContract = {
  readonly required: ReadonlyArray<string>
  hasProperty(name: string): boolean
  propertyHasDefault(name: string): boolean
}

function toContract(schema: typeof OpenApiObjectSchema.Type): OpenApiObjectContract {
  const properties = schema.properties ?? {}

  return {
    required: schema.required ?? [],
    hasProperty(name) {
      return Object.hasOwn(properties, name)
    },
    propertyHasDefault(name) {
      const property = properties[name]

      return property !== undefined && Object.hasOwn(property, "default")
    },
  }
}

export function resolveOpenApiSchema(document: unknown, schema: unknown): OpenApiObjectContract {
  const parsedDocument = Schema.decodeUnknownSync(OpenApiDocument)(document)
  const parsedSchema = Schema.decodeUnknownSync(OpenApiObjectSchema)(schema)
  const refName = parsedSchema.$ref?.split("/").pop()

  if (refName === undefined) {
    return toContract(parsedSchema)
  }

  const resolved = parsedDocument.components?.schemas?.[refName]

  if (resolved === undefined) {
    throw new Error(`OpenAPI schema ${refName} is missing`)
  }

  return toContract(resolved)
}
