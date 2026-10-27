import type { WebEnv } from "infra/types/web-env"

/** Forward without buffering bodies, following redirects, or replacing a WebSocket response. */
export function forwardApiRequest(request: Request, api: WebEnv["S0_API"]): Promise<Response> {
  return api.fetch(new Request(request, { redirect: "manual" }))
}
