import {
  buildModelId,
  buildRuntimeModelOptions,
  cloneDefaultOpenCodePermission,
  CompiledOpenCodeConfigSchema,
  DEFAULT_ISOLATE_STEP_LIMIT,
  JsonObjectSchema,
  normalizeOpenCodePermission,
  normalizeIsolateStepLimit,
  normalizeOpenCodeMcpServers,
  normalizeModelId,
  OpenCodePermissionSchema,
  ProviderModelDefinitionSchema,
  SHARED_PROVIDER_CATALOG,
  type CompiledOpenCodeConfig,
  type CompiledOpenCodeProviderModel,
  type OpenCodeInterleavedReasoning,
  type OpenCodeMcpServers,
  type OpenCodePermission,
  type ProviderModelDefinition,
  type ProviderSettingsResponse,
  type RuntimeProviderCatalog,
  type RuntimeProviderCatalogEntry,
  type SharedProviderDefinition,
  type UserCustomProviderSettings,
} from "@solzero/shared"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { Env } from "./types"
import {
  buildCloudflareAiGatewayCatalogProvider,
  CLOUDFLARE_AI_GATEWAY_PROVIDER_ID,
} from "./ai-providers/cloudflare-ai-gateway"
import {
  createUserProviderConfigsStoreFromD1,
  type RuntimeUserProviderRecord,
  type UserProviderConfigsStorePromise,
  type UserProviderCustomInput,
  type UserProviderSettingsSnapshot,
  type UserProviderSettingsUpdate,
  type UserProviderSharedOverrideInput,
} from "./db/user-provider-configs"
import { buildLitellmCatalogProviders, getLitellmConfigWithPresence } from "./ai-providers/litellm"
import { INTERNAL_AI_SEARCH_MCP_SERVER_NAME } from "./session/mcp-config"

type SharedOverrideInput = {
  providerId: string
  displayName: string
  apiKey?: string
  clearApiKey?: boolean
}

type CustomProviderInput = {
  providerId: string
  name: string
  npm?: string
  options?: Record<string, unknown>
  models: Record<string, ProviderModelDefinition>
  apiKey?: string
  clearApiKey?: boolean
}

class SharedOverrideInputSchema extends Schema.Class<SharedOverrideInputSchema>(
  "SharedOverrideInput",
)({
  providerId: Schema.String,
  displayName: Schema.String,
  apiKey: Schema.optional(Schema.String),
  clearApiKey: Schema.optional(Schema.Boolean),
}) {}

class CustomProviderInputSchema extends Schema.Class<CustomProviderInputSchema>(
  "CustomProviderInput",
)({
  providerId: Schema.String,
  name: Schema.String,
  npm: Schema.optional(Schema.String),
  options: Schema.optional(JsonObjectSchema),
  models: Schema.Record(Schema.String, ProviderModelDefinitionSchema),
  apiKey: Schema.optional(Schema.String),
  clearApiKey: Schema.optional(Schema.Boolean),
}) {}

class ProviderSettingsUpdateSchema extends Schema.Class<ProviderSettingsUpdateSchema>(
  "ProviderSettingsUpdate",
)({
  defaultModel: Schema.Union([Schema.String, Schema.Null]),
  defaultIsolateStepLimit: Schema.optional(Schema.Union([Schema.Number, Schema.Null])),
  opencodePermission: Schema.optional(Schema.Union([OpenCodePermissionSchema, Schema.Null])),
  sharedOverrides: Schema.Array(SharedOverrideInputSchema),
  customProviders: Schema.Array(CustomProviderInputSchema),
}) {}

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
export const OPENCODE_SHARED_PROVIDER_CREDENTIAL_PROXY_API_KEY = "s0-shared-provider-outbound-proxy"

type SharedProviderCatalogEntry = (typeof SHARED_PROVIDER_CATALOG)[number]
type SharedProviderCredentialMode = "direct" | "opencode_proxy"

