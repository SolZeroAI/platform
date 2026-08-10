"use client"

import type {
  AdminAiProvidersResponse,
  AdminCloudflareAiGatewayProviderKeysPayload,
  AdminLitellmConfigPayload,
  AdminLitellmModel,
} from "@solzero/api"
import {
  buildModelId,
  type ReasoningEffort,
  type RuntimeModelCategory,
  type RuntimeProviderModelOption,
} from "@solzero/shared"
import { Button } from "@cloudflare/kumo/components/button"
import { DropdownMenu } from "@cloudflare/kumo/components/dropdown"
import { Pagination } from "@cloudflare/kumo/components/pagination"
import { Select as KumoSelect } from "@cloudflare/kumo/components/select"
import { Switch } from "@cloudflare/kumo/components/switch"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import { TableOfContents } from "@cloudflare/kumo/components/table-of-contents"
import { TooltipProvider } from "@cloudflare/kumo/components/tooltip"
import { useBlocker } from "@tanstack/react-router"
import { FileCode2, MoreVertical, RefreshCw, RotateCcw, Save } from "lucide-react"
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { S0Loader, TableCellState } from "@/components/s0-loader"
import { CodeSurface } from "@/components/code"
import { UnsavedChangesModal } from "@/components/unsaved-changes-modal"
import { getStickySelectPortalRoot } from "@/lib/sticky-select-portal"
import { showErrorToast } from "@/lib/toast-manager"
import { AdminCloudflareAiGatewayPanel } from "./admin-cloudflare-ai-gateway-panel"
import {
  DEFAULT_TOC_SECTION,
  LITELLM_ANTHROPIC_PROVIDER_ID,
  LITELLM_ANTHROPIC_PROVIDER_NAME,
  LITELLM_PROVIDER_ID,
  LITELLM_PROVIDER_NAME,
  MODEL_REGISTRY_PAGE_SIZE,
  REASONING_EFFORT_VALUES,
  TOC_SECTION_VALUES,
  type TocSectionValue,
} from "./admin-ai-provider-panel-constants"
import {
  DocsSectionHeading,
  EnvLockIcon,
  Field,
  LitellmSyncStatusIndicator,
  ModelAdapterRow,
  ModelThinkingField,
  getPendingAdminSectionHash,
  navigateToAdminSection,
} from "./admin-ai-provider-panel-ui"
import { LitellmResetConfigDialog } from "./admin-litellm-reset-config-dialog"
import { formatReasoningEffortLabel, ModelThinkingDialog } from "./model-thinking-dialog"

type LitellmFieldErrors = {
  apiKey?: string
  baseUrl?: string
  defaultModel?: string
  defaultReasoningLevel?: string
}

type LitellmValidationInput = {
  apiKey: string
  apiKeyConfigured: boolean
  apiKeyLocked: boolean
  baseUrl: string
  defaultModel: string
  defaultReasoningLevel: string
  enabled: boolean
  models: AdminLitellmModel[]
}

function buildLitellmConfigPayload(input: {
  adapterOverrides: Record<string, string>
  apiKey: string
  baseUrl: string
  defaultModel: string
  defaultReasoningLevel: string
  enabled: boolean
}): AdminLitellmConfigPayload {
  const adapterOverrides = Object.fromEntries(
    Object.entries(input.adapterOverrides).sort(([left], [right]) => left.localeCompare(right)),
  )
  return {
    enabled: input.enabled,
    baseUrl: input.baseUrl,
    defaultModel: input.defaultModel || null,
    defaultReasoningLevel: input.defaultReasoningLevel || null,
    adapterOverrides,
    ...(input.apiKey.trim() ? { apiKey: input.apiKey.trim() } : {}),
  }
}

function serializeLitellmConfigPayload(payload: AdminLitellmConfigPayload): string {
  return JSON.stringify(payload)
}

