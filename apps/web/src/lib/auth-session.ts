import { getControlPlaneHeaders, getControlPlaneUrl } from "@/lib/control-plane"
import type { AppSession } from "@/lib/auth-session-state"

export interface AuthSessionContext extends AppSession {
  githubAccountId: string | null
}

function isAuthSessionContext(value: unknown): value is AuthSessionContext {
  if (!value || typeof value !== "object" || !("user" in value)) {
    return false
  }
  const user = (value as { user?: unknown }).user
  return (
    Boolean(user) && typeof user === "object" && typeof (user as { id?: unknown }).id === "string"
  )
}

export async function getAuthSessionContext(request: Request): Promise<AuthSessionContext | null> {
  const cookie = request.headers.get("cookie")
  const response = await fetch(`${getControlPlaneUrl().replace(/\/+$/, "")}/auth/session`, {
    headers: await getControlPlaneHeaders(cookie ? { Cookie: cookie } : undefined),
  })

  if (response.status === 401) {
    return null
  }

  if (response.status < 200 || response.status >= 300) {
    const message = await response.text()
    throw new Error(message || "Failed to load auth session")
  }

  const data = await response.json()
  if (!isAuthSessionContext(data)) {
    throw new Error("Failed to load auth session")
  }
  return {
    ...data,
    isAdmin: data.isAdmin === true,
  }
}
