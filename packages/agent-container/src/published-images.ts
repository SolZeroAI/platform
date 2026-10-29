import type { AGENT_CONTAINER_ENTRYPOINTS } from "./images"

/**
 * Prebuilt linux/amd64 GHCR images for a published release. A git checkout keeps this object
 * empty and builds each image from the Dockerfile. The registry job in Release replaces this file
 * with the digests it pushed, only inside the package it publishes to alchemy.new.
 */
export const PUBLISHED_AGENT_CONTAINER_IMAGES: Partial<
  Record<keyof typeof AGENT_CONTAINER_ENTRYPOINTS, string>
> = {}