function validateLitellmDraft(input: LitellmValidationInput): LitellmFieldErrors {
  if (!input.enabled) {
    return {}
  }

  const errors: LitellmFieldErrors = {}
  const trimmedBaseUrl = input.baseUrl.trim()
  if (!trimmedBaseUrl) {
    errors.baseUrl = "Base URL is required to enable LiteLLM."
  } else {
    try {
      const parsed = new URL(trimmedBaseUrl)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        errors.baseUrl = "Base URL must start with http:// or https://."
      }
    } catch {
      errors.baseUrl = "Base URL must be a valid URL."
    }
  }

  if (!input.apiKeyConfigured && !input.apiKeyLocked && !input.apiKey.trim()) {
    errors.apiKey = "API key is required to enable LiteLLM."
  }

  if (input.defaultModel) {
    const selectedModel = input.models.find((model) => model.id === input.defaultModel)
    if (!selectedModel) {
      errors.defaultModel = "Default model must be one of the synced LiteLLM models."
    } else if (
      input.defaultReasoningLevel &&
      !selectedModel.reasoningEfforts.includes(input.defaultReasoningLevel)
    ) {
      errors.defaultReasoningLevel = "Default reasoning must be available for the selected model."
    }
  } else if (input.defaultReasoningLevel) {
    errors.defaultReasoningLevel = "Select a default model before choosing reasoning."
  }

  return errors
}

function hasLitellmFieldErrors(errors: LitellmFieldErrors): boolean {
  return Object.values(errors).some(Boolean)
}

