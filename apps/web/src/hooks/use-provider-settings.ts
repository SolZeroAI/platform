"use client"

import { createContext, createElement, useCallback, useContext, useEffect, useState } from "react"
import type { ProviderSettingsResponse, ProviderSettingsUpdatePayload } from "@c0-agent/shared"
import { fetchProviderSettings, saveProviderSettings } from "@/lib/provider-settings"

type ProviderSettingsListener = (data: ProviderSettingsResponse) => void

let providerSettingsCache: ProviderSettingsResponse | null = null
const providerSettingsListeners = new Set<ProviderSettingsListener>()
const InitialProviderSettingsContext = createContext<ProviderSettingsResponse | null>(null)

export function ProviderSettingsProvider({
  children,
  initialData,
}: {
  children: React.ReactNode
  initialData: ProviderSettingsResponse | null
}) {
  return createElement(InitialProviderSettingsContext.Provider, { value: initialData }, children)
}

function publishProviderSettings(data: ProviderSettingsResponse) {
  providerSettingsCache = data
  for (const listener of providerSettingsListeners) {
    listener(data)
  }
}

export function useProviderSettings({
  initialData = null,
}: { initialData?: ProviderSettingsResponse | null } = {}) {
  const shellInitialData = useContext(InitialProviderSettingsContext)
  const resolvedInitialData = initialData ?? shellInitialData
  const [data, setData] = useState<ProviderSettingsResponse | null>(
    () => providerSettingsCache ?? resolvedInitialData,
  )
  const [loading, setLoading] = useState(!(providerSettingsCache ?? resolvedInitialData))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async ({ showLoading = true }: { showLoading?: boolean } = {}) => {
    if (showLoading) {
      setLoading(true)
      setError(null)
    }

    try {
      publishProviderSettings(await fetchProviderSettings())
      setError(null)
    } catch (errorValue) {
      if (showLoading) {
        setError(errorValue instanceof Error ? errorValue.message : String(errorValue))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const save = useCallback(async (input: ProviderSettingsUpdatePayload) => {
    setSaving(true)
    setError(null)

    try {
      const nextData = await saveProviderSettings(input)
      publishProviderSettings(nextData)
      return nextData
    } catch (errorValue) {
      const message = errorValue instanceof Error ? errorValue.message : String(errorValue)
      setError(message)
      throw errorValue
    } finally {
      setSaving(false)
    }
  }, [])

  useEffect(() => {
    const listener: ProviderSettingsListener = (nextData) => {
      setData(nextData)
      setLoading(false)
      setError(null)
    }
    providerSettingsListeners.add(listener)
    return () => {
      providerSettingsListeners.delete(listener)
    }
  }, [])

  useEffect(() => {
    if (resolvedInitialData && !providerSettingsCache) {
      publishProviderSettings(resolvedInitialData)
    }
  }, [resolvedInitialData])

  useEffect(() => {
    void refresh({ showLoading: !(providerSettingsCache ?? resolvedInitialData) })
  }, [refresh, resolvedInitialData])

  return {
    data,
    catalog: data?.catalog ?? null,
    settings: data?.settings ?? null,
    loading,
    saving,
    error,
    refresh,
    save,
  }
}
