import { pipe } from "effect/Function"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { parseJson, stringifyJson } from "./json"

export const JsonObjectSchema = Schema.Record(Schema.String, Schema.Unknown)

export const ReasoningEffortSchema = Schema.Literals([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "minimal",
])
export type ReasoningEffort = typeof ReasoningEffortSchema.Type

export interface ModelReasoningConfig {
  efforts: readonly ReasoningEffort[]
  default?: ReasoningEffort
}

// oxlint-disable-next-line effect/prefer-schema-class -- plain-data DTO mirrors OpenCode provider model config
export const OpenCodeInterleavedReasoningSchema = Schema.Union([
  Schema.Literal(true),
  Schema.Struct({
    field: Schema.Literals(["reasoning_content", "reasoning_details"]),
  }),
])
export type OpenCodeInterleavedReasoning = typeof OpenCodeInterleavedReasoningSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- plain-data DTO consumed structurally (spread/satisfies/JSON config) across @solzero/api; a Schema.Class instance type would break those consumers
export const ModelReasoningConfigSchema = Schema.Struct({
  efforts: Schema.Array(ReasoningEffortSchema),
  default: Schema.optional(ReasoningEffortSchema),
})

// oxlint-disable-next-line effect/prefer-schema-class -- plain-data DTO consumed structurally (spread/satisfies/JSON config) across @solzero/api; a Schema.Class instance type would break those consumers
export const ModelProviderOverrideSchema = Schema.Struct({
  npm: Schema.optional(Schema.String),
  api: Schema.optional(Schema.String),
})
export type ModelProviderOverride = typeof ModelProviderOverrideSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- plain-data DTO consumed structurally (spread/satisfies/JSON config) across @solzero/api; a Schema.Class instance type would break those consumers
export const ProviderSecretRefSchema = Schema.Struct({
  kind: Schema.Literal("env"),
  name: Schema.String,
})
export type ProviderSecretRef = typeof ProviderSecretRefSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- plain-data DTO consumed structurally (spread/satisfies/JSON config) across @solzero/api; a Schema.Class instance type would break those consumers
export const ProviderModelLimitSchema = Schema.Struct({
  context: Schema.Number,
  output: Schema.Number,
})
export type ProviderModelLimit = typeof ProviderModelLimitSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- plain-data DTO consumed structurally (spread/satisfies/JSON config) across @solzero/api; a Schema.Class instance type would break those consumers
export const ProviderModelDefinitionSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  options: Schema.optional(JsonObjectSchema),
  limit: Schema.optional(ProviderModelLimitSchema),
  reasoning: Schema.optional(ModelReasoningConfigSchema),
  interleaved: Schema.optional(OpenCodeInterleavedReasoningSchema),
  provider: Schema.optional(ModelProviderOverrideSchema),
})
export type ProviderModelDefinition = typeof ProviderModelDefinitionSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- plain-data DTO consumed structurally (spread/satisfies/JSON config) across @solzero/api; a Schema.Class instance type would break those consumers
export const SharedProviderDefinitionSchema = Schema.Struct({
  providerId: Schema.String,
  name: Schema.String,
  npm: Schema.optional(Schema.String),
  options: Schema.optional(JsonObjectSchema),
  apiKey: Schema.optional(ProviderSecretRefSchema),
  models: Schema.Record(Schema.String, ProviderModelDefinitionSchema),
})
export type SharedProviderDefinition = typeof SharedProviderDefinitionSchema.Type

export const SharedProviderCatalogSchema = Schema.Array(SharedProviderDefinitionSchema)
export type SharedProviderCatalog = typeof SharedProviderCatalogSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- plain-data DTO consumed structurally (spread/satisfies/JSON config) across @solzero/api; a Schema.Class instance type would break those consumers
export const CompiledOpenCodeProviderModelSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  options: Schema.optional(JsonObjectSchema),
  limit: Schema.optional(ProviderModelLimitSchema),
  provider: Schema.optional(ModelProviderOverrideSchema),
  reasoning: Schema.optional(Schema.Boolean),
  interleaved: Schema.optional(OpenCodeInterleavedReasoningSchema),
})
export type CompiledOpenCodeProviderModel = typeof CompiledOpenCodeProviderModelSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- plain-data DTO consumed structurally (spread/satisfies/JSON config) across @solzero/api; a Schema.Class instance type would break those consumers
export const CompiledOpenCodeProviderSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  npm: Schema.optional(Schema.String),
  options: Schema.optional(JsonObjectSchema),
  models: Schema.optional(Schema.Record(Schema.String, CompiledOpenCodeProviderModelSchema)),
})
export type CompiledOpenCodeProvider = typeof CompiledOpenCodeProviderSchema.Type

