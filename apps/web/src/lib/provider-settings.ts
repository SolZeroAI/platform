import type { ProviderSettingsResponse, ProviderSettingsUpdatePayload } from "@c0-agent/shared"

type ProviderSettingsErrorPayload = {
  error?: unknown
  message?: unknown
  detail?: unknown
}

async function readResponseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) {
    return null
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function getResponseErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const record = payload as ProviderSettingsErrorPayload
    for (const value of [record.error, record.message, record.detail]) {
      if (typeof value === "string" && value.trim().length > 0) {
        return value
      }
    }
  }
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload
  }
  return fallback
}

export async function fetchProviderSettings(init?: RequestInit): Promise<ProviderSettingsResponse> {
  const response = await fetch("/api/providers", {
    credentials: "include",
    ...init,
  })
  const payload = await readResponseJson(response)
  if (!response.ok) {
    throw new Error(getResponseErrorMessage(payload, "Failed to load provider settings"))
  }
  return payload as ProviderSettingsResponse
}

export async function saveProviderSettings(
  input: ProviderSettingsUpdatePayload,
): Promise<ProviderSettingsResponse> {
  const response = await fetch("/api/providers", {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  })
  const payload = await readResponseJson(response)
  if (!response.ok) {
    throw new Error(getResponseErrorMessage(payload, "Failed to save provider settings"))
  }
  return payload as ProviderSettingsResponse
}
