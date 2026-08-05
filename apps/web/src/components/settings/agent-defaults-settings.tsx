"use client"

import { Banner } from "@cloudflare/kumo/components/banner"
import { Button } from "@cloudflare/kumo/components/button"
import { Input } from "@cloudflare/kumo/components/input"
import {
  DEFAULT_ISOLATE_STEP_LIMIT,
  MAX_ISOLATE_STEP_LIMIT,
  MIN_ISOLATE_STEP_LIMIT,
  normalizeIsolateStepLimit,
  type ProviderSettingsUpdatePayload,
} from "@solzero/shared"
import { useBlocker } from "@tanstack/react-router"
import { Box, Save } from "lucide-react"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { UnsavedChangesModal } from "@/components/unsaved-changes-modal"
import { useProviderSettings } from "@/hooks/use-provider-settings"
import { SettingsDocsLayout, SettingsDocsSectionHeading } from "./settings-docs-layout"

const AGENT_DEFAULTS_TOC_ITEMS = [
  { id: "isolate-defaults", label: "Isolate" },
  { id: "isolate-step-limit", label: "Step call limit", depth: 1 },
] as const

function serializeAgentDefaultsFormState(stepLimit: string): string {
  let normalizedStepLimit: string
  const parsedStepLimit = Number(stepLimit)
  if (Number.isFinite(parsedStepLimit)) {
    normalizedStepLimit = String(normalizeIsolateStepLimit(parsedStepLimit))
  } else {
    normalizedStepLimit = stepLimit.trim()
  }

  return normalizedStepLimit
}

