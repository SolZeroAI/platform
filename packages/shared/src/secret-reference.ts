/* oxlint-disable s0-lint/avoid-untagged-errors, s0-lint/no-if-statement, s0-lint/no-ternary -- Secret references are synchronously validated while compiling deployment configuration. */
import * as Schema from "effect/Schema"

export const ENVIRONMENT_BINDING_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/

// oxlint-disable-next-line effect/prefer-schema-class -- deployment JSONC uses plain DTOs across infra and Worker boundaries
export const SecretReferenceSchema = Schema.Struct({
  env: Schema.String,
  generateIfMissing: Schema.optional(Schema.Boolean),
})
export type SecretReference = typeof SecretReferenceSchema.Type

export function normalizeSecretReference(value: SecretReference, path: string): SecretReference {
  const env = value.env.trim()
  if (!ENVIRONMENT_BINDING_NAME_PATTERN.test(env)) {
    throw new Error(
      `Invalid s0 configuration: ${path}.env must match ${ENVIRONMENT_BINDING_NAME_PATTERN}`,
    )
  }
  return value.generateIfMissing === true ? { env, generateIfMissing: true } : { env }
}
