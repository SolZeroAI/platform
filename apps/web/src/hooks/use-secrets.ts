"use client"

import type { GlobalSecretMetadata, GlobalSecretsListQuery } from "@solzero/api"
import { useMemo } from "react"
import { apiQueryKeys, useApiQuery } from "@/lib/api-hooks"

export type SecretMetadata = Pick<GlobalSecretMetadata, "key" | "tags">

/** The secrets list query, with each filter only when it is set. */
export function secretsListQuery(q: string, tags: string): GlobalSecretsListQuery {
  const query: GlobalSecretsListQuery = {}

  if (q.length > 0) {
    query.q = q
  }

  if (tags.length > 0) {
    query.tags = tags
  }

  return query
}

const noSecrets: readonly SecretMetadata[] = []
const noTags: readonly string[] = []

export function useSecrets(options?: { q?: string; tags?: readonly string[]; enabled?: boolean }) {
  const q = options?.q?.trim() ?? ""
  // Derive a stable string key from the tag list so callers can pass an inline
  // array (a fresh reference each render) without retriggering fetches.
  const optionTags = options?.tags
  const tags = optionTags && optionTags.length > 0 ? optionTags.join(",") : ""

  const query = useApiQuery({
    key: [...apiQueryKeys.secrets, { q, tags }],
    enabled: options?.enabled ?? true,
    fallbackMessage: "Failed to load secrets",
    request: (client) => client.secrets.list({ query: secretsListQuery(q, tags) }),
  })

  const sortedTags = useMemo(
    () => (query.data ? [...query.data.tags].sort() : noTags),
    [query.data],
  )

  return {
    secrets: query.data?.secrets ?? noSecrets,
    tags: sortedTags,
    loading: query.isFetching,
    error: query.error?.message ?? null,
    refresh: query.refetch,
  }
}
