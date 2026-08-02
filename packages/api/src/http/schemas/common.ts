import { Schema } from "effect"

export const JsonPrimitive = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
])

export const JsonValue: Schema.Schema<unknown> = Schema.suspend(() =>
  Schema.Union([JsonPrimitive, Schema.Array(JsonValue), Schema.Record(Schema.String, JsonValue)]),
)

export const JsonRecord = Schema.Record(Schema.String, JsonValue)
export const StringMap = Schema.Record(Schema.String, Schema.String)

export class StatusResponse extends Schema.Class<StatusResponse>("StatusResponse")({
  status: Schema.String,
}) {}

export class DeletedApiKeyResponse extends Schema.Class<DeletedApiKeyResponse>(
  "DeletedApiKeyResponse",
)({
  status: Schema.String,
  keyId: Schema.String,
}) {}

export class DeletedSecretResponse extends Schema.Class<DeletedSecretResponse>(
  "DeletedSecretResponse",
)({
  status: Schema.String,
  key: Schema.String,
}) {}

export class DeletedSessionResponse extends Schema.Class<DeletedSessionResponse>(
  "DeletedSessionResponse",
)({
  status: Schema.String,
  sessionId: Schema.String,
}) {}
