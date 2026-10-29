import { createHash } from "node:crypto"

const AI_SEARCH_NAMESPACE_MAX_LENGTH = 28
const AI_SEARCH_NAMESPACE_HASH_LENGTH = 8

export interface GetAiSearchNamespaceNameOptions {
  appName: string
  stageName: string
}

// A single character class has no nested quantifier, so externally supplied stack names cannot trigger backtracking.
function normalizeNamespaceName(value: string): string {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join("-")
}

function stageQualifiedNamespaceName(prefix: string, stageName: string): string {
  const candidate = normalizeNamespaceName(`${prefix}-${stageName}`)

  if (candidate.length <= AI_SEARCH_NAMESPACE_MAX_LENGTH) {
    return candidate
  }

  const hash = createHash("sha256")
    .update(candidate)
    .digest("hex")
    .slice(0, AI_SEARCH_NAMESPACE_HASH_LENGTH)

  const prefixLength = AI_SEARCH_NAMESPACE_MAX_LENGTH - hash.length - 1
  const truncatedCandidate = candidate.slice(0, prefixLength)

  const truncated = truncatedCandidate.endsWith("-")
    ? truncatedCandidate.slice(0, -1)
    : truncatedCandidate

  return `${truncated}-${hash}`
}

export function getAiSearchNamespaceName(options: GetAiSearchNamespaceNameOptions): string {
  return stageQualifiedNamespaceName(options.appName, options.stageName)
}

export function getWorkflowAiSearchNamespaceName(options: GetAiSearchNamespaceNameOptions): string {
  return stageQualifiedNamespaceName(`${options.appName}-user-workflow`, options.stageName)
}
