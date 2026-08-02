import type { SecretMetadata } from "@/hooks/use-secrets"

const REPO_TAG_PREFIX = "repo:"

export function getRepoSecretTag(repoFullName: string): string {
  return `${REPO_TAG_PREFIX}${repoFullName}`
}

function isRepoTag(tag: string): boolean {
  return tag.startsWith(REPO_TAG_PREFIX)
}

function parseSecretsList(value: unknown): SecretMetadata[] {
  if (!value || typeof value !== "object" || !("secrets" in value)) {
    return []
  }
  const secrets = (value as { secrets?: unknown }).secrets
  if (!Array.isArray(secrets)) {
    return []
  }
  return secrets
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
}

async function fetchSecrets(query?: { tags: string }): Promise<SecretMetadata[]> {
  const params = new URLSearchParams()
  if (query?.tags) {
    params.set("tags", query.tags)
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
    throw new Error(message)
  }
  return parseSecretsList(data)
}

export function syncSecretKeysWithRepo(
  selectedKeys: readonly string[],
  secrets: readonly SecretMetadata[],
  repoTaggedSecrets: readonly SecretMetadata[],
  repoFullName: string | null,
): string[] {
  const repoTag = repoFullName ? getRepoSecretTag(repoFullName) : null
  const secretsByKey = new Map(secrets.map((secret) => [secret.key, secret]))

  const keptKeys = selectedKeys.filter((key) => {
    const secret = secretsByKey.get(key)
    if (!secret) {
      return true
    }
    const repoTags = secret.tags.filter(isRepoTag)
    if (repoTags.length === 0) {
      return true
    }
    if (!repoTag) {
      return false
    }
    return repoTags.includes(repoTag)
  })

  const repoTaggedKeys = repoTag === null ? [] : repoTaggedSecrets.map((secret) => secret.key)

  return Array.from(new Set([...keptKeys, ...repoTaggedKeys])).sort()
}

export async function fetchSyncedSecretKeysForRepo(
  selectedKeys: readonly string[],
  repoFullName: string | null,
): Promise<string[]> {
  const allSecrets = await fetchSecrets()
  if (!repoFullName) {
    return syncSecretKeysWithRepo(selectedKeys, allSecrets, [], null)
  }

  const repoTaggedSecrets = await fetchSecrets({ tags: getRepoSecretTag(repoFullName) })
  return syncSecretKeysWithRepo(selectedKeys, allSecrets, repoTaggedSecrets, repoFullName)
}
