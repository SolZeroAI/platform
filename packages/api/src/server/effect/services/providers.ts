import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type { ApiEnv } from "infra/types/env"
import {
  getAccessibleRepository,
  getGitHubUserProfile,
  listAccessibleRepositoriesPage,
  searchAccessibleRepositories,
  type GitHubAppError,
  type GitHubAppRepository,
  type GitHubRepositoryPage,
  type GitHubRepositoryPageOptions,
  type GitHubRepositorySearchOptions,
  type GitHubUserProfile,
} from "../../background/auth/github-app"
import {
  getBetterAuthUserProfile,
  getGitHubAppUserAccessTokenForUserId,
  getLinkedUserIdByProviderAccountId,
  resolveOktaUserId,
} from "../../lib/better-auth"

export interface GitHubAppUserToken {
  readonly githubUserId: string
  readonly accessToken: string
  readonly accessTokenExpiresAt: number | null
}

// oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Service method signatures need the broad GitHub provider contract shared by live and mock implementations.
type GitHubProviderEffect<A> = Effect.Effect<A, GitHubAppError>

export interface IdentityProviderShape {
  readonly getBetterAuthUserProfile: typeof getBetterAuthUserProfile
  readonly getGitHubAppUserAccessTokenForUserId: typeof getGitHubAppUserAccessTokenForUserId
  readonly getLinkedUserIdByProviderAccountId: typeof getLinkedUserIdByProviderAccountId
  readonly resolveOktaUserId: typeof resolveOktaUserId
}

export interface GitHubProviderShape {
  readonly listAccessibleRepositoriesPage: (
    userAccessToken: string,
    options?: GitHubRepositoryPageOptions,
  ) => GitHubProviderEffect<GitHubRepositoryPage>
  readonly searchAccessibleRepositories: (
    userAccessToken: string,
    options?: GitHubRepositorySearchOptions,
  ) => GitHubProviderEffect<GitHubRepositoryPage>
  readonly getAccessibleRepository: (
    userAccessToken: string,
    owner: string,
    repo: string,
  ) => GitHubProviderEffect<Option.Option<GitHubAppRepository>>
  readonly getGitHubUserProfile: (
    userAccessToken: string,
  ) => GitHubProviderEffect<GitHubUserProfile>
}

export class IdentityProvider extends Context.Service<IdentityProvider, IdentityProviderShape>()(
  "s0/api/IdentityProvider",
) {}

export class GitHubProvider extends Context.Service<GitHubProvider, GitHubProviderShape>()(
  "s0/api/GitHubProvider",
) {}

export const LiveIdentityProvider: IdentityProviderShape = {
  getBetterAuthUserProfile,
  getGitHubAppUserAccessTokenForUserId,
  getLinkedUserIdByProviderAccountId,
  resolveOktaUserId,
}

export const LiveGitHubProvider: GitHubProviderShape = {
  getAccessibleRepository,
  getGitHubUserProfile,
  listAccessibleRepositoriesPage,
  searchAccessibleRepositories,
}

const mockRepoPermissions = {
  contents: "write",
  pullRequests: "write",
  metadata: "read",
  userCanPull: true,
  userCanPush: true,
  userCanAdmin: false,
  canPush: true,
  canOpenPullRequests: true,
} satisfies GitHubAppRepository["permissions"]

const mockRepositories = [
  {
    id: 1,
    owner: "example-org",
    name: "s0",
    fullName: "example-org/s0",
    description: "Example s0 repository",
    private: false,
    defaultBranch: "main",
    installationId: 1001,
    permissions: mockRepoPermissions,
  },
  {
    id: 2,
    owner: "example-org",
    name: "docs",
    fullName: "example-org/docs",
    description: "Example documentation repository",
    private: false,
    defaultBranch: "main",
    installationId: 1001,
    permissions: mockRepoPermissions,
  },
] satisfies GitHubAppRepository[]

function matchesMockRepositorySearch(
  repo: GitHubAppRepository,
  query: string | undefined,
  visibility: GitHubRepositorySearchOptions["visibility"],
): boolean {
  const matchesQuery = !query || repo.fullName.includes(query) || repo.name.includes(query)
  const matchesVisibility =
    visibility === "all" ||
    (visibility === "private" && repo.private) ||
    (visibility === "public" && !repo.private)
  return matchesQuery && matchesVisibility
}

