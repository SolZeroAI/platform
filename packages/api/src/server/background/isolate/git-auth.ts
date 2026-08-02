const GITHUB_APP_GIT_USERNAME = "x-access-token"

export interface GitHubAppGitCredentials {
  username: string
  password: string
}

export function buildGitHubAppGitCredentials(githubAccessToken: string): GitHubAppGitCredentials {
  const password = githubAccessToken.trim()
  if (!password) {
    throw new Error("GitHub App installation token is unavailable")
  }

  return {
    username: GITHUB_APP_GIT_USERNAME,
    password,
  }
}
