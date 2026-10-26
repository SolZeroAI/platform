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

type AuthConfigCandidate = {
  defaultSignInProviderId?: unknown
  providers?: unknown
  configurationFile?: unknown
}

type AuthProviderCandidate = {
  id?: unknown
  kind?: unknown
  displayName?: unknown
}

function isAuthConfigCandidate(value: unknown): value is AuthConfigCandidate {
  return typeof value === "object" && value !== null
}

function isAuthProviderCandidate(value: unknown): value is AuthProviderCandidate {
  return typeof value === "object" && value !== null
}

function isPublicAuthProviderRegistry(value: unknown): value is PublicAuthProviderRegistry {
  if (!isAuthConfigCandidate(value)) return false

  return (
    typeof value.defaultSignInProviderId === "string" &&
    Array.isArray(value.providers) &&
    value.providers.every(
      (provider) =>
        isAuthProviderCandidate(provider) &&
        typeof provider.id === "string" &&
        typeof provider.kind === "string" &&
        typeof provider.displayName === "string",
    ) &&
    typeof value.configurationFile === "string" &&
    value.configurationFile.endsWith(".config.jsonc")
  )
}

async function getAuthProviderConfig(): Promise<PublicAuthProviderRegistry> {
  try {
    const headers = await getControlPlaneHeaders({ Accept: "application/json" })
    const response = await fetch(new URL("/api/auth/config", getControlPlaneUrl()), { headers })

    if (!response.ok) return EMPTY_AUTH_PROVIDER_CONFIG

    // SAFETY: /api/auth/config returns JSON that is checked as unknown before the public provider registry predicate.
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