function AgentTypeSection({
  id,
  title,
  description,
  icon,
  accentClassName,
  children,
}: {
  id: string
  title: string
  description: ReactNode
  icon: ReactNode
  accentClassName: string
  children: ReactNode
}) {
  return (
    <section className="space-y-6">
      <SettingsDocsSectionHeading
        id={id}
        level="h2"
        title={title}
        leading={
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ${accentClassName}`}
            aria-hidden
          >
            {icon}
          </span>
        }
      >
        <div className="text-sm leading-relaxed text-kumo-subtle">{description}</div>
      </SettingsDocsSectionHeading>
      <div className="space-y-6">{children}</div>
    </section>
  )
}

export function AgentDefaultsSettings({
  onHeaderActionsChange,
}: {
  onHeaderActionsChange?: (actions: ReactNode | null) => void
}) {
  const { catalog, settings, loading, saving, error, save } = useProviderSettings()
  const [stepLimit, setStepLimit] = useState(String(DEFAULT_ISOLATE_STEP_LIMIT))
  const [savedFormState, setSavedFormState] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [savingBeforeNavigation, setSavingBeforeNavigation] = useState(false)

  const isDirty = useMemo(() => {
    if (!savedFormState) {
      return false
    }
    return serializeAgentDefaultsFormState(stepLimit) !== savedFormState
  }, [savedFormState, stepLimit])

  const navigationBlocker = useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: () => isDirty,
    withResolver: true,
  })

  useEffect(() => {
    if (!settings) {
      return
    }
    const nextStepLimit = String(normalizeIsolateStepLimit(settings.defaultIsolateStepLimit))
    setStepLimit(nextStepLimit)
    setSavedFormState(serializeAgentDefaultsFormState(nextStepLimit))
    setSaveError(null)
    setSaveSuccess(null)
  }, [settings])

  const handleSave = useCallback(async (): Promise<boolean> => {
    setSaveError(null)
    setSaveSuccess(null)

    const parsedStepLimit = Number(stepLimit)
    if (
      !Number.isFinite(parsedStepLimit) ||
      parsedStepLimit < MIN_ISOLATE_STEP_LIMIT ||
      parsedStepLimit > MAX_ISOLATE_STEP_LIMIT
    ) {
      setSaveError(
        `Default step call limit must be between ${MIN_ISOLATE_STEP_LIMIT} and ${MAX_ISOLATE_STEP_LIMIT}`,
      )
      return false
    }
    if (!catalog || !settings) {
      return false
    }
    const sharedProvidersById = new Map(
      catalog.providers.map((provider) => [provider.providerId, provider] as const),
    )
    const payload: ProviderSettingsUpdatePayload = {
      defaultModel: settings.defaultModel,
      defaultIsolateStepLimit: normalizeIsolateStepLimit(parsedStepLimit),
      sharedOverrides: settings.sharedOverrides.map((override) => ({
        providerId: override.providerId,
        displayName:
          override.displayName ??
          sharedProvidersById.get(override.providerId)?.name ??
          override.providerId,
      })),
      customProviders: settings.customProviders.map((provider) => ({
        providerId: provider.providerId,
        name: provider.name,
        ...(provider.npm ? { npm: provider.npm } : {}),
        ...(provider.options ? { options: provider.options } : {}),
        models: provider.models,
      })),
    }

    try {
      await save(payload)
      setSaveSuccess("Agent defaults updated")
      return true
    } catch (errorValue) {
      setSaveError(errorValue instanceof Error ? errorValue.message : String(errorValue))
      return false
    }
  }, [catalog, save, settings, stepLimit])

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
      <Button
        type="button"
        variant="primary"
        onClick={() => void handleSave()}
        disabled={saving || !isDirty}
        loading={saving}
        icon={<Save className="h-4 w-4" aria-hidden />}
      >
        Save
      </Button>,
    )
  }, [handleSave, isDirty, onHeaderActionsChange, saving])

  useEffect(() => {
    return () => {
      onHeaderActionsChange?.(null)
    }
  }, [onHeaderActionsChange])

  if (loading || !settings) {
    return (
      <SettingsDocsLayout
        title="Agents"
        titleId="settings-agents"
        description="Configure defaults that apply to new agent sessions."
        tocItems={AGENT_DEFAULTS_TOC_ITEMS}
      >
        <p className="text-sm text-kumo-subtle">Loading agent defaults...</p>
      </SettingsDocsLayout>
    )
  }

  return (
    <SettingsDocsLayout
      title="Agents"
      titleId="settings-agents"
      description="Configure defaults that apply to new agent sessions."
      tocItems={AGENT_DEFAULTS_TOC_ITEMS}
    >
      {(error || saveError) && (
        <Banner variant="error" description={saveError || error} className="mb-4" />
      )}
      {saveSuccess && <Banner variant="secondary" description={saveSuccess} className="mb-4" />}

      <AgentTypeSection
        id="isolate-defaults"
        title="Isolate"
        description="Fast-starting agent sessions with a virtual file system and emulated shell tools."
        icon={<Box className="h-4 w-4" />}
        accentClassName="bg-kumo-info-tint text-kumo-info ring-kumo-info/30"
      >
        <div className="space-y-3">
          <SettingsDocsSectionHeading id="isolate-step-limit" level="h3" title="Step call limit" />
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <label
                htmlFor="default-isolate-step-limit"
                className="text-sm font-medium text-kumo-default"
              >
                Default isolate step limit
              </label>
              <p className="mt-1 text-sm text-kumo-subtle">Default for future isolate sessions</p>
            </div>
            <Input
              id="default-isolate-step-limit"
              type="number"
              min={MIN_ISOLATE_STEP_LIMIT}
              max={MAX_ISOLATE_STEP_LIMIT}
              step={1}
              value={stepLimit}
              onChange={(event) => setStepLimit(event.target.value)}
              className="w-28 tabular-nums"
              aria-label="Default isolate step call limit"
            />
          </div>
        </div>
      </AgentTypeSection>

      {navigationBlocker.status === "blocked" ? (
        <UnsavedChangesModal
          saving={savingBeforeNavigation || saving}
          description="Agent defaults have unsaved changes. Save before leaving, or continue without saving."
          onSave={() => void saveBeforeNavigation()}
          onLeave={navigationBlocker.proceed}
          onCancel={navigationBlocker.reset}
        />
      ) : null}
    </SettingsDocsLayout>
  )
}
