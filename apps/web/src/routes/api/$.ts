import { createFileRoute } from "@tanstack/react-router"
import { getAuthSessionContext } from "@/lib/auth-session"
import { getControlPlaneHeaders, getControlPlaneUrl, getWebAppUrl } from "@/lib/control-plane"

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: ({ request }) => proxyApiRequest(request),
      HEAD: ({ request }) => proxyApiRequest(request),
      POST: ({ request }) => proxyApiRequest(request),
      PUT: ({ request }) => proxyApiRequest(request),
      PATCH: ({ request }) => proxyApiRequest(request),
      DELETE: ({ request }) => proxyApiRequest(request),
      OPTIONS: ({ request }) => proxyApiRequest(request),
    },
  },
})

type UpstreamRoute =
  | {
      kind: "better-auth"
      pathname: string
    }
  | {
      kind: "effect-api"
      pathname: string
      requiresSession: boolean
    }

const LOCALHOST_CLIENT_IP = "127.0.0.1"
const CLIENT_IP_HEADERS = ["cf-connecting-ip", "true-client-ip", "x-forwarded-for", "x-real-ip"]

function copyResponseHeaders(source: Headers): Headers {
  const headers = new Headers()

  for (const [key, value] of source.entries()) {
    const normalized = key.toLowerCase()
    if (
      normalized === "content-encoding" ||
      normalized === "content-length" ||
      normalized === "transfer-encoding" ||
      normalized === "connection"
    ) {
      continue
    }
    headers.append(key, value)
  }

  const setCookie = (source as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
  if (setCookie) {
    headers.delete("set-cookie")
    for (const cookie of setCookie) {
      headers.append("set-cookie", cookie)
    }
  }

  return headers
}

function isWebSocketUpgradeRequest(request: Request): boolean {
  return (
    request.headers.get("upgrade")?.toLowerCase() === "websocket" &&
    request.headers.get("connection")?.toLowerCase().includes("upgrade") === true
  )
}

function getUpstreamRoute(pathname: string): UpstreamRoute {
  if (pathname === "/api/auth/api-keys" || pathname.startsWith("/api/auth/api-keys/")) {
    return {
      kind: "effect-api",
      pathname: pathname.slice("/api".length),
      requiresSession: true,
    }
  }

  if (pathname.startsWith("/api/auth")) {
    return {
      kind: "better-auth",
      pathname,
    }
  }

  return {
    kind: "effect-api",
    pathname: pathname === "/api" ? "/" : pathname.slice("/api".length),
    requiresSession: pathname !== "/api/health",
  }
}

function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  )
}

function getForwardedClientIp(request: Request, publicOrigin: URL): string | null {
  const cloudflareClientIp = request.headers.get("cf-connecting-ip")?.split(",")[0]?.trim()
  if (cloudflareClientIp) {
    return cloudflareClientIp
  }

  return isLocalhost(publicOrigin.hostname) ? LOCALHOST_CLIENT_IP : null
}

function setForwardedHeaders(headers: Headers, request: Request): void {
  const publicOrigin = new URL(getWebAppUrl())
  const forwardedClientIp = getForwardedClientIp(request, publicOrigin)

  for (const header of CLIENT_IP_HEADERS) {
    headers.delete(header)
  }
  if (forwardedClientIp) {
    headers.set("x-forwarded-for", forwardedClientIp)
  }
  headers.set("x-forwarded-host", publicOrigin.host)
  headers.set("x-forwarded-proto", publicOrigin.protocol.replace(":", ""))
  headers.set("x-forwarded-prefix", "/api")
  headers.delete("host")
  headers.delete("content-length")
}

async function getProxyHeaders(
  request: Request,
  route: UpstreamRoute,
): Promise<Headers | Response> {
  const headers =
    route.kind === "effect-api"
      ? await getControlPlaneHeaders(request.headers)
      : new Headers(request.headers)

  const session =
    route.kind === "effect-api" && route.requiresSession
      ? await getAuthSessionContext(request)
      : null

  setForwardedHeaders(headers, request)

  if (route.kind === "effect-api" && route.requiresSession) {
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  return headers
}

export async function proxyApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const route = getUpstreamRoute(url.pathname)
  const headers = await getProxyHeaders(request, route)

  if (headers instanceof Response) {
    return headers
  }

  const upstreamUrl = new URL(`${route.pathname}${url.search}`, getControlPlaneUrl())
  const hasBody = request.method !== "GET" && request.method !== "HEAD"
  const body = hasBody ? request.body : undefined

  const response = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    redirect: "manual",
    body,
  })

  if (isWebSocketUpgradeRequest(request) && response.status === 101) {
    return response
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: copyResponseHeaders(response.headers),
  })
}