export const OpenCodeMcpHeadersSchema = Schema.Record(Schema.String, Schema.String)
export type OpenCodeMcpHeaders = typeof OpenCodeMcpHeadersSchema.Type

export const OpenCodeMcpOAuthSchema = Schema.Union([
  Schema.Literal(false),
  // oxlint-disable-next-line effect/prefer-schema-class -- plain-data DTO consumed structurally (spread/satisfies/JSON config) across @solzero/api; a Schema.Class instance type would break those consumers
  Schema.Struct({
    clientId: Schema.optional(Schema.String),
    clientSecret: Schema.optional(Schema.String),
    scope: Schema.optional(Schema.String),
  }),
])
export type OpenCodeMcpOAuth = typeof OpenCodeMcpOAuthSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- plain-data DTO consumed structurally (spread/satisfies/JSON config) across @solzero/api; a Schema.Class instance type would break those consumers
export const OpenCodeRemoteMcpServerSchema = Schema.Struct({
  type: Schema.Literal("remote"),
  url: Schema.String,
  enabled: Schema.optional(Schema.Boolean),
  headers: Schema.optional(OpenCodeMcpHeadersSchema),
  oauth: Schema.optional(OpenCodeMcpOAuthSchema),
  timeout: Schema.optional(Schema.Number),
})
export type OpenCodeRemoteMcpServer = typeof OpenCodeRemoteMcpServerSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- plain-data DTO consumed structurally (spread/satisfies/JSON config) across @solzero/api; a Schema.Class instance type would break those consumers
export const OpenCodeLocalMcpServerSchema = Schema.Struct({
  type: Schema.Literal("local"),
  command: Schema.Array(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  environment: Schema.optional(OpenCodeMcpHeadersSchema),
  timeout: Schema.optional(Schema.Number),
})
export type OpenCodeLocalMcpServer = typeof OpenCodeLocalMcpServerSchema.Type

export const OpenCodeMcpServerSchema = Schema.Union([
  OpenCodeRemoteMcpServerSchema,
  OpenCodeLocalMcpServerSchema,
])
export type OpenCodeMcpServer = typeof OpenCodeMcpServerSchema.Type

export const OpenCodeMcpServersSchema = Schema.Record(Schema.String, OpenCodeMcpServerSchema)
export type OpenCodeMcpServers = typeof OpenCodeMcpServersSchema.Type

export const OpenCodePermissionActionSchema = Schema.Literals(["allow", "ask", "deny"])
export type OpenCodePermissionAction = typeof OpenCodePermissionActionSchema.Type

/**
 * OpenCode allows either a single action string or a nested rules object.
 * We keep the object branch permissive so runtime-generated config can express
 * tool-specific rules without mirroring the full upstream schema here.
 */
export const OpenCodePermissionSchema = Schema.Union([
  OpenCodePermissionActionSchema,
  JsonObjectSchema,
])
export type OpenCodePermission = typeof OpenCodePermissionSchema.Type

export const DEFAULT_OPENCODE_PERMISSION = {
  external_directory: {
    "/home/user/.config/opencode/**": "allow",
  },
} satisfies Record<string, unknown>

export function cloneDefaultOpenCodePermission(): OpenCodePermission {
  return normalizeOpenCodePermission(DEFAULT_OPENCODE_PERMISSION)
}

export function normalizeOpenCodePermission(input: unknown): OpenCodePermission {
  return Schema.decodeUnknownSync(OpenCodePermissionSchema)(input)
}

export function stringifyOpenCodePermission(input: OpenCodePermission): string {
  return stringifyJson(normalizeOpenCodePermission(input))
}

export function parseStoredOpenCodePermission(
  value: string | null | undefined,
): Option.Option<OpenCodePermission> {
  return pipe(
    Option.fromNullishOr(value),
    Option.filter((raw) => raw.length > 0),
    Option.map((raw) => normalizeOpenCodePermission(parseJson(raw))),
  )
}

// oxlint-disable-next-line effect/prefer-schema-class -- plain-data DTO consumed structurally (spread/satisfies/JSON config) across @solzero/api; a Schema.Class instance type would break those consumers
export const CompiledOpenCodeConfigSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  small_model: Schema.optional(Schema.String),
  enabled_providers: Schema.optional(Schema.Array(Schema.String)),
  provider: Schema.Record(Schema.String, CompiledOpenCodeProviderSchema),
  mcp: Schema.optional(OpenCodeMcpServersSchema),
  permission: Schema.optional(OpenCodePermissionSchema),
})
export type CompiledOpenCodeConfig = typeof CompiledOpenCodeConfigSchema.Type

