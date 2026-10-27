/**
 * Control Plane API utilities.
 *
 * Handles authentication and communication with the control plane.
 */

import { env } from "cloudflare:workers"
import { forwardApiRequest } from "./api-transport"

/** Forward a public `/api` request to the API Worker through the S0_API service binding. */
export function forwardPublicApiRequest(request: Request): Promise<Response> {
  return forwardApiRequest(request, env.S0_API)
}

/** Paths here are canonical Worker paths, not public URLs; SSR never fetches its own /api route. */
export function fetchControlPlane(path: string, init?: RequestInit): Promise<Response> {
  return forwardPublicApiRequest(new Request(new URL(path, "https://s0-api.internal"), init))
}

export function getControlPlaneHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init)
  headers.delete("authorization")
  headers.delete("x-api-key")
  headers.delete("x-user-id")
  headers.delete("x-okta-user-id")

  return headers
}
