/**
 * Control Plane API utilities.
 *
 * Handles authentication and communication with the control plane.
 */

import { env } from "cloudflare:workers"
import { getStageMetadataSync } from "@solzero/shared"
import { forwardApiRequest } from "./api-transport"

function getWebStageMetadata() {
  return getStageMetadataSync(env)
}

/**
 * Get the control plane URL for the current stage.
 */
export function getControlPlaneUrl(): string {
  return getWebStageMetadata().infra.serverUrl
}

export function getWebAppUrl(): string {
  return getWebStageMetadata().infra.authBaseUrl
}

export function usesSameOriginApi(): boolean {
  return getWebStageMetadata().infra.apiRouting === "same-origin"
}

export function forwardPublicApiRequest(request: Request): Promise<Response> {
  if (!env.S0_API) throw new Error("Same-origin API routing requires the S0_API service binding")
  return forwardApiRequest(request, env.S0_API)
}

/** Paths here are canonical Worker paths, not public URLs; SSR never fetches its own /api route. */
export function fetchControlPlane(path: string, init?: RequestInit): Promise<Response> {
  if (usesSameOriginApi()) {
    return forwardPublicApiRequest(new Request(new URL(path, "https://s0-api.internal"), init))
  }
  return fetch(new URL(path, getControlPlaneUrl()), init)
}

export function getControlPlaneHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init)
  headers.delete("authorization")
  headers.delete("x-api-key")
  headers.delete("x-user-id")
  headers.delete("x-okta-user-id")

  return headers
}
