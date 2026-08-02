import { Schema } from "effect"

export class GlobalSecretMetadata extends Schema.Class<GlobalSecretMetadata>(
  "GlobalSecretMetadata",
)({
  key: Schema.String,
  tags: Schema.Array(Schema.String),
}) {}

export class GlobalSecretWrite extends Schema.Class<GlobalSecretWrite>("GlobalSecretWrite")({
  key: Schema.String,
  value: Schema.optionalKey(Schema.String),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
}) {}

export const SecretsPayload = Schema.Struct({
  secrets: Schema.Array(GlobalSecretWrite),
})
export type SecretsPayload = typeof SecretsPayload.Type

export const SecretKeyParams = {
  key: Schema.String,
}
export type SecretKeyParams = { key: string }

export const GlobalSecretsListQuery = {
  q: Schema.optionalKey(Schema.String),
  tags: Schema.optionalKey(Schema.String),
}
export type GlobalSecretsListQuery = {
  q?: string
  tags?: string
}

export class GlobalSecretsResponse extends Schema.Class<GlobalSecretsResponse>(
  "GlobalSecretsResponse",
)({
  secrets: Schema.Array(GlobalSecretMetadata),
  tags: Schema.Array(Schema.String),
}) {}

export class GlobalSecretTagsResponse extends Schema.Class<GlobalSecretTagsResponse>(
  "GlobalSecretTagsResponse",
)({
  tags: Schema.Array(Schema.String),
  popularTags: Schema.Array(Schema.String),
}) {}

export class GlobalSecretsSetResponse extends Schema.Class<GlobalSecretsSetResponse>(
  "GlobalSecretsSetResponse",
)({
  status: Schema.String,
  keys: Schema.Array(Schema.String),
}) {}

export class GlobalSecretDeletedResponse extends Schema.Class<GlobalSecretDeletedResponse>(
  "GlobalSecretDeletedResponse",
)({
  status: Schema.String,
  key: Schema.String,
}) {}
