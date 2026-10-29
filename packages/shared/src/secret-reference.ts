import * as Match from "effect/Match"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { invalidS0Config, type ConfigValidationError } from "./config-error"

const ENVIRONMENT_BINDING_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/

export const SecretReferenceSchema = Schema.Struct({
  env: Schema.String,
  generateIfMissing: Schema.optional(Schema.Boolean),
})

export type SecretReference = typeof SecretReferenceSchema.Type

export function normalizeSecretReference(
  value: SecretReference,
  path: string,
): Result.Result<SecretReference, ConfigValidationError> {
  return Result.liftPredicate(
    value.env.trim(),
    (env) => ENVIRONMENT_BINDING_NAME_PATTERN.test(env),
    () => invalidS0Config(`${path}.env must match ${ENVIRONMENT_BINDING_NAME_PATTERN}`),
  ).pipe(
    Result.map((env) =>
      Match.value(value.generateIfMissing).pipe(
        Match.when(true, () => ({ env, generateIfMissing: true })),
        Match.orElse(() => ({ env })),
      ),
    ),
  )
}