export function AdminAiProviderPanel({
  data,
  loading,
  busy,
  onSave,
  onSaveCloudflareKeys,
  onSync,
  onReset,
  onExport,
  onHeaderActionsChange,
}: {
  data: AdminAiProvidersResponse | null
  loading: boolean
  busy: string | null
  onSave: (payload: AdminLitellmConfigPayload) => Promise<boolean>
  onSaveCloudflareKeys: (payload: AdminCloudflareAiGatewayProviderKeysPayload) => Promise<boolean>
  onSync: () => void
  onReset: () => Promise<boolean>
  onExport: () => Promise<string | null>
  onHeaderActionsChange?: (actions: ReactNode | null) => void
}) {
  const litellm = data?.litellm
  const config = litellm?.config
  const models = useMemo(
    () => Object.values(litellm?.registry?.models ?? {}).sort((a, b) => a.id.localeCompare(b.id)),
    [litellm?.registry?.models],
  )
  const [enabled, setEnabled] = useState(() => config?.enabled ?? false)
  const [baseUrl, setBaseUrl] = useState(() => config?.baseUrl ?? "")
  const [apiKey, setApiKey] = useState("")
  const [defaultModel, setDefaultModel] = useState(() => config?.defaultModel ?? "")
  const [defaultReasoningLevel, setDefaultReasoningLevel] = useState(
    () => config?.defaultReasoningLevel ?? "",
  )
  const [modelThinkingDialogOpen, setModelThinkingDialogOpen] = useState(false)
  const [selectedTocSection, setSelectedTocSection] = useState(getInitialTocSection)
  const [adapterOverrides, setAdapterOverrides] = useState<Record<string, string>>(
    () => config?.adapterOverrides ?? {},
  )
  const [fieldErrors, setFieldErrors] = useState<LitellmFieldErrors>({})
  const [savedFormState, setSavedFormState] = useState<string | null>(null)
  const [savingBeforeNavigation, setSavingBeforeNavigation] = useState(false)
  const [modelRegistryPage, setModelRegistryPage] = useState(1)
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportDotenv, setExportDotenv] = useState<string | null>(null)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [stickySelectPortalContainer, setStickySelectPortalContainer] =
    useState<HTMLElement | null>(null)
  const latestFailureToastKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!config) {
      return
    }
    setEnabled(config.enabled)
    setBaseUrl(config.baseUrl)
    setApiKey("")
    setDefaultModel(config.defaultModel ?? "")
    setDefaultReasoningLevel(config.defaultReasoningLevel ?? "")
    setAdapterOverrides(config.adapterOverrides)
    setFieldErrors({})
    setSavedFormState(
      serializeLitellmConfigPayload(
        buildLitellmConfigPayload({
          adapterOverrides: config.adapterOverrides,
          apiKey: "",
          baseUrl: config.baseUrl,
          defaultModel: config.defaultModel ?? "",
          defaultReasoningLevel: config.defaultReasoningLevel ?? "",
          enabled: config.enabled,
        }),
      ),
    )
  }, [config])

  const litellmModelOptions = useMemo(
    () => buildLitellmDialogModelOptions(models, adapterOverrides),
    [adapterOverrides, models],
  )
  const allLitellmModelOptions = useMemo(
    () => litellmModelOptions.flatMap((group) => group.models),
    [litellmModelOptions],
  )
  const selectedDefaultModelOption =
    allLitellmModelOptions.find((model) => model.modelId === defaultModel) ?? null
  const selectedDefaultModelRuntimeId = selectedDefaultModelOption?.id ?? ""
  const defaultModelLabel = selectedDefaultModelOption?.name ?? defaultModel
  const defaultReasoningLabel = formatAdminReasoningLabel(
    selectedDefaultModelOption,
    defaultReasoningLevel,
  )
  const configLocked = config?.locked ?? false
  const apiKeyLocked = config?.apiKeyLocked ?? false
  const apiKeyConfigured = config?.apiKeyConfigured ?? false
  const registryLocked = litellm?.registryLocked ?? false
  const configLockEnvVar = configLocked ? (config?.envVarName ?? null) : null
  const apiKeyLockEnvVar = apiKeyLocked ? (config?.apiKeyEnvVarName ?? null) : configLockEnvVar
  const registryLockEnvVar =
    configLockEnvVar ?? (registryLocked ? (litellm?.registryEnvVarName ?? null) : null)
  const latestRun = litellm?.cronStatus.latestRun
  const latestRunFailureMessage =
    latestRun?.status === "failure" ? (latestRun.errorMessage ?? null) : null
  const apiKeyDisplayValue = apiKeyLocked
    ? "Configured from environment"
    : configLocked && config?.apiKeyConfigured
      ? "Key configured"
      : apiKey
  const currentPayload = useMemo(
    () =>
      buildLitellmConfigPayload({
        adapterOverrides,
        apiKey,
        baseUrl,
        defaultModel,
        defaultReasoningLevel,
        enabled,
      }),
    [adapterOverrides, apiKey, baseUrl, defaultModel, defaultReasoningLevel, enabled],
  )
  const isDirty = useMemo(() => {
    if (!savedFormState || configLocked) {
      return false
    }
    return serializeLitellmConfigPayload(currentPayload) !== savedFormState
  }, [configLocked, currentPayload, savedFormState])
  const modelRegistryPageCount = Math.max(1, Math.ceil(models.length / MODEL_REGISTRY_PAGE_SIZE))
  const currentModelRegistryPage = Math.min(modelRegistryPage, modelRegistryPageCount)
  const paginatedModels = useMemo(() => {
    const start = (currentModelRegistryPage - 1) * MODEL_REGISTRY_PAGE_SIZE
    return models.slice(start, start + MODEL_REGISTRY_PAGE_SIZE)
  }, [currentModelRegistryPage, models])

  const navigationBlocker = useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: () => isDirty,
    withResolver: true,
  })

  const validateCurrentForm = useCallback(
    (nextEnabled = enabled) =>
      validateLitellmDraft({
        apiKey,
        apiKeyConfigured,
        apiKeyLocked,
        baseUrl,
        defaultModel,
        defaultReasoningLevel,
        enabled: nextEnabled,
        models,
      }),
    [
      apiKey,
      apiKeyConfigured,
      apiKeyLocked,
      baseUrl,
      defaultModel,
      defaultReasoningLevel,
      enabled,
      models,
    ],
  )

  const clearFieldError = useCallback((field: keyof LitellmFieldErrors) => {
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
  }, [])

  const handleEnabledChange = useCallback(
    (nextEnabled: boolean) => {
      if (nextEnabled) {
        const nextErrors = validateCurrentForm(true)
        if (hasLitellmFieldErrors(nextErrors)) {
          setFieldErrors(nextErrors)
          return
        }
      }

      setEnabled(nextEnabled)
      setFieldErrors({})
    },
    [validateCurrentForm],
  )

  const submit = useCallback(async (): Promise<boolean> => {
    const nextErrors = validateCurrentForm()
    if (hasLitellmFieldErrors(nextErrors)) {
      setFieldErrors(nextErrors)
      return false
    }

    const saved = await onSave(currentPayload)
    if (saved) {
      setSavedFormState(
        serializeLitellmConfigPayload(
          buildLitellmConfigPayload({
            adapterOverrides,
            apiKey: "",
            baseUrl,
            defaultModel,
            defaultReasoningLevel,
            enabled,
          }),
        ),
      )
      setApiKey("")
    }
    return saved
  }, [
    adapterOverrides,
    baseUrl,
    currentPayload,
    defaultModel,
    defaultReasoningLevel,
    enabled,
    onSave,
    validateCurrentForm,
  ])

  const saveBeforeNavigation = useCallback(async () => {
    if (navigationBlocker.status !== "blocked") {
      return
    }

    setSavingBeforeNavigation(true)
    try {
      const saved = await submit()
      if (saved) {
        navigationBlocker.proceed()
      }
    } finally {
      setSavingBeforeNavigation(false)
    }
  }, [navigationBlocker, submit])

  useEffect(() => {
    if (!onHeaderActionsChange) {
      return
    }

    onHeaderActionsChange(
      isDirty ? (
        <Button
          type="button"
          variant="primary"
          onClick={() => void submit()}
          disabled={busy !== null || loading}
          loading={busy === "litellm-save"}
          icon={<Save className="h-4 w-4" aria-hidden />}
        >
          Save
        </Button>
      ) : null,
    )
  }, [busy, isDirty, loading, onHeaderActionsChange, submit])

  useEffect(() => {
    return () => {
      onHeaderActionsChange?.(null)
    }
  }, [onHeaderActionsChange])

  useEffect(() => {
    if (modelRegistryPage !== currentModelRegistryPage) {
      setModelRegistryPage(currentModelRegistryPage)
    }
  }, [currentModelRegistryPage, modelRegistryPage])

  useLayoutEffect(() => {
    setStickySelectPortalContainer(getStickySelectPortalRoot())
  }, [])

  useEffect(() => {
    if (!latestRun || latestRun.status !== "failure" || !latestRunFailureMessage) {
      return
    }
    if (latestFailureToastKeyRef.current === latestRun.id) {
      return
    }
    latestFailureToastKeyRef.current = latestRun.id
    showErrorToast("LiteLLM model sync failed", {
      description: latestRunFailureMessage,
      timeout: 12000,
    })
  }, [latestRun, latestRunFailureMessage])

  const handleDefaultModelSelect = useCallback(
    (runtimeModelId: string) => {
      const nextModel = allLitellmModelOptions.find((model) => model.id === runtimeModelId)
      if (!nextModel) {
        return
      }
      setDefaultModel(nextModel.modelId)
      clearFieldError("defaultModel")
      clearFieldError("defaultReasoningLevel")
      setDefaultReasoningLevel(
        nextModel.reasoning?.default ?? nextModel.reasoning?.efforts[0] ?? "",
      )
    },
    [allLitellmModelOptions, clearFieldError],
  )

  const handleDefaultReasoningSelect = useCallback(
    (value: string | undefined) => {
      setDefaultReasoningLevel(value ?? "")
      clearFieldError("defaultReasoningLevel")
    },
    [clearFieldError],
  )

  const handleExportConfig = useCallback(async () => {
    setActionsMenuOpen(false)
    const dotenv = await onExport()
    if (dotenv === null) {
      return
    }
    setExportDotenv(dotenv)
    setExportDialogOpen(true)
  }, [onExport])

  const handleResetConfig = useCallback(() => {
    setActionsMenuOpen(false)
    setResetConfirmOpen(true)
  }, [])

  const handleConfirmResetConfig = useCallback(async () => {
    const reset = await onReset()
    if (reset) {
      setResetConfirmOpen(false)
      setExportDialogOpen(false)
      setExportDotenv(null)
    }
  }, [onReset])

  const sectionOptions = useMemo<
    Array<{ value: TocSectionValue; label: string; depth: 0 | 1 }>
  >(() => {
    const options: Array<{
      value: TocSectionValue
      label: string
      depth: 0 | 1
    }> = [
      { value: "#litellm-provider", label: "LiteLLM", depth: 0 },
      { value: "#litellm-settings", label: "Settings", depth: 1 },
    ]
    options.push(
      { value: "#litellm-model-registry", label: "Model Registry", depth: 1 },
      {
        value: "#cloudflare-ai-gateway-provider",
        label: "Cloudflare AI Gateway",
        depth: 0,
      },
      { value: "#cloudflare-ai-gateway-settings", label: "Settings", depth: 1 },
      { value: "#cloudflare-ai-gateway-models", label: "Models", depth: 1 },
    )
    return options
  }, [])
  const selectedTocValue = sectionOptions.some((section) => section.value === selectedTocSection)
    ? selectedTocSection
    : DEFAULT_TOC_SECTION

  useEffect(() => {
    const sectionValues = sectionOptions.map((section) => section.value)
    let animationFrame = 0

    const isVisibleSection = (value: string): value is TocSectionValue =>
      sectionValues.includes(value as TocSectionValue)

    const updateFromHash = () => {
      const nextSection = window.location.hash
      if (isVisibleSection(nextSection)) {
        setSelectedTocSection(nextSection)
      }
    }

    const updateFromScroll = () => {
      if (animationFrame) {
        return
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0
        const pendingSection = getPendingAdminSectionHash()
        if (pendingSection) {
          if (isVisibleSection(pendingSection)) {
            setSelectedTocSection(pendingSection)
          }
          return
        }
        let activeSection = sectionValues[0] ?? DEFAULT_TOC_SECTION
        for (const sectionValue of sectionValues) {
          const section = document.getElementById(sectionValue.slice(1))
          if (section && section.getBoundingClientRect().top <= 128) {
            activeSection = sectionValue
          }
        }
        setSelectedTocSection(activeSection)
      })
    }

    updateFromHash()
    updateFromScroll()
    window.addEventListener("hashchange", updateFromHash)
    window.addEventListener("resize", updateFromScroll)
    window.addEventListener("scroll", updateFromScroll, true)
    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }
      window.removeEventListener("hashchange", updateFromHash)
      window.removeEventListener("resize", updateFromScroll)
      window.removeEventListener("scroll", updateFromScroll, true)
    }
  }, [sectionOptions])

  const navigateToSection = (value: TocSectionValue) => {
    setSelectedTocSection(value)
    navigateToAdminSection(value)
  }

  const tocItemClickHandler = (value: TocSectionValue) => (event: MouseEvent) => {
    event.preventDefault()
    navigateToSection(value)
  }

  // TableOfContents.Group spreads props onto its <li>, so clicks from nested
  // items bubble here too. Only navigate when the group link itself was hit.
  const tocGroupClickHandler = (value: TocSectionValue) => (event: MouseEvent) => {
    const target = event.target as HTMLElement
    if (!target.closest('a[data-kumo-part="group-link"]')) {
      return
    }
    event.preventDefault()
    navigateToSection(value)
  }

  return (
    <TooltipProvider>
      <div className="space-y-12">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight text-kumo-default">AI Providers</h1>
          <p className="max-w-3xl text-lg text-kumo-strong">
            Model provider configuration and registries for agents and workflows.
          </p>
        </div>

        <div className="sticky top-0 z-20 -mx-12 border-b border-kumo-hairline bg-kumo-canvas/95 px-12 py-3 backdrop-blur xl:hidden">
          <KumoSelect
            aria-label="AI Provider sections"
            value={selectedTocValue}
            container={stickySelectPortalContainer ?? undefined}
            onValueChange={(value) => {
              const nextValue = String(value ?? "")
              if (isTocSectionValue(nextValue)) {
                navigateToSection(nextValue)
              }
            }}
            renderValue={(value) =>
              sectionOptions.find((section) => section.value === value)?.label ?? "LiteLLM"
            }
            className="w-full"
          >
            {sectionOptions.map((section) => (
              <KumoSelect.Option key={section.value} value={section.value}>
                <span className={section.depth === 1 ? "block pl-4" : "block"}>
                  {section.label}
                </span>
              </KumoSelect.Option>
            ))}
          </KumoSelect>
        </div>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="min-w-0 space-y-12">
            <section className="space-y-10">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <DocsSectionHeading id="litellm-provider" level="h2" title="LiteLLM" />
                <div className="flex items-center gap-2">
                  <DropdownMenu open={actionsMenuOpen} onOpenChange={setActionsMenuOpen}>
                    <DropdownMenu.Trigger>
                      <Button
                        type="button"
                        shape="circle"
                        variant="ghost"
                        disabled={busy !== null || loading}
                        loading={busy === "litellm-export" || busy === "litellm-reset"}
                        aria-label="LiteLLM configuration actions"
                        title="LiteLLM configuration actions"
                        icon={<MoreVertical className="h-4 w-4" aria-hidden />}
                      />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content side="bottom" align="end">
                      <DropdownMenu.Item
                        icon={<FileCode2 className="h-4 w-4 mr-2" aria-hidden />}
                        disabled={busy !== null || loading}
                        onClick={() => void handleExportConfig()}
                      >
                        Export config
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        icon={<RotateCcw className="h-4 w-4 mr-2" aria-hidden />}
                        variant="danger"
                        disabled={busy !== null || loading}
                        onClick={() => void handleResetConfig()}
                      >
                        Reset config
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu>
                  <EnvLockIcon envVarName={configLockEnvVar} />
                  <Switch
                    aria-label="Enabled"
                    checked={enabled}
                    onCheckedChange={handleEnabledChange}
                    size="sm"
                    disabled={configLocked}
                  />
                </div>
              </div>

              <div className="space-y-5 max-w-2xl">
                <DocsSectionHeading id="litellm-settings" level="h3" title="Settings" />
                <div className="space-y-5">
                  <Field
                    label="Base URL"
                    value={baseUrl}
                    onChange={(value) => {
                      setBaseUrl(value)
                      clearFieldError("baseUrl")
                    }}
                    disabled={configLocked}
                    disabledEnvVarName={configLockEnvVar}
                    error={fieldErrors.baseUrl}
                    required={enabled}
                  />
                  <Field
                    label={
                      apiKeyLocked ? "API key" : apiKeyConfigured ? "Replace API key" : "API key"
                    }
                    value={apiKeyDisplayValue}
                    onChange={(value) => {
                      setApiKey(value)
                      clearFieldError("apiKey")
                    }}
                    placeholder={
                      apiKeyLocked
                        ? "Configured from environment"
                        : apiKeyConfigured
                          ? "Key configured"
                          : "LiteLLM key"
                    }
                    type={apiKeyLocked ? "text" : "password"}
                    disabled={configLocked || apiKeyLocked}
                    disabledEnvVarName={apiKeyLockEnvVar}
                    error={fieldErrors.apiKey}
                    required={enabled && !apiKeyConfigured && !apiKeyLocked}
                  />
                  <ModelThinkingField
                    label="Default model and reasoning"
                    modelLabel={defaultModelLabel}
                    reasoningLabel={defaultReasoningLabel}
                    placeholder={models.length === 0 ? "No models synced" : "Select model"}
                    disabled={configLocked || models.length === 0}
                    disabledEnvVarName={configLocked ? configLockEnvVar : null}
                    error={fieldErrors.defaultModel ?? fieldErrors.defaultReasoningLevel}
                    onClick={() => setModelThinkingDialogOpen(true)}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <DocsSectionHeading
                  id="litellm-model-registry"
                  level="h3"
                  title="Model Registry"
                  trailing={
                    registryLocked ? (
                      <EnvLockIcon envVarName={registryLockEnvVar} />
                    ) : (
                      <div className="flex items-center gap-2">
                        <LitellmSyncStatusIndicator
                          latestFailure={litellm?.cronStatus.latestFailure}
                          latestRun={litellm?.cronStatus.latestRun}
                          latestSuccess={litellm?.cronStatus.latestSuccess}
                        />
                        <Button
                          type="button"
                          onClick={onSync}
                          disabled={busy !== null || !config?.enabled || !config.apiKeyConfigured}
                          loading={busy === "litellm-sync"}
                          variant="secondary"
                          icon={<RefreshCw className="h-4 w-4" aria-hidden />}
                        >
                          Sync Models
                        </Button>
                      </div>
                    )
                  }
                />
                <div className="overflow-auto rounded-lg bg-kumo-elevated/80 [container-type:inline-size]">
                  <KumoTable layout="fixed" className="min-w-[760px] text-sm">
                    <colgroup>
                      <col className="w-[45%]" />
                      <col className="w-[16%]" />
                      <col />
                    </colgroup>
                    <KumoTable.Header variant="compact" className="text-kumo-subtle!">
                      <KumoTable.Row>
                        <KumoTable.Head>Model</KumoTable.Head>
                        <KumoTable.Head>Reasoning</KumoTable.Head>
                        <KumoTable.Head>Adapter</KumoTable.Head>
                      </KumoTable.Row>
                    </KumoTable.Header>
                    <KumoTable.Body>
                      {models.length === 0 ? (
                        <KumoTable.Row>
                          <KumoTable.Cell colSpan={3} className="h-32 text-kumo-subtle">
                            <TableCellState className="h-full">
                              {loading ? <S0Loader size={32} /> : "No LiteLLM models synced."}
                            </TableCellState>
                          </KumoTable.Cell>
                        </KumoTable.Row>
                      ) : (
                        paginatedModels.map((model) => (
                          <ModelAdapterRow
                            key={model.id}
                            model={model}
                            adapter={adapterOverrides[model.id] ?? model.defaultAdapter}
                            overridden={Boolean(adapterOverrides[model.id])}
                            disabled={configLocked}
                            onChange={(adapter) =>
                              setAdapterOverrides((current) => ({
                                ...current,
                                [model.id]: adapter,
                              }))
                            }
                            onReset={() =>
                              setAdapterOverrides((current) => {
                                const next = { ...current }
                                delete next[model.id]
                                return next
                              })
                            }
                          />
                        ))
                      )}
                    </KumoTable.Body>
                  </KumoTable>
                </div>
                {models.length > 0 ? (
                  <Pagination
                    page={currentModelRegistryPage}
                    setPage={(page) => {
                      setModelRegistryPage(Math.min(Math.max(page, 1), modelRegistryPageCount))
                    }}
                    perPage={MODEL_REGISTRY_PAGE_SIZE}
                    totalCount={models.length}
                    className="justify-between"
                  >
                    <Pagination.Info />
                    <Pagination.Separator />
                    <Pagination.Controls controls="simple" />
                  </Pagination>
                ) : null}
              </div>
            </section>

            <AdminCloudflareAiGatewayPanel
              data={data?.cloudflareAiGateway}
              saving={busy === "cloudflare-ai-gateway-keys-save"}
              onSave={onSaveCloudflareKeys}
            />
          </div>

          <TableOfContents className="hidden xl:sticky xl:top-4 xl:block xl:self-start xl:pl-6">
            <TableOfContents.Title>On this page</TableOfContents.Title>
            <TableOfContents.List>
              <TableOfContents.Group
                label="LiteLLM"
                href="#litellm-provider"
                active={selectedTocValue === "#litellm-provider"}
                onClick={tocGroupClickHandler("#litellm-provider")}
              >
                <TableOfContents.Item
                  href="#litellm-settings"
                  active={selectedTocValue === "#litellm-settings"}
                  onClick={tocItemClickHandler("#litellm-settings")}
                >
                  Settings
                </TableOfContents.Item>
                <TableOfContents.Item
                  href="#litellm-model-registry"
                  active={selectedTocValue === "#litellm-model-registry"}
                  onClick={tocItemClickHandler("#litellm-model-registry")}
                >
                  Model Registry
                </TableOfContents.Item>
              </TableOfContents.Group>
              <TableOfContents.Group
                label="Cloudflare AI Gateway"
                href="#cloudflare-ai-gateway-provider"
                active={selectedTocValue === "#cloudflare-ai-gateway-provider"}
                onClick={tocGroupClickHandler("#cloudflare-ai-gateway-provider")}
              >
                <TableOfContents.Item
                  href="#cloudflare-ai-gateway-settings"
                  active={selectedTocValue === "#cloudflare-ai-gateway-settings"}
                  onClick={tocItemClickHandler("#cloudflare-ai-gateway-settings")}
                >
                  Settings
                </TableOfContents.Item>
                <TableOfContents.Item
                  href="#cloudflare-ai-gateway-models"
                  active={selectedTocValue === "#cloudflare-ai-gateway-models"}
                  onClick={tocItemClickHandler("#cloudflare-ai-gateway-models")}
                >
                  Models
                </TableOfContents.Item>
              </TableOfContents.Group>
            </TableOfContents.List>
          </TableOfContents>
        </div>

        {modelThinkingDialogOpen ? (
          <ModelThinkingDialog
            modelOptions={litellmModelOptions}
            selectedModel={selectedDefaultModelRuntimeId}
            selectedModelOption={selectedDefaultModelOption}
            reasoningEffort={defaultReasoningLevel || undefined}
            onModelSelect={handleDefaultModelSelect}
            onReasoningSelect={handleDefaultReasoningSelect}
            onClose={() => setModelThinkingDialogOpen(false)}
          />
        ) : null}

        {exportDotenv !== null ? (
          <CodeSurface
            title="LiteLLM deployment configuration"
            description="Merge the JSONC fragment into the active stage config file and place any separate secret assignment in the stage environment."
            value={exportDotenv}
            language="text"
            open={exportDialogOpen}
            onOpenChange={setExportDialogOpen}
            trigger={() => null}
          />
        ) : null}

        <LitellmResetConfigDialog
          open={resetConfirmOpen}
          resetting={busy === "litellm-reset"}
          confirmDisabled={busy !== null && busy !== "litellm-reset"}
          onOpenChange={(open) => {
            if (busy === "litellm-reset") {
              return
            }
            setResetConfirmOpen(open)
          }}
          onCancel={() => setResetConfirmOpen(false)}
          onConfirm={() => void handleConfirmResetConfig()}
        />

        {navigationBlocker.status === "blocked" ? (
          <UnsavedChangesModal
            saving={savingBeforeNavigation || busy === "litellm-save"}
            description="LiteLLM provider settings have unsaved changes. Save before leaving, or continue without saving."
            onSave={() => void saveBeforeNavigation()}
            onLeave={navigationBlocker.proceed}
            onCancel={navigationBlocker.reset}
          />
        ) : null}
      </div>
    </TooltipProvider>
  )
}

