"use client"

import type {
  ProviderModelDefinition,
  ProviderSettingsUpdatePayload,
  ProviderSettingsSnapshot,
  RuntimeProviderModelOption,
  UserCustomProviderUpdate,
} from "@c0-agent/shared"
import { Button } from "@cloudflare/kumo/components/button"
import { Input } from "@cloudflare/kumo/components/input"
import { InputGroup } from "@cloudflare/kumo/components/input-group"
import { Label } from "@cloudflare/kumo/components/label"
import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { Switch } from "@cloudflare/kumo/components/switch"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import { useBlocker } from "@tanstack/react-router"
import { ChevronDown, RotateCcw, Save } from "lucide-react"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { CodeSurface } from "@/components/code"
import { ModelThinkingDialog } from "@/components/model-thinking-dialog"
import { UnsavedChangesModal } from "@/components/unsaved-changes-modal"
import { useProviderSettings } from "@/hooks/use-provider-settings"
import { recessedInputGroupClassName } from "@/lib/recessed-field"
import { appToastManager, showErrorToast } from "@/lib/toast-manager"
import {
  buildCustomProviderDrafts,
  buildSharedProviderDrafts,
  createEmptyCustomProviderDraft,
  getCustomProviderDraftLabel,
  isProviderSettingsDirty,
  serializeProviderFormState,
  type CustomProviderDraft,
  type SharedProviderDraft,
} from "./provider-drafts"
import { SettingsDocsLayout, SettingsDocsSectionHeading } from "./settings-docs-layout"

const PROVIDERS_TOC_ITEMS = [
  { id: "provider-defaults", label: "Defaults" },
  { id: "global-providers", label: "Global Providers" },
  { id: "my-providers", label: "My Providers" },
] as const

const PROVIDERS_PAGE_DESCRIPTION =
  "Configure global AI providers, personal API keys, custom providers, and your default model."

function parseOptionalJsonObject(
  value: string,
  label: string,
): Record<string, unknown> | undefined {
  if (!value.trim()) {
    return undefined
  }
  const parsed = JSON.parse(value) as unknown
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${label} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function parseModelsJson(value: string): Record<string, ProviderModelDefinition> {
  if (!value.trim()) {
    throw new Error("Models JSON is required")
  }
  const parsed = JSON.parse(value) as unknown
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Models JSON must be an object")
  }
  return parsed as Record<string, ProviderModelDefinition>
}

function buildProviderSettingsPayload(
  defaultModel: string,
  settings: ProviderSettingsSnapshot,
  sharedDrafts: SharedProviderDraft[],
  customDrafts: CustomProviderDraft[],
): ProviderSettingsUpdatePayload {
  return {
    defaultModel: defaultModel.trim() || null,
    defaultIsolateStepLimit: settings.defaultIsolateStepLimit ?? null,
    opencodePermission: settings.opencodePermission,
    sharedOverrides: sharedDrafts
      .filter((draft) => draft.enabled)
      .map((draft) => ({
        providerId: draft.providerId,
        displayName: draft.displayName,
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      })),
    customProviders: customDrafts.map(
      (draft): UserCustomProviderUpdate => ({
        providerId: draft.providerId.trim(),
        name: draft.name.trim(),
        ...(draft.npm.trim() ? { npm: draft.npm.trim() } : {}),
        ...(draft.optionsText.trim()
          ? {
              options: parseOptionalJsonObject(
                draft.optionsText,
                `${draft.providerId || "provider"} options`,
              ),
            }
          : {}),
        models: parseModelsJson(draft.modelsText),
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      }),
    ),
  }
}

