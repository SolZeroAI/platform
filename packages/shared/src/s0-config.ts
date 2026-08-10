/* oxlint-disable s0-lint/avoid-untagged-errors, s0-lint/no-if-statement, s0-lint/no-return-in-arrow, s0-lint/no-ternary, s0-lint/prefer-option-over-null, effect/avoid-direct-json -- JSONC compilation is a synchronous deployment boundary; explicit validation keeps configuration failures path-specific. */
import * as Schema from "effect/Schema"
import { AdminConfigSchema, normalizeAdminConfig, type AdminConfig } from "./admin"
import {
  AuthProviderRegistrySchema,
  normalizeAuthProviderRegistry,
  type AuthProviderRegistry,
} from "./auth"
import {
  ProviderModelDefinitionSchema,
  ReasoningEffortSchema,
  type ProviderModelDefinition,
} from "./provider-config"
import {
  normalizeSecretReference,
  SecretReferenceSchema,
  type SecretReference,
} from "./secret-reference"

export const S0_CONFIG_SCHEMA_VERSION = 1 as const
export const S0_CONFIG_STAGE_NAMES = ["dev", "test", "pre", "prod"] as const
export type S0ConfigStageName = (typeof S0_CONFIG_STAGE_NAMES)[number]

const SamplingRateSchema = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))

// oxlint-disable-next-line effect/prefer-schema-class -- root deployment configuration is a plain JSON DTO
export const S0DeploymentConfigSchema = Schema.Struct({
  appName: Schema.String,
  zone: Schema.String,
  webFqdn: Schema.optional(Schema.String),
  apiFqdn: Schema.optional(Schema.String),
  useApiShield: Schema.Boolean,
  observability: Schema.Struct({
    logsDestinations: Schema.Array(Schema.String),
    tracesDestinations: Schema.Array(Schema.String),
    logsHeadSamplingRate: SamplingRateSchema,
    tracesHeadSamplingRate: SamplingRateSchema,
  }),
})
export type S0DeploymentConfig = typeof S0DeploymentConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- application configuration is a plain JSON DTO
export const S0ApplicationConfigSchema = Schema.Struct({
  logLevel: Schema.Literals(["trace", "debug"]),
  sendSlackNotifications: Schema.Boolean,
  slackChannel: Schema.String,
  sandboxInactivityTimeoutMs: Schema.Number,
  showTestErrorButton: Schema.Boolean,
  betterAuthSessionTransferEnabled: Schema.Boolean,
})
export type S0ApplicationConfig = typeof S0ApplicationConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- runtime bootstrap configuration mirrors the existing KV record without persistence metadata
export const S0LitellmConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  baseUrl: Schema.String,
  defaultModel: Schema.NullOr(Schema.String),
  defaultReasoningLevel: Schema.NullOr(ReasoningEffortSchema),
  adapterOverrides: Schema.Record(Schema.String, Schema.String),
  apiKey: Schema.optional(SecretReferenceSchema),
})
export type S0LitellmConfig = typeof S0LitellmConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- deployment-managed AI Gateway configuration is a plain JSON DTO
export const S0CloudflareAiGatewayConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  cacheTtl: Schema.NullOr(Schema.Number),
  collectLogs: Schema.Boolean,
  defaultModel: Schema.String,
  models: Schema.Record(Schema.String, ProviderModelDefinitionSchema),
  providerKeys: Schema.optional(
    Schema.Struct({
      openai: Schema.optional(SecretReferenceSchema),
      anthropic: Schema.optional(SecretReferenceSchema),
      xai: Schema.optional(SecretReferenceSchema),
    }),
  ),
})
export type S0CloudflareAiGatewayConfig = typeof S0CloudflareAiGatewayConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- runtime bootstrap configuration mirrors the existing KV record without persistence metadata
export const S0McpcfConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  baseUrl: Schema.String,
  userOauthProviderId: Schema.String,
  expectedIssuer: Schema.NullOr(Schema.String),
  authTypeAllowlist: Schema.Array(Schema.String),
  serverBlacklist: Schema.Array(Schema.String),
  adminApiToken: Schema.optional(SecretReferenceSchema),
})
export type S0McpcfConfig = typeof S0McpcfConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- integration configuration is a plain JSON DTO
export const S0GitHubAppConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  appId: Schema.String,
  clientId: Schema.String,
  slug: Schema.String,
  clientSecret: SecretReferenceSchema,
  privateKey: SecretReferenceSchema,
  webhookSecret: Schema.optional(SecretReferenceSchema),
})
export type S0GitHubAppConfig = typeof S0GitHubAppConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- integration configuration is a plain JSON DTO
export const S0SlackConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  botToken: SecretReferenceSchema,
})
export type S0SlackConfig = typeof S0SlackConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- internal secret declarations are references, never secret values
export const S0SecurityConfigSchema = Schema.Struct({
  betterAuthSecret: SecretReferenceSchema,
  mcpcfProxySigningSecret: SecretReferenceSchema,
  tokenEncryptionKey: SecretReferenceSchema,
  repositorySecretsEncryptionKey: SecretReferenceSchema,
})
export type S0SecurityConfig = typeof S0SecurityConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- auth deployment config combines the public provider registry with its credential secret declaration
export const S0AuthConfigSchema = Schema.Struct({
  defaultSignInProviderId: Schema.String,
  providers: AuthProviderRegistrySchema.fields.providers,
  adminPassword: Schema.optional(SecretReferenceSchema),
})
export type S0AuthConfig = typeof S0AuthConfigSchema.Type

