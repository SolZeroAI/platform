import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import type { ProviderSettingsResponse, PublicAuthProviderRegistry } from "@solzero/shared"
import { getAuthSessionContext, type AuthSessionContext } from "@/lib/auth-session"
import { getControlPlaneHeaders, getControlPlaneUrl } from "@/lib/control-plane"

export interface AuthenticatedShellRouteData {
  authSession: AuthSessionContext | null
  authProviderConfig: PublicAuthProviderRegistry
  providerSettings: ProviderSettingsResponse | null
}

const EMPTY_AUTH_PROVIDER_CONFIG: PublicAuthProviderRegistry = {
  defaultSignInProviderId: "",
  providers: [],
  configurationFile: "config/dev.config.jsonc",
}

function isPublicAuthProviderRegistry(value: unknown): value is PublicAuthProviderRegistry {
  if (!value || typeof value !== "object") return false
  const config = value as Record<string, unknown>
  return (
    typeof config.defaultSignInProviderId === "string" &&
    Array.isArray(config.providers) &&
    config.providers.every(
      (provider) =>
        provider &&
        typeof provider === "object" &&
        typeof Reflect.get(provider, "id") === "string" &&
        typeof Reflect.get(provider, "kind") === "string" &&
        typeof Reflect.get(provider, "displayName") === "string",
    ) &&
    typeof config.configurationFile === "string" &&
    config.configurationFile.endsWith(".config.jsonc")
  )
}

async function getAuthProviderConfig(): Promise<PublicAuthProviderRegistry> {
  try {
    const headers = await getControlPlaneHeaders({ Accept: "application/json" })
    const response = await fetch(new URL("/api/auth/config", getControlPlaneUrl()), { headers })
    if (!response.ok) return EMPTY_AUTH_PROVIDER_CONFIG

    const config = (await response.json()) as unknown
    return isPublicAuthProviderRegistry(config) ? config : EMPTY_AUTH_PROVIDER_CONFIG
  } catch {
    return EMPTY_AUTH_PROVIDER_CONFIG
  }
}

async function getProviderSettingsForUser(
  request: Request,
): Promise<ProviderSettingsResponse | null> {
  try {
    const headers = getControlPlaneHeaders(request.headers)
    headers.set("Accept", "application/json")
    const response = await fetch(new URL("/providers", getControlPlaneUrl()), { headers })
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  }
}

export const loadAuthenticatedShellForRoute = createServerFn({
  method: "GET",
  strict: false,
}).handler(async (): Promise<AuthenticatedShellRouteData> => {
  const request = getRequest()
  const authSession = await getAuthSessionContext(request)
  const [authProviderConfig, providerSettings] = await Promise.all([
    getAuthProviderConfig(),
    authSession?.user.id ? getProviderSettingsForUser(request) : null,
  ])

  return { authSession, authProviderConfig, providerSettings }
})
