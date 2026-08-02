import { posix as pathPosix } from "node:path"

export const REPO_ROOT = "/repo"

export function formatCommitMessage(message: string): string {
  const firstLine = message.split("\n")[0]?.trim()
  return firstLine || "(no commit message)"
}

export function normalizeRepoRelativePath(filePath: string): string {
  const trimmed = filePath.trim()
  if (!trimmed) {
    throw new Error("path is required")
  }

  const normalized = pathPosix.normalize(trimmed).replace(/^\/+/, "")
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Path '${filePath}' must stay within the repository workspace`)
  }

  return normalized
}

export function toRepoPath(filePath: string): string {
  return `${REPO_ROOT}/${normalizeRepoRelativePath(filePath)}`
}

/** Resolve a child workspace path into the parent repository without permitting traversal. */
export function toRepoWorkspacePath(filePath: string, options?: { allowRoot?: boolean }): string {
  const trimmed = filePath.trim()
  const relative = trimmed.replace(new RegExp(`^${REPO_ROOT}(?:/|$)`), "").replace(/^\/+/, "")
  if (!relative || relative === ".") {
    if (options?.allowRoot === true) {
      return REPO_ROOT
    }
    throw new Error(`Path '${filePath}' must identify an entry inside the repository workspace`)
  }
  return toRepoPath(relative)
}

export function relativeRepoPath(absolutePath: string): string {
  return absolutePath.replace(new RegExp(`^${REPO_ROOT}/?`), "")
}

export function buildSearchExcerpt(content: string, query: string): string {
  const lowerContent = content.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerContent.indexOf(lowerQuery)
  if (index === -1) {
    return content.slice(0, 240)
  }

  const start = Math.max(0, index - 80)
  const end = Math.min(content.length, index + query.length + 160)
  return content.slice(start, end).trim()
}