const S0ResolvedConfigFields = {
  schemaVersion: Schema.Literal(S0_CONFIG_SCHEMA_VERSION),
  deployment: S0DeploymentConfigSchema,
  application: S0ApplicationConfigSchema,
  admins: AdminConfigSchema,
  auth: S0AuthConfigSchema,
  aiProviders: Schema.Struct({
    cloudflareAiGateway: S0CloudflareAiGatewayConfigSchema,
    litellm: Schema.optional(S0LitellmConfigSchema),
  }),
  mcpcf: Schema.optional(S0McpcfConfigSchema),
  integrations: Schema.Struct({
    githubApp: S0GitHubAppConfigSchema,
    slack: S0SlackConfigSchema,
  }),
  security: S0SecurityConfigSchema,
  aiSearch: Schema.Struct({
    serviceTokenId: Schema.optional(Schema.NullOr(SecretReferenceSchema)),
  }),
} as const

// oxlint-disable-next-line effect/prefer-schema-class -- resolved deployment config crosses infra and Worker JSON boundaries
export const S0ResolvedConfigSchema = Schema.Struct(S0ResolvedConfigFields)
export type S0ResolvedConfig = typeof S0ResolvedConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- external JSONC is decoded to a plain DTO used by infra and Worker bindings
export const S0ConfigFileSchema = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  ...S0ResolvedConfigFields,
})
export type S0ConfigFile = typeof S0ConfigFileSchema.Type

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function s0ConfigStageForStage(stage: string): S0ConfigStageName {
  const normalized = stage.trim().toLowerCase()
  if (normalized === "prod") return "prod"
  if (normalized === "test") return "test"
  if (normalized === "pre" || normalized.startsWith("pre-")) return "pre"
  if (normalized === "dev") return "dev"
  throw new Error(
    `Invalid stage '${stage}' for s0 config file selection. Expected dev, test, pre, pre-*, or prod`,
  )
}

export function s0ConfigFileNameForStage(stage: string): string {
  return `${s0ConfigStageForStage(stage)}.config.jsonc`
}

export function s0ConfigPathForStage(stage: string): string {
  return `config/${s0ConfigFileNameForStage(stage)}`
}

function normalizeTextArray(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort()
}

function normalizeOptionalUrl(value: string | null | undefined, path: string): string | null {
  const normalized = value?.trim() ?? ""
  if (!normalized) return null
  try {
    return new URL(normalized).toString().replace(/\/+$/, "")
  } catch {
    throw new Error(`Invalid s0 configuration: ${path} must be a valid URL`)
  }
}