function failMcpServerConfig(message: string): never {
  throw new Error(message)
}

const requireMcpServerText = (value: string, message: string): string =>
  value || failMcpServerConfig(message)

const requireMcpServerCommand = (command: readonly string[], message: string): readonly string[] =>
  Match.value(command.length).pipe(
    Match.when(0, () => failMcpServerConfig(message)),
    Match.orElse(() => command),
  )

export function normalizeOpenCodeMcpServers(input: unknown): OpenCodeMcpServers {
  const decoded = Schema.decodeUnknownSync(OpenCodeMcpServersSchema)(input ?? {})
  const normalizedEntries = Object.entries(decoded)
    .map(([rawName, server]) =>
      pipe(requireMcpServerText(rawName.trim(), "MCP server names must be non-empty"), (name) =>
        Match.value(server).pipe(
          Match.when(
            { type: "remote" },
            (remote) =>
              [
                name,
                {
                  ...remote,
                  url: requireMcpServerText(
                    remote.url.trim(),
                    `MCP server '${name}' requires a url`,
                  ),
                },
              ] as const,
          ),
          Match.orElse(
            (local) =>
              [
                name,
                {
                  ...local,
                  command: requireMcpServerCommand(
                    local.command.map((part) => part.trim()).filter(Boolean),
                    `MCP server '${name}' requires at least one command argument`,
                  ),
                },
              ] as const,
          ),
        ),
      ),
    )
    .sort(([left], [right]) => left.localeCompare(right))

  return Object.fromEntries(normalizedEntries)
}

export function stringifyOpenCodeMcpServers(input: OpenCodeMcpServers | null | undefined): string {
  return stringifyJson(normalizeOpenCodeMcpServers(input))
}

export function parseStoredOpenCodeMcpServers(
  value: string | null | undefined,
): OpenCodeMcpServers {
  return Option.match(Option.fromNullishOr(value), {
    onNone: (): OpenCodeMcpServers => ({}),
    onSome: (raw) => normalizeOpenCodeMcpServers(parseJson(raw)),
  })
}

export interface RuntimeProviderModelOption {
  id: string
  providerId: string
  providerName: string
  modelId: string
  name: string
  description: string
  reasoning?: ModelReasoningConfig
  providerApi?: string
}

export interface RuntimeModelCategory {
  category: string
  providerId: string
  models: RuntimeProviderModelOption[]
}

export interface RuntimeProviderCatalogEntry {
  providerId: string
  name: string
  npm?: string
  options?: Record<string, unknown>
  source: "shared" | "custom"
  hasApiKey: boolean
  globalCredentialConfigured: boolean
  credentialSource: "binding" | "shared" | "user_override" | "user_custom" | "missing"
  models: RuntimeProviderModelOption[]
}

export interface RuntimeProviderCatalog {
  defaultModel: string | null
  globalDefaultModel: string | null
  modelOptions: RuntimeModelCategory[]
  providers: RuntimeProviderCatalogEntry[]
}

export interface UserSharedProviderOverride {
  providerId: string
  displayName?: string
  hasApiKey: boolean
}

export interface SharedProviderOverrideUpdate {
  providerId: string
  displayName: string
  apiKey?: string
  clearApiKey?: boolean
}

export interface UserCustomProviderSettings {
  providerId: string
  name: string
  npm?: string
  options?: Record<string, unknown>
  models: Record<string, ProviderModelDefinition>
  hasApiKey: boolean
}

export interface UserCustomProviderUpdate {
  providerId: string
  name: string
  npm?: string
  options?: Record<string, unknown>
  models: Record<string, ProviderModelDefinition>
  apiKey?: string
  clearApiKey?: boolean
}

export interface ProviderSettingsSnapshot {
  defaultModel: string | null
  defaultIsolateStepLimit: number
  opencodePermission: OpenCodePermission | null
  defaultOpenCodePermission: OpenCodePermission
  sharedOverrides: UserSharedProviderOverride[]
  customProviders: UserCustomProviderSettings[]
}

