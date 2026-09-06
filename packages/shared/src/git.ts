import type { GitUser } from "./types"

const BRANCH_PREFIX = "s0-agent"

export function generateBranchName(sessionId: string): string {
  return `${BRANCH_PREFIX}/${sessionId}`
}

function generateNoreplyEmail(githubId: number | string, githubLogin: string): string {
  return `${githubId}+${githubLogin}@users.noreply.github.com`
}

function getCommitEmail(
  publicEmail: string | null,
  githubId: number | string,
  githubLogin: string,
): string {
  if (publicEmail) {
    return publicEmail
  }
  return generateNoreplyEmail(githubId, githubLogin)
}

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