function createMockRepositoryPage(options: GitHubRepositoryPageOptions = {}): GitHubRepositoryPage {
  const owner = options.owner?.trim().toLowerCase()
  const page = Math.max(options.page ?? 1, 1)
  const perPage = Math.min(Math.max(options.perPage ?? 20, 1), 100)
  const filtered = mockRepositories.filter((repo) => !owner || repo.owner === owner)
  const offset = (page - 1) * perPage
  return {
    repositories: filtered.slice(offset, offset + perPage),
    owners: [{ login: "example-org", type: "Organization" }],
    page,
    perPage,
    totalCount: filtered.length,
    hasMore: offset + perPage < filtered.length,
  }
}

function listMockAccessibleRepositoriesPage(
  _userAccessToken: string,
  options?: GitHubRepositoryPageOptions,
) {
  return Effect.succeed(createMockRepositoryPage(options))
}

function searchMockAccessibleRepositories(
  _userAccessToken: string,
  options: GitHubRepositorySearchOptions = {},
) {
  const query = options.query?.trim().toLowerCase()
  const visibility = options.visibility ?? "all"
  const searched = createMockRepositoryPage(options)
  const repositories = searched.repositories.filter((repo) =>
    matchesMockRepositorySearch(repo, query, visibility),
  )
  return Effect.succeed({ ...searched, repositories, totalCount: null, hasMore: false })
}

export const MockIdentityProvider: IdentityProviderShape = {
  getBetterAuthUserProfile(_env, userId) {
    const emailByUserId: Record<string, string> = {
      admin_1: "admin@example.test",
      user_1: "user.one@example.test",
      user_2: "user.two@example.test",
    }
    return Effect.succeed({
      id: userId,
      name: `Mock ${userId}`,
      email: emailByUserId[userId] ?? `${userId}@example.test`,
      image: null,
    })
  },
  getGitHubAppUserAccessTokenForUserId(_env, userId) {
    return Effect.succeed({
      githubUserId: `github_${userId}`,
      accessToken: `mock-github-token-${userId}`,
      accessTokenExpiresAt: null,
    })
  },
  getLinkedUserIdByProviderAccountId,
  resolveOktaUserId(_env, userId) {
    return Effect.succeed(`okta_${userId}`)
  },
}

export const MockGitHubProvider: GitHubProviderShape = {
  listAccessibleRepositoriesPage: listMockAccessibleRepositoriesPage,
  searchAccessibleRepositories: searchMockAccessibleRepositories,
  getAccessibleRepository(_userAccessToken, owner, repo) {
    const normalizedOwner = owner.toLowerCase()
    const normalizedRepo = repo.toLowerCase()
    return Effect.succeed(
      Option.fromNullishOr(
        mockRepositories.find(
          (candidate) => candidate.owner === normalizedOwner && candidate.name === normalizedRepo,
        ),
      ),
    )
  },
  getGitHubUserProfile(_userAccessToken) {
    return Effect.succeed({
      id: 42,
      login: "mock-github-user",
      name: "Mock GitHub User",
      email: "mock-github-user@example.test",
    })
  },
}

export const LiveProviderLayer = Layer.mergeAll(
  Layer.succeed(IdentityProvider, LiveIdentityProvider),
  Layer.succeed(GitHubProvider, LiveGitHubProvider),
)

export const MockProviderLayer = Layer.mergeAll(
  Layer.succeed(IdentityProvider, MockIdentityProvider),
  Layer.succeed(GitHubProvider, MockGitHubProvider),
)

export function providerServicesForEnv(env: ApiEnv) {
  return Match.value(env.S0_PROVIDER_LAYER === "mock").pipe(
    Match.when(true, () => ({
      identityProvider: MockIdentityProvider,
      githubProvider: MockGitHubProvider,
    })),
    Match.orElse(() => ({
      identityProvider: LiveIdentityProvider,
      githubProvider: LiveGitHubProvider,
    })),
  )
}

export function providerLayerForEnv(env: ApiEnv) {
  return Match.value(env.S0_PROVIDER_LAYER === "mock").pipe(
    Match.when(true, () => MockProviderLayer),
    Match.orElse(() => LiveProviderLayer),
  )
}