function normalizeCloudflareAiGatewayConfig(
  config: S0CloudflareAiGatewayConfig,
): S0CloudflareAiGatewayConfig {
  if (config.cacheTtl !== null && (!Number.isFinite(config.cacheTtl) || config.cacheTtl <= 0)) {
    throw new Error(
      "Invalid c0 configuration: aiProviders.cloudflareAiGateway.cacheTtl must be null or a positive number of seconds",
    )
  }

  const models: Record<string, ProviderModelDefinition> = {}
  for (const [rawModelId, model] of Object.entries(config.models)) {
    const modelId = rawModelId.trim()
    if (!modelId) {
      throw new Error(
        "Invalid c0 configuration: aiProviders.cloudflareAiGateway model ids must be non-empty",
      )
    }
    if (models[modelId]) {
      throw new Error(
        `Invalid c0 configuration: duplicate aiProviders.cloudflareAiGateway model '${modelId}'`,
      )
    }
    models[modelId] = {
      ...model,
      name: model.name.trim(),
      ...(model.description === undefined ? {} : { description: model.description.trim() }),
    }
  }

  const defaultModel = config.defaultModel.trim()
  if (config.enabled && Object.keys(models).length === 0) {
    throw new Error(
      "Invalid c0 configuration: enabled aiProviders.cloudflareAiGateway requires at least one model",
    )
  }
  if (config.enabled && !defaultModel) {
    throw new Error(
      "Invalid c0 configuration: enabled aiProviders.cloudflareAiGateway requires a defaultModel",
    )
  }
  if (defaultModel && !models[defaultModel]) {
    throw new Error(
      `Invalid c0 configuration: aiProviders.cloudflareAiGateway.defaultModel '${defaultModel}' is not in models`,
    )
  }

  return {
    ...config,
    defaultModel,
    models,
  }
}

function validateGitHubAppAuthProvider(
  auth: AuthProviderRegistry,
  githubApp: S0GitHubAppConfig,
): void {
  if (!githubApp.enabled) return

  const provider = auth.providers.github
  if (!provider) {
    throw new Error(
      "Invalid s0 configuration: enabled integrations.githubApp requires auth.providers.github",
    )
  }
  if (provider.kind !== "social" || !provider.enabled) {
    throw new Error(
      "Invalid s0 configuration: auth.providers.github must be an enabled social provider when integrations.githubApp is enabled",
    )
  }
  if (!provider.capabilities.link) {
    throw new Error(
      "Invalid s0 configuration: auth.providers.github must allow explicit account linking when integrations.githubApp is enabled",
    )
  }
  if (provider.clientId !== githubApp.clientId) {
    throw new Error(
      "Invalid s0 configuration: auth.providers.github.clientId must match integrations.githubApp.clientId",
    )
  }
  if (provider.clientSecret.env !== githubApp.clientSecret.env) {
    throw new Error(
      "Invalid s0 configuration: auth.providers.github.clientSecret.env must match integrations.githubApp.clientSecret.env",
    )
  }
}

