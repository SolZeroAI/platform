export type SharedProviderDraft = {
  providerId: string
  displayName: string
  enabled: boolean
  hasExistingApiKey: boolean
  apiKey: string
}

export type CustomProviderDraft = {
  id: string
  providerId: string
  name: string
  npm: string
  optionsText: string
  modelsText: string
  hasExistingApiKey: boolean
  apiKey: string
}

type SharedProviderSource = {
  providerId?: unknown
  name?: unknown
  source?: unknown
}

type SharedProviderOverrideSource = {
  providerId?: unknown
  hasApiKey?: unknown
}

type CustomProviderSource = {
  providerId?: unknown
  name?: unknown
  npm?: unknown
  options?: unknown
  models?: unknown
  hasApiKey?: unknown
}

function createDraftId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

function stringifyJson(value: unknown): string {
  if (
    !value ||
    (typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0)
  ) {
    return ""
  }
  return JSON.stringify(value, null, 2)
}

function readDraftText(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function readDraftRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function buildSharedProviderDrafts(
  providers: readonly SharedProviderSource[],
  sharedOverrides: readonly SharedProviderOverrideSource[] | undefined,
): SharedProviderDraft[] {
  const overridesByProviderId = new Map(
    (sharedOverrides ?? []).map((item) => [readDraftText(item.providerId), item] as const),
  )

  return providers
    .filter((provider) => provider.source === "shared")
    .map((provider) => {
      const providerId = readDraftText(provider.providerId)
      const override = overridesByProviderId.get(providerId)
      return {
        providerId,
        displayName: readDraftText(provider.name) || providerId,
        enabled: Boolean(override),
        hasExistingApiKey: Boolean(override?.hasApiKey),
        apiKey: "",
      }
    })
}

export function buildCustomProviderDrafts(
  providers: readonly CustomProviderSource[] | undefined,
): CustomProviderDraft[] {
  return (providers ?? []).map((provider) => ({
    id: createDraftId(),
    providerId: readDraftText(provider.providerId),
    name: readDraftText(provider.name),
    npm: readDraftText(provider.npm),
    optionsText: stringifyJson(readDraftRecord(provider.options)),
    modelsText: stringifyJson(readDraftRecord(provider.models) ?? {}),
    hasExistingApiKey: Boolean(provider.hasApiKey),
    apiKey: "",
  }))
}

export function createEmptyCustomProviderDraft(): CustomProviderDraft {
  return {
    id: createDraftId(),
    providerId: "",
    name: "",
    npm: "@ai-sdk/openai-compatible",
    optionsText: "",
    modelsText: '{\n  "example-model": {\n    "name": "Example Model"\n  }\n}',
    hasExistingApiKey: false,
    apiKey: "",
  }
}

export function getCustomProviderDraftLabel(draft: CustomProviderDraft): string {
  return (
    readDraftText(draft.name).trim() || readDraftText(draft.providerId).trim() || "New provider"
  )
}

export function serializeProviderFormState(
  defaultModel: string,
  sharedDrafts: readonly SharedProviderDraft[],
  customDrafts: readonly CustomProviderDraft[],
): string {
  return JSON.stringify({
    defaultModel: defaultModel.trim(),
    shared: sharedDrafts.map(({ providerId, enabled, apiKey }) => ({
      providerId,
      enabled,
      apiKey: apiKey.trim(),
    })),
    custom: customDrafts.map(({ providerId, name, npm, optionsText, modelsText, apiKey }) => ({
      providerId: providerId.trim(),
      name: name.trim(),
      npm: npm.trim(),
      optionsText: optionsText.trim(),
      modelsText: modelsText.trim(),
      apiKey: apiKey.trim(),
    })),
  })
}

export function isProviderSettingsDirty(
  savedFormState: string | null,
  defaultModel: string,
  sharedDrafts: readonly SharedProviderDraft[],
  customDrafts: readonly CustomProviderDraft[],
): boolean {
  if (!savedFormState) {
    return false
  }
  return serializeProviderFormState(defaultModel, sharedDrafts, customDrafts) !== savedFormState
}