function getInitialTocSection(): TocSectionValue {
  if (typeof window === "undefined") {
    return DEFAULT_TOC_SECTION
  }
  return isTocSectionValue(window.location.hash) ? window.location.hash : DEFAULT_TOC_SECTION
}

function isTocSectionValue(value: string): value is TocSectionValue {
  return TOC_SECTION_VALUES.includes(value as TocSectionValue)
}

function buildLitellmDialogModelOptions(
  models: AdminLitellmModel[],
  adapterOverrides: Record<string, string>,
): RuntimeModelCategory[] {
  const groups: RuntimeModelCategory[] = [
    { category: LITELLM_PROVIDER_NAME, providerId: LITELLM_PROVIDER_ID, models: [] },
    {
      category: LITELLM_ANTHROPIC_PROVIDER_NAME,
      providerId: LITELLM_ANTHROPIC_PROVIDER_ID,
      models: [],
    },
  ]

  for (const model of models) {
    const effectiveAdapter = adapterOverrides[model.id] ?? model.defaultAdapter
    const group = effectiveAdapter === "@ai-sdk/anthropic" ? groups[1] : groups[0]
    const reasoningEfforts = model.reasoningEfforts.filter(isReasoningEffort)
    const defaultReasoningLevel =
      model.defaultReasoningLevel && isReasoningEffort(model.defaultReasoningLevel)
        ? model.defaultReasoningLevel
        : undefined
    const reasoning =
      reasoningEfforts.length > 0
        ? {
            efforts: reasoningEfforts,
            ...(defaultReasoningLevel ? { default: defaultReasoningLevel } : {}),
          }
        : undefined

    group.models.push({
      id: buildModelId(group.providerId, model.id),
      providerId: group.providerId,
      providerName: group.category,
      modelId: model.id,
      name: model.id,
      ...(reasoning ? { reasoning } : {}),
    })
  }

  return groups.filter((group) => group.models.length > 0)
}

function formatAdminReasoningLabel(
  selectedModelOption: RuntimeProviderModelOption | null,
  reasoningLevel: string,
): string | undefined {
  if (!selectedModelOption) {
    return undefined
  }

  const resolvedReasoning = reasoningLevel || selectedModelOption.reasoning?.default
  if (!selectedModelOption.reasoning || !resolvedReasoning) {
    return "Provider default"
  }

  return `${formatReasoningEffortLabel(resolvedReasoning)} thinking`
}

function isReasoningEffort(value: string): value is ReasoningEffort {
  return REASONING_EFFORT_VALUES.has(value)
}
