import type { AppStageMetadata } from "@solzero/shared"

function normalizeNonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function getAppStage(): string {
  const stage = normalizeNonEmpty(import.meta.env.VITE_STAGE)
  if (!stage) {
    throw new Error("VITE_STAGE is not configured in the web app environment.")
  }
  return stage
}

export function getAppVersion(): string {
  return normalizeNonEmpty(import.meta.env.VITE_APP_VERSION) ?? "v0.0.0-unknown"
}

function configuredBoolean(name: string, value: string | undefined): boolean {
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`${name} must be configured as either "true" or "false".`)
}

function configuredPositiveNumber(name: string, value: string | undefined): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${name} must be configured as a positive number.`)
  }
  return number
}

export function getAppStageMetadata(): AppStageMetadata {
  const logLevel = import.meta.env.VITE_S0_LOG_LEVEL
  if (logLevel !== "trace" && logLevel !== "debug") {
    throw new Error('VITE_S0_LOG_LEVEL must be configured as either "trace" or "debug".')
  }
  return {
    name: getAppStage(),
    app: {
      logLevel,
      sendSlackNotifications: false,
      slackChannel: "",
      showTestErrorButton: configuredBoolean(
        "VITE_S0_SHOW_TEST_ERROR_BUTTON",
        import.meta.env.VITE_S0_SHOW_TEST_ERROR_BUTTON,
      ),
      betterAuthSessionTransferEnabled: configuredBoolean(
        "VITE_S0_BETTER_AUTH_SESSION_TRANSFER_ENABLED",
        import.meta.env.VITE_S0_BETTER_AUTH_SESSION_TRANSFER_ENABLED,
      ),
      sandboxInactivityTimeoutMs: configuredPositiveNumber(
        "VITE_S0_SANDBOX_INACTIVITY_TIMEOUT_MS",
        import.meta.env.VITE_S0_SANDBOX_INACTIVITY_TIMEOUT_MS,
      ),
    },
  }
}

export function getWebSocketOrigin(): string {
  if (typeof window === "undefined") {
    throw new Error("WebSocket origin can only be resolved in the browser.")
  }

  const websocketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${websocketProtocol}//${window.location.host}/api`
}