interface ResolvedProviderRecord {
  providerId: string
  name: string
  npm?: string
  options?: Record<string, unknown>
  models: Record<string, ProviderModelDefinition>
  source: "shared" | "custom"
  apiKey: string | null
  globalCredentialConfigured: boolean
  credentialSource: "binding" | "shared" | "user_override" | "user_custom" | "missing"
}

interface SharedProviderBuildResult {
  providers: ResolvedProviderRecord[]
  configuredDefaultModel: string | null
}

/** Asserts `condition`, throwing `message` when it does not hold. */
function assertCondition(condition: boolean, message: string): void {
  Option.getOrThrowWith(
    Option.liftPredicate(condition, (value) => value === true),
    () => new Error(message),
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function trimmedNonEmpty(value: unknown): Option.Option<string> {
  return Option.fromNullishOr(value).pipe(
    Option.filter(isNonEmptyString),
    Option.map((raw) => raw.trim()),
  )
}

export function parseProviderSettingsUpdate(value: unknown): UserProviderSettingsUpdate {
  const parsed = Schema.decodeUnknownSync(ProviderSettingsUpdateSchema)(value)
  const sharedProviderIds = new Set([
    ...SHARED_PROVIDER_CATALOG.map((provider) => provider.providerId),
    CLOUDFLARE_AI_GATEWAY_PROVIDER_ID,
  ])

  const seenSharedProviderIds = new Set<string>()
  const sharedOverrides = Arr.map(parsed.sharedOverrides as SharedOverrideInput[], (rawOverride) =>
    normalizeSharedOverride(rawOverride, sharedProviderIds, seenSharedProviderIds),
  )

  const seenCustomProviderIds = new Set<string>()
  const customProviders = Arr.map(parsed.customProviders as CustomProviderInput[], (rawProvider) =>
    normalizeCustomProvider(rawProvider, sharedProviderIds, seenCustomProviderIds),
  )

  return {
    defaultModel: Option.getOrNull(normalizeOptionalString(parsed.defaultModel ?? null)),
    defaultIsolateStepLimit: normalizeIsolateStepLimit(
      parsed.defaultIsolateStepLimit,
      DEFAULT_ISOLATE_STEP_LIMIT,
    ),
    opencodePermission: Option.getOrNull(
      normalizeOptionalOpenCodePermission(parsed.opencodePermission),
    ),
    sharedOverrides,
    customProviders,
  }
}

function normalizeSharedOverride(
  rawOverride: SharedOverrideInput,
  sharedProviderIds: ReadonlySet<string>,
  seenSharedProviderIds: Set<string>,
): UserProviderSharedOverrideInput {
  const providerId = normalizeProviderId(rawOverride.providerId)
  assertCondition(sharedProviderIds.has(providerId), `Unknown shared provider '${providerId}'`)
  assertCondition(
    providerId !== CLOUDFLARE_AI_GATEWAY_PROVIDER_ID,
    `Shared provider '${providerId}' uses a Worker binding and does not accept personal API keys`,
  )
  assertCondition(
    !seenSharedProviderIds.has(providerId),
    `Duplicate shared provider override '${providerId}'`,
  )
  seenSharedProviderIds.add(providerId)
  return {
    providerId,
    displayName: rawOverride.displayName.trim() || providerId,
    apiKey: Option.getOrUndefined(normalizeOptionalSecret(rawOverride.apiKey)),
    clearApiKey: rawOverride.clearApiKey === true,
  }
}

function normalizeCustomProvider(
  rawProvider: CustomProviderInput,
  sharedProviderIds: ReadonlySet<string>,
  seenCustomProviderIds: Set<string>,
): UserProviderCustomInput {
  const providerId = normalizeProviderId(rawProvider.providerId)
  assertCondition(
    !sharedProviderIds.has(providerId),
    `Custom provider '${providerId}' conflicts with a shared provider`,
  )
  assertCondition(
    !seenCustomProviderIds.has(providerId),
    `Duplicate custom provider '${providerId}'`,
  )
  seenCustomProviderIds.add(providerId)

  const name = rawProvider.name.trim()
  assertCondition(name.length > 0, `Provider '${providerId}' must include a display name`)
  assertCondition(
    Object.keys(rawProvider.models).length > 0,
    `Provider '${providerId}' must define at least one model`,
  )

  return {
    providerId,
    name,
    npm: Option.getOrUndefined(normalizeOptionalString(rawProvider.npm)),
    options: rawProvider.options,
    models: rawProvider.models,
    apiKey: Option.getOrUndefined(normalizeOptionalSecret(rawProvider.apiKey)),
    clearApiKey: rawProvider.clearApiKey === true,
  }
}

export async function buildProviderSettingsResponse(
  env: Env,
  userId: string,
): Promise<ProviderSettingsResponse> {
  const settings = await getUserProviderSettingsSnapshot(env, userId)
  const catalog = await buildRuntimeProviderCatalog(env, userId)
  return {
    catalog,
    settings,
  }
}

export async function buildRuntimeProviderCatalog(
  env: Env,
  userId: string,
): Promise<RuntimeProviderCatalog> {
  const mergedSnapshot = await getMergedProviderSnapshot(env, userId)
  const mergedProviders = mergedSnapshot.providers
  const availableProviders = mergedProviders.filter(isProviderAvailable)
  const modelOptions = buildRuntimeModelOptions(availableProviders)
  const globalModelIds = buildRuntimeModelOptions(
    mergedProviders.filter(
      (provider) => provider.source === "shared" && provider.globalCredentialConfigured,
    ),
  ).flatMap((group) => group.models.map((model) => model.id))
  const globalDefaultModel = Option.getOrNull(
    resolveCatalogDefaultModel(globalModelIds, null, mergedSnapshot.configuredDefaultModel),
  )
  const defaultModel = Option.getOrNull(
    resolveCatalogDefaultModel(
      modelOptions.flatMap((group) => group.models.map((model) => model.id)),
      await getUserDefaultModel(env, userId),
      mergedSnapshot.configuredDefaultModel,
    ),
  )

  const providers: RuntimeProviderCatalogEntry[] = mergedProviders.map((provider) => ({
    providerId: provider.providerId,
    name: provider.name,
    npm: provider.npm,
    options: provider.options,
    source: provider.source,
    hasApiKey: Boolean(provider.apiKey),
    globalCredentialConfigured: provider.globalCredentialConfigured,
    credentialSource: provider.credentialSource,
    models: buildRuntimeModelOptions([provider])[0]?.models ?? [],
  }))

  return {
    defaultModel,
    globalDefaultModel,
    modelOptions,
    providers,
  }
}

export async function compileOpenCodeConfigForModel(
  env: Env,
  userId: string,
  requestedModel: string,
  options?: {
    mcp?: OpenCodeMcpServers
    sharedProviderCredentialMode?: SharedProviderCredentialMode
  },
): Promise<{
  runtimeModelId: string
  providerId: string
  modelId: string
  config: CompiledOpenCodeConfig
}> {
  const mergedProviders = (await getMergedProviderSnapshot(env, userId)).providers
  const credentialMode = options?.sharedProviderCredentialMode ?? "opencode_proxy"
  const availableProviders = mergedProviders.filter(isProviderAvailable)
  const visibleModelIds = availableProviders.flatMap((provider) =>
    Object.keys(provider.models).map((modelId) => buildModelId(provider.providerId, modelId)),
  )

  const runtimeModelId = normalizeModelId(requestedModel)
  assertCondition(
    visibleModelIds.includes(runtimeModelId),
    `Model '${runtimeModelId}' is not configured for this user`,
  )

  const { providerId, modelId } = splitRuntimeModelId(runtimeModelId)
  const provider = availableProviders.find((item) => item.providerId === providerId)
  const resolvedProvider = Option.fromNullishOr(provider).pipe(Option.filter(isProviderAvailable))
  assertCondition(
    Option.isSome(resolvedProvider),
    `Provider '${providerId}' does not have runtime credentials configured`,
  )

  const normalizedMcp = Option.getOrUndefined(
    Option.map(Option.fromNullishOr(options?.mcp), (mcp) => normalizeOpenCodeMcpServers(mcp)),
  )
  const hasAiSearchMcp =
    normalizedMcp !== undefined && INTERNAL_AI_SEARCH_MCP_SERVER_NAME in normalizedMcp
  const userOpenCodePermission = await getUserOpenCodePermission(env, userId)
  const permission = Option.getOrUndefined(
    buildOpenCodePermission({
      basePermission: userOpenCodePermission,
      hasMcp: normalizedMcp !== undefined && Object.keys(normalizedMcp).length > 0,
      hasAiSearchMcp,
    }),
  )
  const config = Schema.decodeUnknownSync(CompiledOpenCodeConfigSchema)({
    model: runtimeModelId,
    small_model: runtimeModelId,
    enabled_providers: availableProviders.map((currentProvider) => currentProvider.providerId),
    ...(normalizedMcp && { mcp: normalizedMcp }),
    ...(permission && { permission }),
    provider: Object.fromEntries(
      availableProviders.map((currentProvider) => [
        currentProvider.providerId,
        {
          name: currentProvider.name,
          npm: currentProvider.npm,
          options: compiledProviderOptions(currentProvider, credentialMode),
          models: Object.fromEntries(
            Object.entries(currentProvider.models).map(([currentModelId, model]) => [
              currentModelId,
              compileOpenCodeProviderModel(currentProvider, model),
            ]),
          ),
        },
      ]),
    ),
  })

  return {
    runtimeModelId,
    providerId,
    modelId,
    config,
  }
}

function buildOpenCodePermission(input: {
  basePermission: OpenCodePermission
  hasMcp: boolean
  hasAiSearchMcp: boolean
}): Option.Option<NonNullable<CompiledOpenCodeConfig["permission"]>> {
  return Match.value(input.basePermission).pipe(
    Match.when(Match.string, (permission) => Option.some(permission)),
    Match.orElse((permission) =>
      buildOpenCodePermissionObject({
        ...input,
        basePermission: permission,
      }),
    ),
  )
}

function buildOpenCodePermissionObject(input: {
  basePermission: Record<string, unknown>
  hasMcp: boolean
  hasAiSearchMcp: boolean
}): Option.Option<NonNullable<CompiledOpenCodeConfig["permission"]>> {
  const mcpPermission = Match.value(input.hasMcp).pipe(
    Match.when(true, () => ({
      "mcp_*": "allow",
      read: {
        "mcp:*": "allow",
      },
    })),
    Match.orElse(() => ({})),
  )
  const aiSearchPermission = Match.value(input.hasAiSearchMcp).pipe(
    Match.when(true, () => ({
      task: "deny",
    })),
    Match.orElse(() => ({})),
  )
  const permission: NonNullable<CompiledOpenCodeConfig["permission"]> = {
    ...input.basePermission,
    ...mcpPermission,
    ...aiSearchPermission,
  }

  return Option.liftPredicate(
    permission,
    (resolvedPermission) => Object.keys(resolvedPermission).length > 0,
  )
}

function compileOpenCodeProviderModel(
  provider: ResolvedProviderRecord,
  model: ProviderModelDefinition,
): CompiledOpenCodeProviderModel {
  const providerPackage = model.provider?.npm ?? provider.npm
  const reasoning = Option.match(Option.fromNullishOr(model.reasoning), {
    onNone: () => undefined,
    onSome: () => true,
  })

  return {
    name: model.name,
    description: model.description,
    options: model.options,
    limit: model.limit,
    provider: model.provider,
    reasoning,
    interleaved:
      model.interleaved ??
      Option.getOrUndefined(defaultOpenCodeInterleavedReasoning(providerPackage, model.reasoning)),
  }
}

function defaultOpenCodeInterleavedReasoning(
  providerPackage: string | undefined,
  reasoning: ProviderModelDefinition["reasoning"],
): Option.Option<OpenCodeInterleavedReasoning> {
  return Option.liftPredicate(
    { field: "reasoning_content" as const },
    () => Boolean(reasoning) && providerPackage === "@ai-sdk/openai-compatible",
  )
}

function compiledProviderApiKey(
  provider: ResolvedProviderRecord,
  sharedProviderCredentialMode: SharedProviderCredentialMode,
): string {
  return Match.value(provider.credentialSource).pipe(
    Match.when("shared", () =>
      Match.value(sharedProviderCredentialMode).pipe(
        Match.when("opencode_proxy", () => OPENCODE_SHARED_PROVIDER_CREDENTIAL_PROXY_API_KEY),
        Match.orElse(() => provider.apiKey ?? ""),
      ),
    ),
    Match.orElse(() => provider.apiKey ?? ""),
  )
}

function compiledProviderOptions(
  provider: ResolvedProviderRecord,
  sharedProviderCredentialMode: SharedProviderCredentialMode,
): Record<string, unknown> {
  const credentialOptions = Match.value(provider.credentialSource).pipe(
    Match.when("binding", () =>
      Match.value(sharedProviderCredentialMode).pipe(
        Match.when("opencode_proxy", () => ({
          apiKey: OPENCODE_SHARED_PROVIDER_CREDENTIAL_PROXY_API_KEY,
        })),
        Match.orElse(() => ({})),
      ),
    ),
    Match.orElse(() => ({
      apiKey: compiledProviderApiKey(provider, sharedProviderCredentialMode),
    })),
  )
  return {
    ...provider.options,
    ...credentialOptions,
  }
}

function isProviderAvailable(provider: ResolvedProviderRecord): boolean {
  return provider.credentialSource === "binding" || isNonEmptyString(provider.apiKey)
}

export async function isVisibleModelForUser(
  env: Env,
  userId: string,
  model: string,
): Promise<boolean> {
  const catalog = await buildRuntimeProviderCatalog(env, userId)
  const runtimeModelId = normalizeModelId(model)
  return catalog.modelOptions.some((group) =>
    group.models.some((item) => item.id === runtimeModelId),
  )
}

export function getUserProviderSettingsSnapshot(
  env: Env,
  userId: string,
): Promise<UserProviderSettingsSnapshot> {
  return Option.match(getUserProviderConfigsStore(env), {
    onNone: () =>
      Promise.resolve<UserProviderSettingsSnapshot>({
        defaultModel: null,
        defaultIsolateStepLimit: DEFAULT_ISOLATE_STEP_LIMIT,
        opencodePermission: null,
        defaultOpenCodePermission: cloneDefaultOpenCodePermission(),
        sharedOverrides: [],
        customProviders: [],
      }),
    onSome: (store) => store.getSettingsSnapshot(userId),
  })
}

export async function getUserOpenCodePermission(
  env: Env,
  userId: string,
): Promise<OpenCodePermission> {
  return Option.match(getUserProviderConfigsStore(env), {
    onNone: () => Promise.resolve(cloneDefaultOpenCodePermission()),
    onSome: async (store) =>
      (await store.getSettingsSnapshot(userId)).opencodePermission ??
      cloneDefaultOpenCodePermission(),
  })
}

export function replaceUserProviderSettings(
  env: Env,
  userId: string,
  input: UserProviderSettingsUpdate,
): Promise<void> {
  return Option.getOrThrowWith(
    getUserProviderConfigsStore(env),
    () => new Error("TOKEN_ENCRYPTION_KEY not configured"),
  ).replaceSettings(userId, input)
}

function getUserProviderConfigsStore(env: Env): Option.Option<UserProviderConfigsStorePromise> {
  return Option.fromNullishOr(env.TOKEN_ENCRYPTION_KEY).pipe(
    Option.filter((key) => key.length > 0),
    Option.map((key) => createUserProviderConfigsStoreFromD1(env.DB, key)),
  )
}

function getUserDefaultModel(env: Env, userId: string): Promise<string | null> {
  return Option.match(getUserProviderConfigsStore(env), {
    onNone: () => Promise.resolve<string | null>(null),
    onSome: async (store) => (await store.getSettingsSnapshot(userId)).defaultModel,
  })
}

function normalizeOptionalOpenCodePermission(value: unknown): Option.Option<OpenCodePermission> {
  return Option.map(Option.fromNullishOr(value), (resolved) =>
    normalizeOpenCodePermission(resolved),
  )
}

export function getUserDefaultIsolateStepLimit(env: Env, userId: string): Promise<number> {
  return Option.match(getUserProviderConfigsStore(env), {
    onNone: () => Promise.resolve(DEFAULT_ISOLATE_STEP_LIMIT),
    onSome: async (store) =>
      normalizeIsolateStepLimit(
        (await store.getSettingsSnapshot(userId)).defaultIsolateStepLimit,
        DEFAULT_ISOLATE_STEP_LIMIT,
      ),
  })
}

async function getMergedProviderSnapshot(
  env: Env,
  userId: string,
): Promise<SharedProviderBuildResult> {
  const shared = await buildSharedProviders(env)
  return Option.match(getUserProviderConfigsStore(env), {
    onNone: () => Promise.resolve(shared),
    onSome: async (store) => ({
      ...shared,
      providers: await mergeUserProviders(store, userId, shared.providers),
    }),
  })
}

async function mergeUserProviders(
  store: UserProviderConfigsStorePromise,
  userId: string,
  sharedProviders: ResolvedProviderRecord[],
): Promise<ResolvedProviderRecord[]> {
  const userSettings = await store.listRuntimeConfigs(userId)
  const overrideByProviderId = new Map(
    Arr.getSomes(userSettings.providers.map(toSharedOverrideEntry)),
  )
  const mergedShared = sharedProviders.map((shared) =>
    applySharedOverride(shared, overrideByProviderId),
  )
  const customProviders = Arr.getSomes(userSettings.providers.map(toCustomProviderRecord))
  return sortProviders([...mergedShared, ...customProviders])
}

function toSharedOverrideEntry(
  userProvider: RuntimeUserProviderRecord,
): Option.Option<readonly [string, string]> {
  return Match.value(userProvider.scope === "shared_override").pipe(
    Match.when(false, () => Option.none<readonly [string, string]>()),
    Match.orElse(() =>
      trimmedNonEmpty(userProvider.apiKey).pipe(
        Option.map((apiKey) => [userProvider.providerId, apiKey] as const),
      ),
    ),
  )
}

function applySharedOverride(
  shared: ResolvedProviderRecord,
  overrideByProviderId: ReadonlyMap<string, string>,
): ResolvedProviderRecord {
  return Option.match(Option.fromNullishOr(overrideByProviderId.get(shared.providerId)), {
    onNone: () => shared,
    onSome: (apiKey) => ({
      ...shared,
      apiKey,
      credentialSource: "user_override",
    }),
  })
}

function toCustomProviderRecord(
  userProvider: RuntimeUserProviderRecord,
): Option.Option<ResolvedProviderRecord> {
  return Match.value(userProvider.scope === "shared_override").pipe(
    Match.when(true, () => Option.none<ResolvedProviderRecord>()),
    Match.orElse(() => Option.some(toResolvedCustomProvider(userProvider))),
  )
}

function toResolvedCustomProvider(userProvider: RuntimeUserProviderRecord): ResolvedProviderRecord {
  const credentialSource = Option.match(trimmedNonEmpty(userProvider.apiKey), {
    onNone: () => "missing" as const,
    onSome: () => "user_custom" as const,
  })
  return {
    providerId: userProvider.providerId,
    name: userProvider.displayName,
    npm: userProvider.npm,
    options: userProvider.options,
    models: userProvider.models ?? {},
    source: "custom",
    apiKey: userProvider.apiKey,
    globalCredentialConfigured: false,
    credentialSource,
  }
}

function sortProviders(providers: ResolvedProviderRecord[]): ResolvedProviderRecord[] {
  return [...providers].sort(compareProviders)
}

function compareProviders(a: ResolvedProviderRecord, b: ResolvedProviderRecord): number {
  return Match.value(a.source === b.source).pipe(
    Match.when(true, () => a.name.localeCompare(b.name)),
    Match.orElse(() => sourceRank(a.source) - sourceRank(b.source)),
  )
}

function sourceRank(source: ResolvedProviderRecord["source"]): number {
  return Match.value(source).pipe(
    Match.when("shared", () => 0),
    Match.orElse(() => 1),
  )
}

async function buildSharedProviders(env: Env): Promise<SharedProviderBuildResult> {
  const staticProviders = SHARED_PROVIDER_CATALOG.filter(
    (provider) => provider.providerId !== "litellm" && provider.providerId !== "litellm-anthropic",
  ).map((provider) => toSharedProviderRecord(env, provider))
  const cloudflareAiGateway = Option.match(buildCloudflareAiGatewayCatalogProvider(env), {
    onNone: () => ({ providers: [] as ResolvedProviderRecord[], defaultModel: null }),
    onSome: ({ provider, defaultModel }) => ({
      providers: [toResolvedBindingProviderRecord(provider)],
      defaultModel,
    }),
  })
  const deploymentProviders = [...staticProviders, ...cloudflareAiGateway.providers]
  const litellmConfig = await runProviderCatalogEffect(getLitellmConfigWithPresence(env))
  return Match.value(litellmConfig.configured).pipe(
    Match.when(false, () => ({
      providers: deploymentProviders,
      configuredDefaultModel: cloudflareAiGateway.defaultModel,
    })),
    Match.orElse(async () => {
      const dynamicLitellm = await runProviderCatalogEffect(buildLitellmCatalogProviders(env))
      // oxlint-disable-next-line s0-lint/no-return-in-arrow, s0-lint/no-return-in-callback -- Async Match branch returns the computed shared-provider snapshot.
      return Option.match(dynamicLitellm, {
        onNone: () => ({
          providers: deploymentProviders,
          configuredDefaultModel: cloudflareAiGateway.defaultModel,
        }),
        onSome: (snapshot) => ({
          providers: [
            ...deploymentProviders,
            ...snapshot.providers.map((entry) =>
              toResolvedLitellmProviderRecord(entry.provider, entry.apiKey),
            ),
          ],
          configuredDefaultModel: snapshot.defaultModel ?? cloudflareAiGateway.defaultModel,
        }),
      })
    }),
  )
}

function toResolvedBindingProviderRecord(
  provider: SharedProviderDefinition,
): ResolvedProviderRecord {
  return {
    providerId: provider.providerId,
    name: provider.name,
    npm: provider.npm,
    options: provider.options,
    models: provider.models,
    source: "shared",
    apiKey: null,
    globalCredentialConfigured: true,
    credentialSource: "binding",
  }
}

function runProviderCatalogEffect<A, E>(
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Promise-boundary bridge for generic provider catalog Effects.
  effect: Effect.Effect<A, E>,
): Promise<A> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary for provider catalog assembly.
  return Effect.runPromise(effect)
}

function toResolvedLitellmProviderRecord(
  provider: SharedProviderDefinition,
  apiKey: string | null,
): ResolvedProviderRecord {
  const apiKeyOption = trimmedNonEmpty(apiKey)
  return {
    providerId: provider.providerId,
    name: provider.name,
    npm: provider.npm,
    options: provider.options,
    models: provider.models,
    source: "shared",
    apiKey: Option.getOrNull(apiKeyOption),
    globalCredentialConfigured: Option.isSome(apiKeyOption),
    credentialSource: Match.value(Option.isSome(apiKeyOption)).pipe(
      Match.when(true, () => "shared" as const),
      Match.orElse(() => "missing" as const),
    ),
  }
}

function toSharedProviderRecord(
  env: Env,
  provider: SharedProviderCatalogEntry,
): ResolvedProviderRecord {
  const apiKeyOption = resolveSharedProviderApiKeyForProvider(env, provider)
  const credentialSource = Option.match(apiKeyOption, {
    onNone: () => "missing" as const,
    onSome: () => "shared" as const,
  })
  return {
    providerId: provider.providerId,
    name: provider.name,
    npm: provider.npm,
    options: provider.options,
    models: provider.models,
    source: "shared",
    apiKey: Option.getOrNull(apiKeyOption),
    globalCredentialConfigured: Option.isSome(apiKeyOption),
    credentialSource,
  }
}

function resolveSharedProviderApiKeyForProvider(
  env: Env,
  provider: SharedProviderCatalogEntry,
): Option.Option<string> {
  return Option.flatMap(Option.fromNullishOr(provider.apiKey), (apiKeyRef) =>
    resolveSharedProviderApiKey(env, apiKeyRef.name),
  )
}

function resolveSharedProviderApiKey(env: Env, secretName: string): Option.Option<string> {
  return trimmedNonEmpty(Reflect.get(env, secretName))
}

function resolveCatalogDefaultModel(
  visibleModelIds: string[],
  userDefaultModel: string | null,
  configuredDefaultModel: string | null,
): Option.Option<string> {
  return Match.value(visibleModelIds.length === 0).pipe(
    Match.when(true, () => Option.none<string>()),
    Match.orElse(() =>
      resolvePreferredVisibleModel(visibleModelIds, userDefaultModel, configuredDefaultModel),
    ),
  )
}

function resolvePreferredVisibleModel(
  visibleModelIds: string[],
  userDefaultModel: string | null,
  configuredDefaultModel: string | null,
): Option.Option<string> {
  const normalizedUserDefault = Option.fromNullishOr(userDefaultModel).pipe(
    Option.map((model) => normalizeModelId(model)),
    Option.filter((model) => visibleModelIds.includes(model)),
  )
  const normalizedConfiguredDefault = Option.fromNullishOr(configuredDefaultModel).pipe(
    Option.map((model) => normalizeModelId(model)),
    Option.filter((model) => visibleModelIds.includes(model)),
  )
  return Option.orElse(normalizedUserDefault, () => normalizedConfiguredDefault)
}

function normalizeProviderId(value: string): string {
  const normalized = value.trim().toLowerCase()
  assertCondition(PROVIDER_ID_PATTERN.test(normalized), `Invalid provider id '${value}'`)
  return normalized
}

function normalizeOptionalString(value: string | null | undefined): Option.Option<string> {
  return Option.fromNullishOr(value).pipe(
    Option.map((raw) => raw.trim()),
    Option.filter((normalized) => normalized.length > 0),
  )
}

function normalizeOptionalSecret(value: string | undefined): Option.Option<string> {
  return Option.fromNullishOr(value).pipe(
    Option.map((raw) => raw.trim()),
    Option.filter((normalized) => normalized.length > 0),
  )
}

function splitRuntimeModelId(runtimeModelId: string): {
  providerId: string
  modelId: string
} {
  const [providerId, ...rest] = runtimeModelId.split("/")
  return {
    providerId,
    modelId: rest.join("/"),
  }
}

export function toEditableCustomProviderSettings(
  provider: UserCustomProviderSettings,
): UserCustomProviderSettings {
  return {
    providerId: provider.providerId,
    name: provider.name,
    npm: provider.npm,
    options: provider.options,
    models: provider.models,
    hasApiKey: provider.hasApiKey,
  }
}
