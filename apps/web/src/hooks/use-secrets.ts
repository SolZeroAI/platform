"use client"

import { useCallback, useEffect, useState } from "react"

export type SecretMetadata = {
  key: string
  tags: string[]
}

function readSecretsResponse(value: unknown): { secrets: SecretMetadata[]; tags: string[] } {
  if (!value || typeof value !== "object" || !("secrets" in value)) {
    return { secrets: [], tags: [] }
  }
  const secretsValue = (value as { secrets?: unknown }).secrets
  if (!Array.isArray(secretsValue)) {
    return { secrets: [], tags: [] }
  }
  const secrets = secretsValue
    .map((secret): SecretMetadata | null => {
      if (!secret || typeof secret !== "object") {
        return null
      }
      const key = (secret as { key?: unknown }).key
      const tags = (secret as { tags?: unknown }).tags
      if (typeof key !== "string") {
        return null
      }
      return {
        key,
        tags: Array.isArray(tags)
          ? tags.filter((tag): tag is string => typeof tag === "string")
          : [],
      }
    })
    .filter((secret): secret is SecretMetadata => Boolean(secret))
  const responseTags = (value as { tags?: unknown }).tags
  const tags = Array.isArray(responseTags)
    ? responseTags.filter((tag): tag is string => typeof tag === "string").sort()
    : Array.from(new Set(secrets.flatMap((secret) => secret.tags))).sort()
  return { secrets, tags }
}

export function useSecrets(options?: { q?: string; tags?: readonly string[]; enabled?: boolean }) {
  const enabled = options?.enabled ?? true
  const q = options?.q ?? ""
  // Derive a stable string key from the tag list so callers can pass an inline
  // array (a fresh reference each render) without retriggering fetches.
  const optionTags = options?.tags
  const tagsParam = optionTags && optionTags.length > 0 ? optionTags.join(",") : ""
  const [secrets, setSecrets] = useState<SecretMetadata[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      const trimmedQ = q.trim()
      if (trimmedQ) {
        params.set("q", trimmedQ)
      }
      if (tagsParam) {
        params.set("tags", tagsParam)
      }
      const response = await fetch(
        params.size > 0 ? `/api/secrets?${params.toString()}` : "/api/secrets",
      )
      const data = (await response.json()) as unknown
      if (!response.ok) {
        const message =
          data && typeof data === "object" && "error" in data
            ? String((data as { error?: unknown }).error)
            : "Failed to load secrets"
        setError(message)
        setSecrets([])
        setTags([])
        return
      }
      const parsed = readSecretsResponse(data)
      setSecrets(parsed.secrets)
      setTags(parsed.tags)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load secrets")
      setSecrets([])
      setTags([])
    } finally {
      setLoading(false)
    }
  }, [q, tagsParam])

  useEffect(() => {
    if (!enabled) {
      return
    }
    void refresh()
  }, [enabled, refresh])

  return { secrets, tags, loading, error, refresh }
}
