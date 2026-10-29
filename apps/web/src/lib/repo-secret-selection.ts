import { secretsListQuery, type SecretMetadata } from "@/hooks/use-secrets"
import { runApi } from "@/lib/api-client"

const REPO_TAG_PREFIX = "repo:"

export function getRepoSecretTag(repoFullName: string): string {
  return `${REPO_TAG_PREFIX}${repoFullName}`
}

function isRepoTag(tag: string): boolean {
  return tag.startsWith(REPO_TAG_PREFIX)
}

async function fetchSecrets(query?: { tags: string }): Promise<readonly SecretMetadata[]> {
  const { secrets } = await runApi(
    (client) => client.secrets.list({ query: secretsListQuery("", query?.tags ?? "") }),
    { fallbackMessage: "Failed to load secrets" },
  )

  return secrets
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
