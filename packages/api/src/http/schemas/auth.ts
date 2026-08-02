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
  id: Schema.String,
  label: Schema.NullOr(Schema.String),
  prefix: Schema.String,
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
}) {}

export class CreatedApiKeyResponse extends Schema.Class<CreatedApiKeyResponse>(
  "CreatedApiKeyResponse",
)({
  key: Schema.String,
  apiKey: ApiKeyResponse,
}) {}

export class ApiKeysResponse extends Schema.Class<ApiKeysResponse>("ApiKeysResponse")({
  keys: Schema.Array(ApiKeyResponse),
}) {}
