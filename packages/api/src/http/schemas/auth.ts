import { Schema } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { JsonRecord } from "./common"

export const CreateApiKeyPayload = Schema.Struct({
  label: Schema.optionalKey(Schema.String),
})

export type CreateApiKeyPayload = typeof CreateApiKeyPayload.Type

export const KeyIdParams = {
  keyId: Schema.String,
}

export type KeyIdParams = { keyId: string }

export class AuthSessionResponse extends Schema.Class<AuthSessionResponse>("AuthSessionResponse")({
  user: JsonRecord,
  githubAccountId: Schema.NullOr(Schema.String),
  isAdmin: Schema.Boolean,
}) {}

export class ApiKeyResponse extends Schema.Class<ApiKeyResponse>("ApiKeyResponse")({
  keyId: Schema.String,
  userId: Schema.String,
  label: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  lastUsedAt: Schema.NullOr(Schema.Number),
  revokedAt: Schema.NullOr(Schema.Number),
}) {}

export class CreatedApiKeyResponse extends Schema.Class<CreatedApiKeyResponse>(
  "CreatedApiKeyResponse",
)({
  keyId: Schema.String,
  key: Schema.String,
  label: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
}) {}

/** The create route answers 201 Created. */
export const CreatedApiKeySuccess = CreatedApiKeyResponse.pipe(HttpApiSchema.status(201))

export class ApiKeysResponse extends Schema.Class<ApiKeysResponse>("ApiKeysResponse")({
  keys: Schema.Array(ApiKeyResponse),
}) {}
