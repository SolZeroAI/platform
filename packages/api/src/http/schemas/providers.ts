import {
  ModelProviderOverrideSchema,
  ModelReasoningConfigSchema,
  OpenCodePermissionActionSchema,
  OpenCodePermissionSchema,
  ProviderModelDefinitionSchema,
  ProviderModelLimitSchema,
} from "@solzero/shared"
import { Schema } from "effect"
import { JsonRecord } from "./common"

// The provider contract reuses the shared provider schemas, so the API and the web app agree on
// reasoning efforts, interleaved reasoning, and permission rules.
export const ProviderModelLimit = ProviderModelLimitSchema
export const ModelReasoningConfig = ModelReasoningConfigSchema
export const ModelProviderOverride = ModelProviderOverrideSchema
export const ProviderModelDefinition = ProviderModelDefinitionSchema

export type ProviderModelDefinition = typeof ProviderModelDefinition.Type

export const OpenCodePermissionAction = OpenCodePermissionActionSchema
export const OpenCodePermission = OpenCodePermissionSchema

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
  reasoning: Schema.optionalKey(ModelReasoningConfig),
  providerApi: Schema.optionalKey(Schema.String),
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
  credentialSource: Schema.Literals([
    "binding",
    "shared",
    "user_override",
    "user_custom",
    "missing",
  ]),
  models: Schema.Array(RuntimeModelOption),
})

export const UserSharedProviderOverride = Schema.Struct({
  providerId: Schema.String,
  displayName: Schema.optionalKey(Schema.String),
  hasApiKey: Schema.Boolean,
})

export const UserCustomProviderSettings = Schema.Struct({
  providerId: Schema.String,
  name: Schema.String,
  npm: Schema.optionalKey(Schema.String),
  options: Schema.optionalKey(JsonRecord),
  models: Schema.Record(Schema.String, ProviderModelDefinition),
  hasApiKey: Schema.Boolean,
})

export const ProviderSettingsSnapshot = Schema.Struct({
  defaultModel: Schema.NullOr(Schema.String),
  defaultIsolateStepLimit: Schema.Number,
  opencodePermission: Schema.NullOr(OpenCodePermission),
  defaultOpenCodePermission: OpenCodePermission,
  sharedOverrides: Schema.Array(UserSharedProviderOverride),
  customProviders: Schema.Array(UserCustomProviderSettings),
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
