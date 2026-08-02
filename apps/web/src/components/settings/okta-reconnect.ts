export type OktaReconnectStatus = "1" | "complete" | "error"

export const OKTA_RECONNECT_SETTINGS_HASH = "okta-access"

export function parseOktaReconnectStatus(value: unknown): OktaReconnectStatus | undefined {
  return value === "1" || value === "complete" || value === "error" ? value : undefined
}

export function buildOktaReconnectSettingsPath(
  status: OktaReconnectStatus = "1",
  options: { hash?: boolean } = {},
): string {
  const params = new URLSearchParams({
    category: "api-access",
    oktaReconnect: status,
  })
  const path = `/settings?${params.toString()}`
  return options.hash === false ? path : `${path}#${OKTA_RECONNECT_SETTINGS_HASH}`
}

export function buildOktaReconnectSessionPath(
  sessionId: string,
  status: Exclude<OktaReconnectStatus, "1">,
  options: { resumeMessageId?: string | null } = {},
): string {
  const params = new URLSearchParams({
    oktaReconnect: status,
  })
  const resumeMessageId = options.resumeMessageId?.trim()
  if (resumeMessageId) {
    params.set("resumeMessageId", resumeMessageId)
  }
  return `/session/${encodeURIComponent(sessionId)}?${params.toString()}`
}

export function resolveOAuthCallbackError(
  error: string | null | undefined,
  errorDescription?: string | null | undefined,
): string | undefined {
  const description = errorDescription?.trim()
  if (description) {
    return description
  }

  const code = error?.trim()
  return code || undefined
}

export function formatOktaReconnectError(statusError: string | null | undefined): string {
  const normalizedError = statusError?.trim()
  return normalizedError
    ? `Okta authentication did not complete: ${normalizedError}.`
    : "Okta authentication did not complete."
}
