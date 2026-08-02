import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import type { AdminAiProvidersResponse, AdminAiSearchResponse, AdminMcpcfResponse } from "@c0/api"
import { getAuthSessionContext } from "@/lib/auth-session"
import type { AdminAiSearchInitialData, AdminIntegrationsInitialData } from "@/lib/admin-console"
import { getControlPlaneHeaders, getControlPlaneUrl } from "@/lib/control-plane"

async function readJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text()
  const payload = text.trim()
    ? (JSON.parse(text) as T & { error?: string; message?: string })
    : null

  if (!response.ok) {
    const message =
      payload && typeof payload === "object"
        ? (payload.error ?? payload.message ?? fallback)
        : fallback
    throw new Error(message)
  }

  return payload as T
}

async function requestAdminJson<T>(path: string, request: Request, fallback: string): Promise<T> {
  const headers = getControlPlaneHeaders(request.headers)
  headers.set("Accept", "application/json")
  const response = await fetch(new URL(path, getControlPlaneUrl()), { headers })
  return readJsonResponse<T>(response, fallback)
}

const getInitialAdminIntegrations = createServerFn({ method: "GET", strict: false }).handler(
  async (): Promise<AdminIntegrationsInitialData | null> => {
    try {
      const request = getRequest()
      const session = await getAuthSessionContext(request)
      if (!session?.user.id || !session.isAdmin) {
        return null
      }

      const [mcpcf, aiProviders] = await Promise.all([
        requestAdminJson<AdminMcpcfResponse>(
          "/admin/mcpcf",
          request,
          "Failed to load MCP Context Forge admin settings",
        ),
        requestAdminJson<AdminAiProvidersResponse>(
          "/admin/ai-providers",
          request,
          "Failed to load AI provider admin settings",
        ),
      ])

      return { aiProviders, mcpcf, error: "" }
    } catch (error) {
      return {
        aiProviders: null,
        mcpcf: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
)

export function loadAdminIntegrationsForRoute(): Promise<AdminIntegrationsInitialData | null> {
  return getInitialAdminIntegrations()
}

const getInitialAdminAiSearch = createServerFn({ method: "GET", strict: false }).handler(
  async (): Promise<AdminAiSearchInitialData | null> => {
    try {
      const request = getRequest()
      const session = await getAuthSessionContext(request)
      if (!session?.user.id || !session.isAdmin) {
        return null
      }

      const aiSearch = await requestAdminJson<AdminAiSearchResponse>(
        "/admin/ai-search",
        request,
        "Failed to load AI Search admin settings",
      )

      return { aiSearch, error: "" }
    } catch (error) {
      return {
        aiSearch: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
)

export function loadAdminAiSearchForRoute(): Promise<AdminAiSearchInitialData | null> {
  return getInitialAdminAiSearch()
}
