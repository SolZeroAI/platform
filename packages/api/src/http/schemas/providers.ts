import { Schema } from "effect"
import { JsonRecord } from "./common"

export const ProviderModelLimit = Schema.Struct({
  context: Schema.Number,
  output: Schema.Number,
})

export const ModelReasoningConfig = Schema.Struct({
  efforts: Schema.Array(Schema.String),
  default: Schema.optionalKey(Schema.String),
})

export const ModelProviderOverride = Schema.Struct({
  npm: Schema.optionalKey(Schema.String),
  api: Schema.optionalKey(Schema.String),
})

export const ProviderModelDefinition = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  options: Schema.optionalKey(JsonRecord),
  limit: Schema.optionalKey(ProviderModelLimit),
  reasoning: Schema.optionalKey(ModelReasoningConfig),
  provider: Schema.optionalKey(ModelProviderOverride),
})
export type ProviderModelDefinition = typeof ProviderModelDefinition.Type

export const OpenCodePermissionAction = Schema.Literals(["allow", "ask", "deny"])
export const OpenCodePermission = Schema.Union([OpenCodePermissionAction, JsonRecord])

export const SharedProviderOverridePayload = Schema.Struct({
  providerId: Schema.String,
  displayName: Schema.String,
  apiKey: Schema.optionalKey(Schema.String),
  clearApiKey: Schema.optionalKey(Schema.Boolean),
})

export const CustomProviderPayload = Schema.Struct({
  providerId: Schema.String,
  name: Schema.String,
  npm: Schema.optionalKey(Schema.String),
  options: Schema.optionalKey(JsonRecord),
  models: Schema.Record(Schema.String, ProviderModelDefinition),
  apiKey: Schema.optionalKey(Schema.String),
  clearApiKey: Schema.optionalKey(Schema.Boolean),
})

export const ProviderSettingsPayload = Schema.Struct({
  defaultModel: Schema.Union([Schema.String, Schema.Null]),
  defaultIsolateStepLimit: Schema.optionalKey(Schema.Union([Schema.Number, Schema.Null])),
  opencodePermission: Schema.optionalKey(Schema.Union([OpenCodePermission, Schema.Null])),
  sharedOverrides: Schema.Array(SharedProviderOverridePayload),
  customProviders: Schema.Array(CustomProviderPayload),
})
export type ProviderSettingsPayload = typeof ProviderSettingsPayload.Type

export const RuntimeModelOption = Schema.Struct({
  id: Schema.String,
  providerId: Schema.String,
  providerName: Schema.String,
  modelId: Schema.String,
  name: Schema.String,
  description: Schema.String,
  reasoning: Schema.optionalKey(ModelReasoningConfig),
})

export const RuntimeModelGroup = Schema.Struct({
  category: Schema.String,
  providerId: Schema.String,
  models: Schema.Array(RuntimeModelOption),
})

export const RuntimeProvider = Schema.Struct({
  providerId: Schema.String,
  name: Schema.String,
  npm: Schema.optionalKey(Schema.String),
  options: Schema.optionalKey(JsonRecord),
  source: Schema.Literals(["shared", "custom"]),
  hasApiKey: Schema.Boolean,
  globalCredentialConfigured: Schema.Boolean,
  credentialSource: Schema.Literals(["shared", "user_override", "user_custom", "missing"]),
  models: Schema.Array(RuntimeModelOption),
})

export const ProviderSettingsSnapshot = Schema.Struct({
  defaultModel: Schema.NullOr(Schema.String),
  defaultIsolateStepLimit: Schema.Number,
  opencodePermission: Schema.NullOr(OpenCodePermission),
  defaultOpenCodePermission: OpenCodePermission,
  sharedOverrides: Schema.Array(JsonRecord),
  customProviders: Schema.Array(JsonRecord),
})

export const RuntimeProviderCatalog = Schema.Struct({
  defaultModel: Schema.NullOr(Schema.String),
  globalDefaultModel: Schema.NullOr(Schema.String),
  modelOptions: Schema.Array(RuntimeModelGroup),
  providers: Schema.Array(RuntimeProvider),
})

export class ProviderSettingsResponse extends Schema.Class<ProviderSettingsResponse>(
  "ProviderSettingsResponse",
)({
  catalog: RuntimeProviderCatalog,
  settings: ProviderSettingsSnapshot,
}) {}
