import { Schema } from "effect"
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

export class ApiKeysResponse extends Schema.Class<ApiKeysResponse>("ApiKeysResponse")({
  keys: Schema.Array(ApiKeyResponse),
}) {}