function SharedProviderApiKeyField({
  draft,
  onDraftChange,
}: {
  draft: SharedProviderDraft
  onDraftChange: (providerId: string, update: Partial<SharedProviderDraft>) => void
}) {
  return (
    <div className="grid gap-2">
      <div className="flex w-full items-center justify-between gap-2">
        <Label tooltip="Use your personal API token to unlock higher rate limits">
          Personal API Key
        </Label>
        <Switch
          size="sm"
          checked={draft.enabled}
          controlFirst={false}
          aria-label="Enable personal API key"
          onCheckedChange={(checked) =>
            onDraftChange(draft.providerId, {
              enabled: checked,
            })
          }
        />
      </div>
      <InputGroup size="sm" className={recessedInputGroupClassName}>
        <InputGroup.Input
          id={`personal-api-key-${draft.providerId}`}
          type="password"
          readOnly={!draft.enabled}
          value={draft.apiKey}
          aria-label="Personal API key"
          className={!draft.enabled ? "pointer-events-none opacity-50" : undefined}
          onChange={(event) => {
            if (!draft.enabled) {
              return
            }
            onDraftChange(draft.providerId, { apiKey: event.target.value })
          }}
          placeholder={
            draft.enabled
              ? draft.hasExistingApiKey
                ? "Stored key will be kept if left blank"
                : "Enter API key"
              : "Enable personal API key to enter a token"
          }
        />
      </InputGroup>
    </div>
  )
}

function formatModelOptionLabel(
  option: RuntimeProviderModelOption | null | undefined,
  fallback: string,
): string {
  return option ? `${option.providerName} / ${option.name}` : fallback
}

function DefaultModelPickerField({
  canReset,
  globalValue,
  value,
  onClick,
  onReset,
}: {
  canReset: boolean
  globalValue: string
  value: string
  onClick: () => void
  onReset: () => void
}) {
  return (
    <div className="w-full max-w-lg space-y-2">
      <button
        type="button"
        onClick={onClick}
        aria-label="Default model"
        className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-kumo-hairline bg-kumo-control px-3 py-2 text-left text-sm text-kumo-default transition hover:border-kumo-line hover:bg-kumo-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand"
      >
        <span className="min-w-0 flex-1 truncate">{value}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-kumo-subtle" aria-hidden />
      </button>
      {canReset ? (
        <div className="flex justify-end">
          <Tooltip
            content={`Global default: ${globalValue}`}
            render={<span className="inline-flex" />}
          >
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={onReset}
              icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
            >
              Reset to global
            </Button>
          </Tooltip>
        </div>
      ) : null}
    </div>
  )
}

function GlobalProviderModelCountBadge({ modelCount }: { modelCount: number }) {
  const label = modelCount === 1 ? "1 model" : `${modelCount} models`
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-kumo-tint px-2 py-0.5 text-[11px] font-medium leading-5 text-kumo-subtle ring-1 ring-kumo-hairline">
      {label}
    </span>
  )
}