function normalizeResolvedConfig(decoded: S0ResolvedConfig): S0ResolvedConfig {
  const githubApp: S0GitHubAppConfig = {
    ...decoded.integrations.githubApp,
    appId: decoded.integrations.githubApp.appId.trim(),
    clientId: decoded.integrations.githubApp.clientId.trim(),
    slug: decoded.integrations.githubApp.slug.trim(),
    clientSecret: normalizeSecretReference(
      decoded.integrations.githubApp.clientSecret,
      "integrations.githubApp.clientSecret",
    ),
    privateKey: normalizeSecretReference(
      decoded.integrations.githubApp.privateKey,
      "integrations.githubApp.privateKey",
    ),
    ...(decoded.integrations.githubApp.webhookSecret
      ? {
          webhookSecret: normalizeSecretReference(
            decoded.integrations.githubApp.webhookSecret,
            "integrations.githubApp.webhookSecret",
          ),
        }
      : {}),
  }
  const slack = decoded.integrations.slack
  const cloudflareAiGateway = normalizeCloudflareAiGatewayConfig(
    decoded.aiProviders.cloudflareAiGateway,
  )
  const litellm = decoded.aiProviders.litellm
  const mcpcf = decoded.mcpcf
  const security = decoded.security
  const auth = normalizeAuthProviderRegistry(decoded.auth)
  validateGitHubAppAuthProvider(auth, githubApp)
  const credentialSignInEnabled = Object.values(auth.providers).some(
    (provider) =>
      provider.kind === "credential" && provider.enabled && provider.capabilities.signIn,
  )
  const adminPassword = decoded.auth.adminPassword
    ? normalizeSecretReference(decoded.auth.adminPassword, "auth.adminPassword")
    : undefined
  if (credentialSignInEnabled && !adminPassword) {
    throw new Error(
      "Invalid s0 configuration: auth.adminPassword is required when credential sign-in is enabled",
    )
  }
  const normalized: S0ResolvedConfig = {
    ...decoded,
    deployment: {
      ...decoded.deployment,
      appName: decoded.deployment.appName.trim(),
      zone: decoded.deployment.zone.trim(),
      ...(decoded.deployment.webFqdn === undefined
        ? {}
        : { webFqdn: decoded.deployment.webFqdn.trim() }),
      ...(decoded.deployment.apiFqdn === undefined
        ? {}
        : { apiFqdn: decoded.deployment.apiFqdn.trim() }),
      observability: {
        ...decoded.deployment.observability,
        logsDestinations: normalizeTextArray(decoded.deployment.observability.logsDestinations),
        tracesDestinations: normalizeTextArray(decoded.deployment.observability.tracesDestinations),
      },
    },
    application: {
      ...decoded.application,
      slackChannel: decoded.application.slackChannel.trim(),
    },
    admins: normalizeAdminConfig(decoded.admins),
    auth: {
      ...auth,
      ...(adminPassword ? { adminPassword } : {}),
    },
    aiProviders: {
      cloudflareAiGateway,
      ...(litellm
        ? {
            litellm: {
              ...litellm,
              baseUrl: normalizeOptionalUrl(litellm.baseUrl, "aiProviders.litellm.baseUrl") ?? "",
              ...(litellm.apiKey
                ? {
                    apiKey: normalizeSecretReference(litellm.apiKey, "aiProviders.litellm.apiKey"),
                  }
                : {}),
            },
          }
        : {}),
    },
    ...(mcpcf
      ? {
          mcpcf: {
            ...mcpcf,
            baseUrl: normalizeOptionalUrl(mcpcf.baseUrl, "mcpcf.baseUrl") ?? "",
            expectedIssuer: normalizeOptionalUrl(mcpcf.expectedIssuer, "mcpcf.expectedIssuer"),
            authTypeAllowlist: normalizeTextArray(mcpcf.authTypeAllowlist).map((value) =>
              value.toLowerCase(),
            ),
            serverBlacklist: normalizeTextArray(mcpcf.serverBlacklist),
            ...(mcpcf.adminApiToken
              ? {
                  adminApiToken: normalizeSecretReference(
                    mcpcf.adminApiToken,
                    "mcpcf.adminApiToken",
                  ),
                }
              : {}),
          },
        }
      : {}),
    integrations: {
      githubApp,
      slack: {
        ...slack,
        botToken: normalizeSecretReference(slack.botToken, "integrations.slack.botToken"),
      },
    },
    security: {
      betterAuthSecret: normalizeSecretReference(
        security.betterAuthSecret,
        "security.betterAuthSecret",
      ),
      mcpcfProxySigningSecret: normalizeSecretReference(
        security.mcpcfProxySigningSecret,
        "security.mcpcfProxySigningSecret",
      ),
      tokenEncryptionKey: normalizeSecretReference(
        security.tokenEncryptionKey,
        "security.tokenEncryptionKey",
      ),
      repositorySecretsEncryptionKey: normalizeSecretReference(
        security.repositorySecretsEncryptionKey,
        "security.repositorySecretsEncryptionKey",
      ),
    },
    aiSearch: decoded.aiSearch.serviceTokenId
      ? {
          serviceTokenId: normalizeSecretReference(
            decoded.aiSearch.serviceTokenId,
            "aiSearch.serviceTokenId",
          ),
        }
      : {},
  }
  if (!normalized.deployment.appName) {
    throw new Error("Invalid s0 configuration: deployment.appName must not be empty")
  }
  if (!normalized.deployment.zone) {
    throw new Error("Invalid s0 configuration: deployment.zone must not be empty")
  }
  if (normalized.application.sandboxInactivityTimeoutMs <= 0) {
    throw new Error(
      "Invalid s0 configuration: application.sandboxInactivityTimeoutMs must be positive",
    )
  }
  return normalized
}

