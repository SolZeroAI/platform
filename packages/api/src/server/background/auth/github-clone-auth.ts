import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
  createInstallationAccessToken,
  getGitHubAppConfig,
  GitHubAppError,
  requireAccessibleRepository,
} from "./github-app"

export interface GitHubCloneAuthSession {
  repo_owner: string | null
  repo_name: string | null
  github_installation_id: number | null
  github_repo_id: number | null
}

export interface GitHubCloneAuthOwner {
  user_id: string
  github_name: string | null
  github_email: string | null
}

export interface GitHubCloneAuthToken {
  githubUserId: string
  accessToken: string
}

export interface GitHubCloneCredentials {
  githubUserId: string | null
  accessToken: string | null
  githubLogin: string | null
  githubName: string | null
  githubEmail: string | null
}

function requireCloneAuthNumber(value: number | null, message: string): number {
  return Option.getOrThrowWith(Option.fromNullishOr(value), () => new GitHubAppError({ message }))
}

function requireCloneAuthString(value: string | null, message: string): string {
  return Option.getOrThrowWith(Option.fromNullishOr(value), () => new GitHubAppError({ message }))
}

export const resolveGitHubCloneCredentials = Effect.fn("githubApp.resolveCloneCredentials")(
  function* (input: {
    env: Parameters<typeof getGitHubAppConfig>[0]
    session: GitHubCloneAuthSession
    owner: GitHubCloneAuthOwner
    token: GitHubCloneAuthToken
  }) {
    const repoOwner = requireCloneAuthString(
      input.session.repo_owner,
      "GitHub repo owner is missing",
    )
    const repoName = requireCloneAuthString(input.session.repo_name, "GitHub repo name is missing")
    const installationId = requireCloneAuthNumber(
      input.session.github_installation_id,
      "GitHub App installation metadata is missing for this repo-backed session",
    )
    const repositoryId = requireCloneAuthNumber(
      input.session.github_repo_id,
      "GitHub App installation metadata is missing for this repo-backed session",
    )
    const appConfig = Option.getOrThrowWith(
      getGitHubAppConfig(input.env),
      () => new GitHubAppError({ message: "GitHub App credentials are not configured" }),
    )

    yield* requireAccessibleRepository(
      input.token.accessToken,
      repoOwner,
      repoName,
      (candidate) =>
        candidate.id === repositoryId &&
        candidate.installationId === installationId &&
        candidate.permissions.canPush &&
        candidate.permissions.canOpenPullRequests,
      "GitHub repository is no longer accessible to this user and GitHub App",
    )

    const installationToken = yield* createInstallationAccessToken(appConfig, {
      installationId,
      repositoryId,
      permissions: {
        contents: "write",
        pull_requests: "write",
        metadata: "read",
      },
    })

    return {
      githubUserId: input.token.githubUserId,
      accessToken: installationToken.token,
      githubLogin: null,
      githubName: input.owner.github_name,
      githubEmail: input.owner.github_email,
    } satisfies GitHubCloneCredentials
  },
)