export function ProvidersSettings({
  onHeaderActionsChange,
}: {
  onHeaderActionsChange?: (actions: ReactNode | null) => void
}) {
  const { catalog, settings, loading, saving, error, save } = useProviderSettings()
  const [sharedDrafts, setSharedDrafts] = useState<SharedProviderDraft[]>([])
  const [customDrafts, setCustomDrafts] = useState<CustomProviderDraft[]>([])
  const [defaultModel, setDefaultModel] = useState<string>("")
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [savedFormState, setSavedFormState] = useState<string | null>(null)
  const [savingBeforeNavigation, setSavingBeforeNavigation] = useState(false)

  const isDirty = useMemo(
    () => isProviderSettingsDirty(savedFormState, defaultModel, sharedDrafts, customDrafts),
    [savedFormState, defaultModel, sharedDrafts, customDrafts],
  )

  const navigationBlocker = useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: () => isDirty,
    withResolver: true,
  })

  useEffect(() => {
    if (!error) {
      return
    }
    showErrorToast(error)
  }, [error])

  useEffect(() => {
    if (!catalog || !settings) {
      return
    }
    const shared = buildSharedProviderDrafts(catalog.providers, settings.sharedOverrides)
    const custom = buildCustomProviderDrafts(settings.customProviders)
    const model = settings.defaultModel ?? ""
    setSharedDrafts(shared)
    setCustomDrafts(custom)
    setDefaultModel(model)
    setSavedFormState(serializeProviderFormState(model, shared, custom))
  }, [catalog, settings])

  const flatModelOptions = useMemo(
    () => catalog?.modelOptions.flatMap((group) => group.models) ?? [],
    [catalog],
  )
  const effectiveDefaultModel =
    defaultModel || catalog?.globalDefaultModel || catalog?.defaultModel || ""
  const selectedDefaultModelOption = useMemo(
    () => flatModelOptions.find((model) => model.id === effectiveDefaultModel) ?? null,
    [effectiveDefaultModel, flatModelOptions],
  )
  const globalDefaultModelOption = useMemo(
    () => flatModelOptions.find((model) => model.id === catalog?.globalDefaultModel) ?? null,
    [catalog?.globalDefaultModel, flatModelOptions],
  )
  const defaultModelLabel = formatModelOptionLabel(
    selectedDefaultModelOption,
    effectiveDefaultModel || "Select model",
  )
  const globalDefaultModelLabel = formatModelOptionLabel(
    globalDefaultModelOption,
    catalog?.globalDefaultModel || "Not configured",
  )
  const providersById = useMemo(
    () => new Map(catalog?.providers.map((provider) => [provider.providerId, provider] as const)),
    [catalog?.providers],
  )
  const globalProviderDrafts = useMemo(
    () =>
      sharedDrafts.filter((draft) => {
        const provider = providersById.get(draft.providerId)
        return (
          provider?.source === "shared" && (provider.globalCredentialConfigured || draft.enabled)
        )
      }),
    [providersById, sharedDrafts],
  )
  const hasCustomDefaultModel = defaultModel.trim().length > 0

  const handleDefaultModelSelect = useCallback(
    (value: string) => {
      setDefaultModel(value === catalog?.globalDefaultModel ? "" : value)
    },
    [catalog?.globalDefaultModel],
  )

  const handleAddCustomProvider = () => {
    setCustomDrafts((current) => [...current, createEmptyCustomProviderDraft()])
  }

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!settings) {
      return false
    }

    try {
      const payload = buildProviderSettingsPayload(
        defaultModel,
        settings,
        sharedDrafts,
        customDrafts,
      )

      await save(payload)
      appToastManager.add({
        title: "Provider settings updated",
        timeout: 5000,
      })
      setSharedDrafts((current) =>
        current.map((draft) => ({
          ...draft,
          hasExistingApiKey: draft.enabled
            ? draft.hasExistingApiKey || draft.apiKey.trim().length > 0
            : false,
          apiKey: "",
        })),
      )
      setCustomDrafts((current) =>
        current.map((draft) => ({
          ...draft,
          hasExistingApiKey: draft.hasExistingApiKey || draft.apiKey.trim().length > 0,
          apiKey: "",
        })),
      )
      return true
    } catch {
      // save() sets hook error; useEffect above surfaces it as a toast.
      return false
    }
  }, [customDrafts, defaultModel, save, settings, sharedDrafts])

  const saveBeforeNavigation = useCallback(async () => {
    if (navigationBlocker.status !== "blocked") {
      return
    }

    setSavingBeforeNavigation(true)
    try {
      const saved = await handleSave()
      if (saved) {
        navigationBlocker.proceed()
      }
    } finally {
      setSavingBeforeNavigation(false)
    }
  }, [handleSave, navigationBlocker])

  useEffect(() => {
    if (!onHeaderActionsChange) {
      return
    }

    onHeaderActionsChange(
      isDirty ? (
        <Button
          type="button"
          variant="primary"
          onClick={() => void handleSave()}
          disabled={saving}
          loading={saving}
          icon={<Save className="h-4 w-4" aria-hidden />}
        >
          Save
        </Button>
      ) : null,
    )
  }, [handleSave, isDirty, onHeaderActionsChange, saving])

  useEffect(() => {
    return () => {
      onHeaderActionsChange?.(null)
    }
  }, [onHeaderActionsChange])

  if (loading) {
    return (
      <SettingsDocsLayout
        title="AI Providers"
        titleId="settings-providers"
        description={PROVIDERS_PAGE_DESCRIPTION}
        tocItems={PROVIDERS_TOC_ITEMS}
      >
        <p className="text-sm text-kumo-subtle">Loading provider settings...</p>
      </SettingsDocsLayout>
    )
  }

  if (!catalog || !settings) {
    return (
      <SettingsDocsLayout
        title="AI Providers"
        titleId="settings-providers"
        description={PROVIDERS_PAGE_DESCRIPTION}
        tocItems={PROVIDERS_TOC_ITEMS}
      >
        <p className="text-sm text-kumo-subtle">Provider settings are unavailable.</p>
      </SettingsDocsLayout>
    )
  }

  return (
    <SettingsDocsLayout
      title="AI Providers"
      titleId="settings-providers"
      description={PROVIDERS_PAGE_DESCRIPTION}
      tocItems={PROVIDERS_TOC_ITEMS}
    >
      <section className="space-y-4">
        <SettingsDocsSectionHeading id="provider-defaults" level="h2" title="Defaults">
          <p className="text-sm text-kumo-subtle">
            The default model is used for new agents when you do not choose one explicitly.
          </p>
        </SettingsDocsSectionHeading>
        {flatModelOptions.length === 0 ? (
          <p className="text-sm text-kumo-subtle">
            No models are currently available. Add a provider API key below to enable one.
          </p>
        ) : (
          <DefaultModelPickerField
            canReset={hasCustomDefaultModel}
            globalValue={globalDefaultModelLabel}
            value={defaultModelLabel}
            onClick={() => setModelDialogOpen(true)}
            onReset={() => setDefaultModel("")}
          />
        )}
      </section>

      {modelDialogOpen ? (
        <ModelThinkingDialog
          modelOptions={catalog.modelOptions}
          selectedModel={effectiveDefaultModel}
          selectedModelOption={selectedDefaultModelOption}
          reasoningEffort={undefined}
          showThinking={false}
          onModelSelect={handleDefaultModelSelect}
          onReasoningSelect={() => undefined}
          onClose={() => setModelDialogOpen(false)}
        />
      ) : null}

      <section className="space-y-4">
        <SettingsDocsSectionHeading id="global-providers" level="h2" title="Global Providers">
          <p className="text-sm text-kumo-subtle">
            Global providers are configured by your admin. Use your personal API keys when for
            improved rate limits and quotas.
          </p>
        </SettingsDocsSectionHeading>
        {globalProviderDrafts.length === 0 ? (
          <p className="text-sm text-kumo-subtle">No global providers are configured.</p>
        ) : (
          <div className="space-y-3">
            {globalProviderDrafts.map((draft) => {
              const provider = catalog.providers.find(
                (item) => item.providerId === draft.providerId,
              )
              return (
                <LayerCard key={draft.providerId} className="overflow-hidden rounded-xl">
                  <LayerCard.Secondary className="my-0 flex items-start justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <span className="text-xs font-medium">{draft.displayName}</span>
                    </div>
                    <GlobalProviderModelCountBadge modelCount={provider?.models.length ?? 0} />
                  </LayerCard.Secondary>
                  <LayerCard.Primary className="space-y-3 rounded-lg p-3">
                    <SharedProviderApiKeyField
                      draft={draft}
                      onDraftChange={(providerId, update) =>
                        setSharedDrafts((current) =>
                          current.map((item) =>
                            item.providerId === providerId ? { ...item, ...update } : item,
                          ),
                        )
                      }
                    />
                  </LayerCard.Primary>
                </LayerCard>
              )
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <SettingsDocsSectionHeading
          id="my-providers"
          level="h2"
          title="My Providers"
          trailing={
            <Button type="button" onClick={handleAddCustomProvider} size="sm">
              Add provider
            </Button>
          }
        >
          <div>
            <p className="text-sm text-kumo-subtle">
              Add custom providers and models for your account.
            </p>
          </div>
        </SettingsDocsSectionHeading>

        {customDrafts.length === 0 ? (
          <p className="text-sm text-kumo-subtle">No custom providers yet.</p>
        ) : (
          <div className="space-y-4">
            {customDrafts.map((draft) => (
              <LayerCard key={draft.id} className="overflow-hidden rounded-xl">
                <LayerCard.Secondary className="my-0 flex items-center justify-between gap-4 px-3 py-2">
                  <span className="text-xs font-medium">{getCustomProviderDraftLabel(draft)}</span>
                  <Button
                    type="button"
                    onClick={() =>
                      setCustomDrafts((current) => current.filter((item) => item.id !== draft.id))
                    }
                    size="xs"
                    variant="ghost"
                  >
                    Remove
                  </Button>
                </LayerCard.Secondary>
                <LayerCard.Primary className="space-y-3 rounded-lg p-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm text-kumo-default">
                      Provider ID
                      <Input
                        type="text"
                        value={draft.providerId}
                        onChange={(event) =>
                          setCustomDrafts((current) =>
                            current.map((item) =>
                              item.id === draft.id
                                ? { ...item, providerId: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="example-provider"
                        aria-label={`${getCustomProviderDraftLabel(draft)} provider id`}
                      />
                    </label>

                    <label className="flex flex-col gap-1 text-sm text-kumo-default">
                      Display name
                      <Input
                        type="text"
                        value={draft.name}
                        onChange={(event) =>
                          setCustomDrafts((current) =>
                            current.map((item) =>
                              item.id === draft.id ? { ...item, name: event.target.value } : item,
                            ),
                          )
                        }
                        placeholder="My Provider"
                        aria-label={`${getCustomProviderDraftLabel(draft)} display name`}
                      />
                    </label>

                    <label className="flex flex-col gap-1 text-sm text-kumo-default md:col-span-2">
                      AI SDK package
                      <Input
                        type="text"
                        value={draft.npm}
                        onChange={(event) =>
                          setCustomDrafts((current) =>
                            current.map((item) =>
                              item.id === draft.id ? { ...item, npm: event.target.value } : item,
                            ),
                          )
                        }
                        placeholder="@ai-sdk/openai-compatible"
                        aria-label={`${getCustomProviderDraftLabel(draft)} AI SDK package`}
                      />
                    </label>
                  </div>

                  <div className="flex flex-col gap-1 text-sm text-kumo-default">
                    Provider options JSON
                    <CodeSurface
                      title={`${getCustomProviderDraftLabel(draft)} provider options JSON`}
                      value={draft.optionsText}
                      language="json"
                      mode="editable"
                      onSave={(value) =>
                        setCustomDrafts((current) =>
                          current.map((item) =>
                            item.id === draft.id ? { ...item, optionsText: value } : item,
                          ),
                        )
                      }
                      previewMaxHeightClassName="max-h-40"
                    />
                  </div>

                  <div className="flex flex-col gap-1 text-sm text-kumo-default">
                    Models JSON
                    <CodeSurface
                      title={`${getCustomProviderDraftLabel(draft)} models JSON`}
                      value={draft.modelsText}
                      language="json"
                      mode="editable"
                      onSave={(value) =>
                        setCustomDrafts((current) =>
                          current.map((item) =>
                            item.id === draft.id ? { ...item, modelsText: value } : item,
                          ),
                        )
                      }
                    />
                  </div>

                  <label className="flex flex-col gap-1 text-sm text-kumo-default">
                    API key
                    <Input
                      type="password"
                      value={draft.apiKey}
                      onChange={(event) =>
                        setCustomDrafts((current) =>
                          current.map((item) =>
                            item.id === draft.id ? { ...item, apiKey: event.target.value } : item,
                          ),
                        )
                      }
                      placeholder={
                        draft.hasExistingApiKey
                          ? "Stored key will be kept if left blank"
                          : "Enter API key"
                      }
                      aria-label={`${getCustomProviderDraftLabel(draft)} API key`}
                    />
                  </label>
                </LayerCard.Primary>
              </LayerCard>
            ))}
          </div>
        )}
      </section>

      {navigationBlocker.status === "blocked" ? (
        <UnsavedChangesModal
          saving={savingBeforeNavigation || saving}
          description="Provider settings have unsaved changes. Save before leaving, or continue without saving."
          onSave={() => void saveBeforeNavigation()}
          onLeave={navigationBlocker.proceed}
          onCancel={navigationBlocker.reset}
        />
      ) : null}
    </SettingsDocsLayout>
  )
}
