export type SlackLinkStatus = "complete" | "error"

export function normalizeSlackUserId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

export function parseSlackLinkStatus(value: unknown): SlackLinkStatus | undefined {
  return value === "complete" || value === "error" ? value : undefined
}

export function buildSlackLinkSettingsPath(
  slackUserId: string | null | undefined,
  status?: SlackLinkStatus,
): string {
  const params = new URLSearchParams()
  const normalizedSlackUserId = normalizeSlackUserId(slackUserId)
  if (normalizedSlackUserId) {
    params.set("slackUserId", normalizedSlackUserId)
  }
  if (status) {
    params.set("slackLink", status)
  }

  const query = params.toString()
  return query ? `/settings?${query}` : "/settings"
}

export function formatSlackLinkError(statusError: string | null | undefined): string {
  const normalizedError = statusError?.trim()
  return normalizedError
    ? `Slack authorization did not complete: ${normalizedError}.`
    : "Slack authorization did not complete."
}