export function resolveS0Config(value: unknown): S0ResolvedConfig {
  const decoded = Schema.decodeUnknownSync(S0ConfigFileSchema)(value)
  const { $schema: _schema, ...config } = decoded
  return normalizeResolvedConfig(Schema.decodeUnknownSync(S0ResolvedConfigSchema)(config))
}

function sortForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForCanonicalJson)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortForCanonicalJson(value[key])]),
  )
}

export function canonicalS0ConfigJson(config: S0ResolvedConfig): string {
  return JSON.stringify(sortForCanonicalJson(config))
}

export function s0ConfigSecretReferences(config: S0ResolvedConfig): SecretReference[] {
  const authProviderSecrets = Object.values(config.auth.providers).flatMap((provider) =>
    provider.kind === "credential" ? [] : [provider.clientSecret],
  )
  return [
    ...authProviderSecrets,
    ...(config.aiProviders.litellm?.apiKey ? [config.aiProviders.litellm.apiKey] : []),
    ...(config.mcpcf?.adminApiToken ? [config.mcpcf.adminApiToken] : []),
    config.integrations.githubApp.clientSecret,
    config.integrations.githubApp.privateKey,
    ...(config.integrations.githubApp.webhookSecret
      ? [config.integrations.githubApp.webhookSecret]
      : []),
    config.integrations.slack.botToken,
    ...(config.auth.adminPassword ? [config.auth.adminPassword] : []),
    config.security.betterAuthSecret,
    config.security.mcpcfProxySigningSecret,
    config.security.tokenEncryptionKey,
    config.security.repositorySecretsEncryptionKey,
    ...(config.aiSearch.serviceTokenId ? [config.aiSearch.serviceTokenId] : []),
  ]
}

export function s0RuntimeSecretReferences(config: S0ResolvedConfig): SecretReference[] {
  const credentialSignInEnabled = Object.values(config.auth.providers).some(
    (provider) =>
      provider.kind === "credential" && provider.enabled && provider.capabilities.signIn,
  )
  const authProviderSecrets = Object.values(config.auth.providers).flatMap((provider) =>
    provider.kind !== "credential" && provider.enabled ? [provider.clientSecret] : [],
  )
  return [
    ...authProviderSecrets,
    ...(credentialSignInEnabled && config.auth.adminPassword ? [config.auth.adminPassword] : []),
    ...(config.aiProviders.litellm?.enabled && config.aiProviders.litellm.apiKey
      ? [config.aiProviders.litellm.apiKey]
      : []),
    ...(config.mcpcf?.enabled && config.mcpcf.adminApiToken ? [config.mcpcf.adminApiToken] : []),
  ]
}

export function s0ActiveSecretReferences(config: S0ResolvedConfig): SecretReference[] {
  const githubApp = config.integrations.githubApp
  const cloudflareAiGatewayProviderKeys = config.aiProviders.cloudflareAiGateway.enabled
    ? Object.values(config.aiProviders.cloudflareAiGateway.providerKeys ?? {})
    : []
  return [
    ...s0RuntimeSecretReferences(config),
    ...cloudflareAiGatewayProviderKeys,
    ...(githubApp.enabled
      ? [
          githubApp.clientSecret,
          githubApp.privateKey,
          ...(githubApp.webhookSecret ? [githubApp.webhookSecret] : []),
        ]
      : []),
    ...(config.integrations.slack.enabled ? [config.integrations.slack.botToken] : []),
    config.security.betterAuthSecret,
    config.security.mcpcfProxySigningSecret,
    config.security.tokenEncryptionKey,
    config.security.repositorySecretsEncryptionKey,
    ...(config.aiSearch.serviceTokenId ? [config.aiSearch.serviceTokenId] : []),
  ]
}

export interface S0RuntimeBootstrapBindings {
  readonly S0_CONFIG_ADMIN: AdminConfig
  readonly S0_CONFIG_AUTH: S0AuthConfig
  readonly S0_CONFIG_CLOUDFLARE_AI_GATEWAY: S0CloudflareAiGatewayConfig
  readonly S0_CONFIG_LITELLM?: S0LitellmConfig
  readonly S0_CONFIG_MCPCF?: S0McpcfConfig
  readonly S0_DEPLOYMENT_CONFIG_DIGEST: string
}
