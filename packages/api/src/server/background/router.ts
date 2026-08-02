import { error, getSessionStub } from "../effect/handlers/shared/control-plane"
import type { Env } from "./types"

const SESSION_WEBSOCKET_PATTERN = /^\/sessions\/(?<id>[^/]+)\/ws$/

export async function handleSessionWebSocketRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(SESSION_WEBSOCKET_PATTERN)
  if (request.method !== "GET" || request.headers.get("Upgrade") !== "websocket" || !match) {
    return null
  }

  const sessionId = match.groups?.id
  if (!sessionId) {
    return error("Session ID required", 400)
  }

  return getSessionStub(env, sessionId).fetch(request)
}