export interface ProviderSettingsResponse {
  catalog: RuntimeProviderCatalog
  settings: ProviderSettingsSnapshot
}

export interface ProviderSettingsUpdatePayload {
  defaultModel: string | null
  defaultIsolateStepLimit?: number | null
  opencodePermission?: OpenCodePermission | null
  sharedOverrides: SharedProviderOverrideUpdate[]
  customProviders: UserCustomProviderUpdate[]
}

const RAW_SHARED_PROVIDER_CATALOG = [
  // OpenAI
  // https://developers.openai.com/api/docs/guides/reasoning
  // {
  //   providerId: "openai",
  //   name: "OpenAI",
  //   apiKey: {
  //     kind: "env",
  //     name: "OPENAI_API_KEY",
  //   },
  //   models: {
  //     "gpt-5.4": {
  //       name: "GPT 5.4",
  //       description: "Most capable",
  //       reasoning: {
  //         efforts: ["none", "low", "medium", "high", "xhigh"],
  //         default: "high",
  //       },
  //     },
  //     "gpt-5.4-mini": {
  //       name: "GPT 5.4 Mini",
  //       description: "Balanced performance",
  //       reasoning: {
  //         efforts: ["none", "low", "medium", "high", "xhigh"],
  //         default: "medium",
  //       },
  //     },
  //     "gpt-5.4-nano": {
  //       name: "GPT 5.4 Nano",
  //       description: "Lightweight performance",
  //       reasoning: {
  //         efforts: ["none", "low", "medium", "high", "xhigh"],
  //         default: "low",
  //       },
  //     },
  //   },
  // },
  // {
  //   providerId: "anthropic",
  //   name: "Anthropic",
  //   apiKey: {
  //     kind: "env",
  //     name: "ANTHROPIC_API_KEY",
  //   },
  //   models: {
  //     "claude-sonnet-4-6": {
  //       name: "Claude Sonnet 4.6",
  //       description: "Balanced performance",
  //       reasoning: {
  //         efforts: ["high", "max"],
  //         default: "high",
  //       },
  //     },
  //     "claude-opus-4-6": {
  //       name: "Claude Opus 4.6",
  //       description: "Latest Opus model",
  //       reasoning: {
  //         efforts: ["high", "max"],
  //         default: "max",
  //       },
  //     },
  //   },
  // },
] satisfies SharedProviderCatalog

export const SHARED_PROVIDER_CATALOG = Schema.decodeUnknownSync(SharedProviderCatalogSchema)(
  RAW_SHARED_PROVIDER_CATALOG,
)

export function buildModelId(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}

export function splitModelId(modelId: string): {
  providerId: string
  modelId: string
} {
  const [providerId, ...rest] = modelId.split("/")
  return Match.value(Boolean(providerId) && rest.length > 0).pipe(
    Match.when(true, () => ({
      providerId,
      modelId: rest.join("/"),
    })),
    Match.orElse(() => ({
      providerId: "anthropic",
      modelId,
    })),
  )
}

export function buildRuntimeModelOptions(
  providers: ReadonlyArray<{
    providerId: string
    name: string
    models: Record<string, ProviderModelDefinition>
  }>,
): RuntimeModelCategory[] {
  return providers.map((provider) => ({
    category: provider.name,
    providerId: provider.providerId,
    models: Object.entries(provider.models).map(([modelId, model]) => ({
      id: buildModelId(provider.providerId, modelId),
      providerId: provider.providerId,
      providerName: provider.name,
      modelId,
      name: model.name,
      description: model.description ?? "",
      reasoning: model.reasoning,
      providerApi: model.provider?.api,
    })),
  }))
}

export function getModelReasoningConfig(
  providers: ReadonlyArray<{
    providerId: string
    models: Record<string, ProviderModelDefinition>
  }>,
  runtimeModelId: string,
): Option.Option<ModelReasoningConfig> {
  const { providerId, modelId } = splitModelId(runtimeModelId)
  const provider = providers.find((item) => item.providerId === providerId)
  return Option.fromNullishOr(provider?.models[modelId]?.reasoning)
}

export function findModelDisplayName(
  providers: ReadonlyArray<{
    providerId: string
    models: Record<string, ProviderModelDefinition>
  }>,
  runtimeModelId: string,
): Option.Option<string> {
  const { providerId, modelId } = splitModelId(runtimeModelId)
  const provider = providers.find((item) => item.providerId === providerId)
  return Option.fromNullishOr(provider?.models[modelId]?.name)
}
