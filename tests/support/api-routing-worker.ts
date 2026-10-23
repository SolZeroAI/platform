// This is an owned local transport fixture, not a replacement application API.
import { canonicalApiPath } from "../../packages/shared/src/api-url"
import { forwardApiRequest } from "../../apps/web/src/lib/api-transport"

export default {
  async fetch(request: Request, env: { ROLE: string; API: Fetcher }) {
    if (env.ROLE === "web") return forwardApiRequest(request, env.API)
    const url = new URL(request.url)
    const pathname = canonicalApiPath(url.pathname)
    if (pathname === "/socket") {
      const [client, server] = Object.values(new WebSocketPair())
      server.accept()
      server.addEventListener("message", (event) => server.send(event.data))
      return new Response(null, { status: 101, webSocket: client })
    }
    if (pathname === "/stream") {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: first\n\n"))
          // Deliberately stay open, as an SSE subscription would.
        },
      })
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } })
    }
    if (pathname === "/redirect") {
      const headers = new Headers({ Location: "/api/auth/callback/fixture" })
      headers.append("Set-Cookie", "first=1; Path=/; HttpOnly")
      headers.append("Set-Cookie", "second=2; Path=/; HttpOnly")
      return new Response(null, { status: 302, headers })
    }
    return Response.json({
      pathname,
      search: url.search,
      method: request.method,
      authorization: request.headers.get("authorization"),
      apiKey: request.headers.get("x-api-key"),
      cookie: request.headers.get("cookie"),
      signature: request.headers.get("x-hub-signature-256"),
      body: Array.from(new Uint8Array(await request.arrayBuffer())),
    })
  },
}
