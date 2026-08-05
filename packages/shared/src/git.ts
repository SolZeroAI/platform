/**
 * Git utilities for commit attribution and branch management.
 */

import type { GitUser } from "./types"

/**
 * Branch naming convention for sessions.
 */
export const BRANCH_PREFIX = "s0-agent"

/**
 * Generate a branch name for a session.
 */
export function generateBranchName(sessionId: string, _title?: string): string {
  return `${BRANCH_PREFIX}/${sessionId}`
}

/**
 * Extract session ID from a branch name.
 */
export function extractSessionIdFromBranch(branchName: string): string | null {
  const prefix = `${BRANCH_PREFIX}/`
  if (!branchName.startsWith(prefix)) {
    return null
  }
  return branchName.slice(prefix.length)
}

/**
 * Check if a branch name is a SolZero Agent branch.
 */
export function isInspectBranch(branchName: string): boolean {
  return branchName.startsWith(`${BRANCH_PREFIX}/`)
}

/**
 * Generate a commit message for automated commits.
 */
export function generateCommitMessage(
  action: string,
  description: string,
  sessionId: string,
): string {
  return `${action}: ${description}\n\nCo-authored-by: SolZero Agent <s0-agent@noreply.github.com>\nSession-ID: ${sessionId}`
}

/**
 * Generate a noreply email for users who hide their email.
 */
export function generateNoreplyEmail(githubId: number | string, githubLogin: string): string {
  return `${githubId}+${githubLogin}@users.noreply.github.com`
}

/**
 * Get the best email for git commit attribution.
 */
export function getCommitEmail(
  publicEmail: string | null,
  githubId: number | string,
  githubLogin: string,
): string {
  if (publicEmail) {
    return publicEmail
  }
  return generateNoreplyEmail(githubId, githubLogin)
}

/**
 * Create GitUser from GitHub profile data.
 */
export function createGitUser(
  githubLogin: string,
  githubName: string | null,
  publicEmail: string | null,
  githubId: number | string,
): GitUser {
  return {
    name: githubName || githubLogin,
    email: getCommitEmail(publicEmail, githubId, githubLogin),
  }
}

/**
 * Git environment variables for subprocess.
 */
export function getGitEnv(user: GitUser): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: user.name,
    GIT_AUTHOR_EMAIL: user.email,
    GIT_COMMITTER_NAME: user.name,
    GIT_COMMITTER_EMAIL: user.email,
  }
}
