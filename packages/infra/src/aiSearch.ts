import { createHash } from "node:crypto"

const AI_SEARCH_NAMESPACE_MAX_LENGTH = 28
const AI_SEARCH_NAMESPACE_HASH_LENGTH = 8

export interface GetAiSearchNamespaceNameOptions {
  appName: string
  stageName: string
}

function isAsciiLowercaseAlphanumeric(character: string): boolean {
  const code = character.charCodeAt(0)
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122)
}

function normalizeNamespaceName(value: string): string {
  const characters: string[] = []
  let separatorPending = false

  // oxlint-disable-next-line effect/imperative-loops -- A linear scan avoids regex backtracking on externally supplied stack names.
  for (const character of value.toLowerCase()) {
    if (!isAsciiLowercaseAlphanumeric(character)) {
      separatorPending = characters.length > 0
      continue
    }

    if (separatorPending) {
      characters.push("-")
      separatorPending = false
    }
    characters.push(character)
  }

  return characters.join("")
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

export interface GetAiSearchInstanceNameOptions {
  appName: string
  serviceName: string
  stageName: string
}

export function getAiSearchInstanceName(options: GetAiSearchInstanceNameOptions): string {
  const { appName, serviceName, stageName } = options

  return `${appName}-${serviceName}-ais-${stageName}`
}
