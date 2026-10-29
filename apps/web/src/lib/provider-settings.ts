import type { ProviderSettingsResponse, ProviderSettingsUpdatePayload } from "@solzero/shared"
import { runApi } from "@/lib/api-client"

export function fetchProviderSettings(init?: {
  signal?: AbortSignal
}): Promise<ProviderSettingsResponse> {
  return runApi((client) => client.providers.list(), {
    signal: init?.signal,
    fallbackMessage: "Failed to load provider settings",
  })
}

export function saveProviderSettings(
  input: ProviderSettingsUpdatePayload,
): Promise<ProviderSettingsResponse> {
  return runApi((client) => client.providers.replace({ payload: input }), {
    fallbackMessage: "Failed to save provider settings",
  })
}
