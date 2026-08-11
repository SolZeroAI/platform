/**
 * Control Plane API utilities.
 *
 * Handles authentication and communication with the control plane.
 */

import { env } from "cloudflare:workers"
import { getStageMetadataSync } from "@solzero/shared"

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

export function getControlPlaneHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init)
  headers.delete("authorization")
  headers.delete("x-api-key")
  headers.delete("x-user-id")
  headers.delete("x-okta-user-id")
  return headers
}
