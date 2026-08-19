import { importPKCS8, SignJWT } from "jose"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { stringifyJson } from "../../lib/json"
import {
  applySearchItems,
  buildPullRequestBody,
  buildRepositorySearchParams,
  buildRepositorySearchQuery,
  clearGitHubAbortState,
  createGitHubAbortState,
  filterInstallationsByOwner,
  formatGitHubApiError,
  GITHUB_API_BASE,
  GITHUB_FETCH_TIMEOUT_MS,
  githubHeaders,
  githubJsonHeaders,
  hexToBytes,
  normalizePage,
  normalizePerPage,
  normalizePrivateKeyForJose,
  responseErrorBody,
  toGitHubUserProfile,
  toInstallationAccessToken,
  toPullRequest,
  toRepository,
  toRepositoryOwners,
  type GitHubAppConfig,
  type GitHubAppPermissionLevel,
  type GitHubAppRepository,
  type GitHubCreatePullRequestInput,
  type GitHubInstallation,
  type GitHubInstallationRepositoriesResponse,
  type GitHubInstallationResponse,
  type GitHubPullRequestResponse,
  type GitHubRepositoryPage,
  type GitHubRepositoryPageOptions,
  type GitHubRepositorySearchOptions,
  type GitHubRepositorySearchResponse,
  type GitHubUserResponse,
  type InstallationTokenResponse,
  type RepositoryPageAccumulator,
  type SearchAccumulator,
  type SearchInstallationContext,
} from "./github-app-model"

export type {
  GitHubAppConfig,
  GitHubAppPermissionLevel,
  GitHubAppRepository,
  GitHubCreatePullRequestInput,
  GitHubInstallationAccessToken,
  GitHubRepositoryOwner,
  GitHubRepositoryPage,
  GitHubRepositoryPageOptions,
  GitHubRepositorySearchOptions,
  GitHubRepositorySearchOrder,
  GitHubRepositorySearchSort,
  GitHubRepositoryVisibilityFilter,
  GitHubRepositoryPermissions,
  GitHubUserProfile,
} from "./github-app-model"

export class GitHubAppError extends Schema.TaggedError<GitHubAppError>()("GitHubAppError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

// oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Recursive GitHub pagination helpers need explicit self-referential return types.
type GitHubEffect<A> = Effect.Effect<A, GitHubAppError>

function githubAppError(message: string) {
  return (cause: unknown): GitHubAppError => new GitHubAppError({ message, cause })
}

export function getGitHubAppConfig(env: {
  GITHUB_APP_ID?: string
  GITHUB_APP_CLIENT_ID?: string
  GITHUB_APP_CLIENT_SECRET?: string
  GITHUB_APP_PRIVATE_KEY?: string
  GITHUB_APP_SLUG?: string
  GITHUB_APP_WEBHOOK_SECRET?: string
}): Option.Option<GitHubAppConfig> {
  return Option.all({
    appId: Option.fromNullishOr(env.GITHUB_APP_ID),
    clientId: Option.fromNullishOr(env.GITHUB_APP_CLIENT_ID),
    clientSecret: Option.fromNullishOr(env.GITHUB_APP_CLIENT_SECRET),
    privateKey: Option.fromNullishOr(env.GITHUB_APP_PRIVATE_KEY),
  }).pipe(
    Option.map((required) => ({
      ...required,
      slug: env.GITHUB_APP_SLUG || null,
      webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET || null,
    })),
  )
}

export function getGitHubAppConfigOrThrow(
  env: Parameters<typeof getGitHubAppConfig>[0],
  message: string,
): GitHubAppConfig {
  return Option.getOrThrowWith(getGitHubAppConfig(env), () => new GitHubAppError({ message }))
}

function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = GITHUB_FETCH_TIMEOUT_MS,
) {
  // oxlint-disable-next-line s0-lint/warn-effect-sync-wrapper -- Resource acquisition for the AbortController timeout used by fetchWithTimeout.
  const acquireAbortState = Effect.sync(() => createGitHubAbortState(timeoutMs))
  return Effect.acquireUseRelease(
    acquireAbortState,
    ({ controller }) =>
      Effect.tryPromise({
        try: () =>
          // oxlint-disable-next-line effect/avoid-native-fetch -- GitHub App HTTP client boundary; Effect wraps timeout/cancellation and typed failures here.
          fetch(input, { ...init, signal: controller.signal }),
        catch: githubAppError("GitHub request failed"),
      }),
    (state) =>
      // oxlint-disable-next-line s0-lint/warn-effect-sync-wrapper -- Resource finalizer for the timeout created by acquireAbortState.
      Effect.sync(() => clearGitHubAbortState(state)),
  )
}

function ensureSuccessfulResponse(response: Response, errorPrefix: string) {
  return Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => responseErrorBody(response),
      catch: githubAppError(`${errorPrefix}: failed to read error response`),
    })
    yield* Effect.succeed(body).pipe(
      Effect.filterOrFail(
        (value) => value === null,
        (value) =>
          new GitHubAppError({
            message: formatGitHubApiError(errorPrefix, response, String(value)),
          }),
      ),
    )
  })
}

function fetchJson<T>(url: string, accessToken: string, errorPrefix: string) {
  return Effect.gen(function* () {
    const response = yield* fetchWithTimeout(url, {
      method: "GET",
      headers: githubHeaders(accessToken),
    })
    yield* ensureSuccessfulResponse(response, errorPrefix)
    return yield* Effect.tryPromise({
      try: () => response.json() as Promise<T>,
      catch: githubAppError(`${errorPrefix}: failed to decode JSON response`),
    })
  })
}

export const createGitHubAppJwt = Effect.fn("githubApp.createJwt")(function* (
  config: GitHubAppConfig,
) {
  const now = Math.floor(Date.now() / 1000)
  const key = yield* Effect.tryPromise({
    try: () => importPKCS8(normalizePrivateKeyForJose(config.privateKey), "RS256"),
    catch: githubAppError("Failed to import GitHub App private key"),
  })
  return yield* Effect.tryPromise({
    try: () =>
      new SignJWT({})
        .setProtectedHeader({ alg: "RS256", typ: "JWT" })
        .setIssuedAt(now - 60)
        .setExpirationTime(now + 9 * 60)
        .setIssuer(config.appId)
        .sign(key),
    catch: githubAppError("Failed to sign GitHub App JWT"),
  })
})

const listUserInstallationsPage: (
  userAccessToken: string,
  page: number,
  accumulated: readonly GitHubInstallation[],
) => GitHubEffect<GitHubInstallation[]> = Effect.fn("githubApp.listUserInstallationsPage")(
  function* (userAccessToken: string, page: number, accumulated: readonly GitHubInstallation[]) {
    const perPage = 100
    const installationPage = yield* fetchJson<GitHubInstallationResponse>(
      `${GITHUB_API_BASE}/user/installations?per_page=${perPage}&page=${page}`,
      userAccessToken,
      "Failed to list GitHub App installations for user",
    )
    const installations = [...accumulated, ...installationPage.installations]

    return yield* Match.value(installationPage.installations.length < perPage).pipe(
      Match.when(true, () => Effect.succeed(installations)),
      Match.orElse(() => listUserInstallations(userAccessToken, page + 1, installations)),
    )
  },
)

const listUserInstallations: (
  userAccessToken: string,
  page?: number,
  accumulated?: readonly GitHubInstallation[],
) => GitHubEffect<GitHubInstallation[]> = Effect.fn("githubApp.listUserInstallations")(function* (
  userAccessToken: string,
  page = 1,
  accumulated: readonly GitHubInstallation[] = [],
) {
  return yield* Match.value(page >= 100).pipe(
    Match.when(true, () => Effect.succeed([...accumulated])),
    Match.orElse(() => listUserInstallationsPage(userAccessToken, page, accumulated)),
  )
})

const listInstallationRepositories = Effect.fn("githubApp.listInstallationRepositories")(function* (
  userAccessToken: string,
  installationId: number,
  perPage: number,
  page: number,
) {
  return yield* fetchJson<GitHubInstallationRepositoriesResponse>(
    `${GITHUB_API_BASE}/user/installations/${installationId}/repositories?per_page=${perPage}&page=${page}`,
    userAccessToken,
    `Failed to list GitHub App installation repositories for installation ${installationId}`,
  )
})

const listAllInstallationRepositoriesPage: (
  userAccessToken: string,
  installation: GitHubInstallation,
  repoPage: number,
  accumulated: ReadonlyMap<number, GitHubAppRepository>,
) => GitHubEffect<Map<number, GitHubAppRepository>> = Effect.fn(
  "githubApp.listAllInstallationRepositoriesPage",
)(function* (
  userAccessToken: string,
  installation: GitHubInstallation,
  repoPage: number,
  accumulated: ReadonlyMap<number, GitHubAppRepository>,
) {
  const perPage = 100
  const repoResult = yield* listInstallationRepositories(
    userAccessToken,
    installation.id,
    perPage,
    repoPage,
  )
  const repositories = new Map<number, GitHubAppRepository>([
    ...accumulated,
    ...repoResult.repositories.map(
      (repo) => [repo.id, toRepository(repo, installation.id, installation.permissions)] as const,
    ),
  ])

  return yield* Match.value(repoResult.repositories.length < perPage).pipe(
    Match.when(true, () => Effect.succeed(repositories)),
    Match.orElse(() =>
      listAllInstallationRepositories(userAccessToken, installation, repoPage + 1, repositories),
    ),
  )
})

const listAllInstallationRepositories: (
  userAccessToken: string,
  installation: GitHubInstallation,
  repoPage?: number,
  accumulated?: ReadonlyMap<number, GitHubAppRepository>,
) => GitHubEffect<Map<number, GitHubAppRepository>> = Effect.fn(
  "githubApp.listAllInstallationRepositories",
)(function* (
  userAccessToken: string,
  installation: GitHubInstallation,
  repoPage = 1,
  accumulated: ReadonlyMap<number, GitHubAppRepository> = new Map(),
) {
  return yield* Match.value(repoPage >= 100).pipe(
    Match.when(true, () => Effect.succeed(new Map(accumulated))),
    Match.orElse(() =>
      listAllInstallationRepositoriesPage(userAccessToken, installation, repoPage, accumulated),
    ),
  )
})

export const listAccessibleRepositories = Effect.fn("githubApp.listAccessibleRepositories")(
  function* (userAccessToken: string) {
    const installations = yield* listUserInstallations(userAccessToken)
    const perInstallation = yield* Effect.all(
      filterInstallationsByOwner(installations, null).map((installation) =>
        listAllInstallationRepositories(userAccessToken, installation),
      ),
      { concurrency: "unbounded" },
    )
    const repositoriesById = new Map<number, GitHubAppRepository>(
      perInstallation.flatMap((repositories) => [...repositories.entries()]),
    )

    return [...repositoriesById.values()].sort((left, right) =>
      left.fullName.localeCompare(right.fullName),
    )
  },
)

const collectInstallationPageRepositories: (input: {
  userAccessToken: string
  installation: GitHubInstallation
  perPage: number
  firstPage: GitHubInstallationRepositoriesResponse
  repositories: GitHubAppRepository[]
  localIndex: number
}) => GitHubEffect<GitHubAppRepository[]> = Effect.fn(
  "githubApp.collectInstallationPageRepositories",
)(function* (input: {
  userAccessToken: string
  installation: GitHubInstallation
  perPage: number
  firstPage: GitHubInstallationRepositoriesResponse
  repositories: GitHubAppRepository[]
  localIndex: number
}) {
  const shouldStop =
    input.repositories.length >= input.perPage || input.localIndex >= input.firstPage.total_count
  return yield* Match.value(shouldStop).pipe(
    Match.when(true, () => Effect.succeed(input.repositories)),
    Match.orElse(() => collectInstallationPageRepositoriesNext(input)),
  )
})

const collectInstallationPageAccumulator = Effect.fn(
  "githubApp.collectInstallationPageAccumulator",
)(function* (input: {
  userAccessToken: string
  installation: GitHubInstallation
  perPage: number
  firstPage: GitHubInstallationRepositoriesResponse
  repositories: GitHubAppRepository[]
  localIndex: number
  totalCount: number
}) {
  const repositories = yield* collectInstallationPageRepositories(input)
  return { repositories, skipped: 0, totalCount: input.totalCount }
})

const collectInstallationPageRepositoriesNext: (input: {
  userAccessToken: string
  installation: GitHubInstallation
  perPage: number
  firstPage: GitHubInstallationRepositoriesResponse
  repositories: GitHubAppRepository[]
  localIndex: number
}) => GitHubEffect<GitHubAppRepository[]> = Effect.fn(
  "githubApp.collectInstallationPageRepositoriesNext",
)(function* (input: {
  userAccessToken: string
  installation: GitHubInstallation
  perPage: number
  firstPage: GitHubInstallationRepositoriesResponse
  repositories: GitHubAppRepository[]
  localIndex: number
}) {
  const repoPage = Math.floor(input.localIndex / 100) + 1
  const repoResult = yield* Match.value(repoPage === 1).pipe(
    Match.when(true, () => Effect.succeed(input.firstPage)),
    Match.orElse(() =>
      listInstallationRepositories(input.userAccessToken, input.installation.id, 100, repoPage),
    ),
  )
  const pageStartIndex = (repoPage - 1) * 100
  const sliceStart = Math.max(0, input.localIndex - pageStartIndex)
  const capacity = input.perPage - input.repositories.length
  const taken = repoResult.repositories
    .slice(sliceStart)
    .slice(0, capacity)
    .map((repo) => toRepository(repo, input.installation.id, input.installation.permissions))
  const repositories = [...input.repositories, ...taken]
  const advancedLocalIndex = input.localIndex + taken.length
  const shouldStop = repositories.length >= input.perPage || repoResult.repositories.length < 100

  return yield* Match.value(shouldStop).pipe(
    Match.when(true, () => Effect.succeed(repositories)),
    Match.orElse(() =>
      collectInstallationPageRepositories({
        userAccessToken: input.userAccessToken,
        installation: input.installation,
        perPage: input.perPage,
        firstPage: input.firstPage,
        repositories,
        localIndex: Math.max(advancedLocalIndex, pageStartIndex + repoResult.repositories.length),
      }),
    ),
  )
})

const accumulateInstallationPage = Effect.fn("githubApp.accumulateInstallationPage")(function* (
  userAccessToken: string,
  installation: GitHubInstallation,
  perPage: number,
  acc: RepositoryPageAccumulator,
) {
  const firstPage = yield* listInstallationRepositories(userAccessToken, installation.id, 100, 1)
  const totalCount = acc.totalCount + firstPage.total_count

  return yield* Match.value(acc.skipped >= firstPage.total_count).pipe(
    Match.when(true, () =>
      Effect.succeed({
        repositories: acc.repositories,
        skipped: acc.skipped - firstPage.total_count,
        totalCount,
      }),
    ),
    Match.orElse(() =>
      collectInstallationPageAccumulator({
        userAccessToken,
        installation,
        perPage,
        firstPage,
        repositories: acc.repositories,
        localIndex: acc.skipped,
        totalCount,
      }),
    ),
  )
})

export const listAccessibleRepositoriesPage = Effect.fn("githubApp.listAccessibleRepositoriesPage")(
  function* (userAccessToken: string, options: GitHubRepositoryPageOptions = {}) {
    const page = normalizePage(options.page)
    const perPage = normalizePerPage(options.perPage)
    const installations = yield* listUserInstallations(userAccessToken)
    const owners = toRepositoryOwners(installations)
    const matchingInstallations = filterInstallationsByOwner(installations, options.owner)

    const initialAccumulator: GitHubEffect<RepositoryPageAccumulator> = Effect.succeed({
      repositories: [],
      skipped: (page - 1) * perPage,
      totalCount: 0,
    })
    const collected = yield* matchingInstallations.reduce(
      (acc, installation) =>
        acc.pipe(
          Effect.flatMap((current) =>
            accumulateInstallationPage(userAccessToken, installation, perPage, current),
          ),
        ),
      initialAccumulator,
    )

    return {
      repositories: collected.repositories,
      owners,
      page,
      perPage,
      totalCount: collected.totalCount,
      hasMore: page * perPage < collected.totalCount,
    } satisfies GitHubRepositoryPage
  },
)

const searchGitHubRepositories = Effect.fn("githubApp.searchGitHubRepositories")(function* (
  userAccessToken: string,
  query: string,
  options: GitHubRepositorySearchOptions,
  searchPage: number,
) {
  const params = buildRepositorySearchParams(options, searchPage)
  params.set("q", query)

  return yield* fetchJson<GitHubRepositorySearchResponse>(
    `${GITHUB_API_BASE}/search/repositories?${params.toString()}`,
    userAccessToken,
    "Failed to search GitHub repositories",
  )
})

const collectSearchPages: (
  context: SearchInstallationContext,
  query: string,
  installedRepositories: ReadonlyMap<number, GitHubAppRepository>,
  acc: SearchAccumulator,
  searchPage: number,
) => GitHubEffect<SearchAccumulator> = Effect.fn("githubApp.collectSearchPages")(function* (
  context: SearchInstallationContext,
  query: string,
  installedRepositories: ReadonlyMap<number, GitHubAppRepository>,
  acc: SearchAccumulator,
  searchPage: number,
) {
  const shouldStop =
    acc.done || searchPage > context.maxSearchPages || acc.authorized.size > context.targetCount
  return yield* Match.value(shouldStop).pipe(
    Match.when(true, () => Effect.succeed(acc)),
    Match.orElse(() =>
      collectSearchPagesNext(context, query, installedRepositories, acc, searchPage),
    ),
  )
})

const collectSearchPagesNext: (
  context: SearchInstallationContext,
  query: string,
  installedRepositories: ReadonlyMap<number, GitHubAppRepository>,
  acc: SearchAccumulator,
  searchPage: number,
) => GitHubEffect<SearchAccumulator> = Effect.fn("githubApp.collectSearchPagesNext")(function* (
  context: SearchInstallationContext,
  query: string,
  installedRepositories: ReadonlyMap<number, GitHubAppRepository>,
  acc: SearchAccumulator,
  searchPage: number,
) {
  const searchResult = yield* searchGitHubRepositories(
    context.userAccessToken,
    query,
    context.options,
    searchPage,
  )
  const queryHasMore = searchPage * 100 < searchResult.total_count && searchResult.items.length > 0
  const afterItems = applySearchItems(
    context,
    installedRepositories,
    { ...acc, githubHasMore: acc.githubHasMore || queryHasMore },
    searchResult.items,
  )

  return yield* Match.value(afterItems.done || !queryHasMore).pipe(
    Match.when(true, () => Effect.succeed(afterItems)),
    Match.orElse(() =>
      collectSearchPages(context, query, installedRepositories, afterItems, searchPage + 1),
    ),
  )
})

const accumulateSearchInstallation = Effect.fn("githubApp.accumulateSearchInstallation")(function* (
  context: SearchInstallationContext,
  installation: GitHubInstallation,
  acc: SearchAccumulator,
) {
  return yield* Option.match(Option.fromNullishOr(installation.account?.login.toLowerCase()), {
    onNone: () => Effect.succeed(acc),
    onSome: (owner) => accumulateSearchInstallationForOwner(context, installation, acc, owner),
  })
})

const accumulateSearchInstallationForOwner = Effect.fn(
  "githubApp.accumulateSearchInstallationForOwner",
)(function* (
  context: SearchInstallationContext,
  installation: GitHubInstallation,
  acc: SearchAccumulator,
  owner: string,
) {
  const query = buildRepositorySearchQuery(context.options, context.owners, owner)
  const installedRepositories = yield* listAllInstallationRepositories(
    context.userAccessToken,
    installation,
  )
  return yield* collectSearchPages(context, query, installedRepositories, acc, 1)
})

export const searchAccessibleRepositories = Effect.fn("githubApp.searchAccessibleRepositories")(
  function* (userAccessToken: string, options: GitHubRepositorySearchOptions = {}) {
    const page = normalizePage(options.page)
    const perPage = normalizePerPage(options.perPage)
    const installations = yield* listUserInstallations(userAccessToken)
    const owners = toRepositoryOwners(installations)
    const matchingInstallations = filterInstallationsByOwner(installations, options.owner)
    const context: SearchInstallationContext = {
      userAccessToken,
      options,
      owners,
      targetCount: page * perPage,
      maxSearchPages: 10,
    }

    const initialSearchAccumulator: GitHubEffect<SearchAccumulator> = Effect.succeed({
      authorized: new Map<number, GitHubAppRepository>(),
      githubHasMore: false,
      done: false,
    })
    const collected = yield* matchingInstallations.reduce(
      (acc, installation) =>
        acc.pipe(
          Effect.flatMap((current) =>
            Match.value(current.done).pipe(
              Match.when(true, () => Effect.succeed(current)),
              Match.orElse(() => accumulateSearchInstallation(context, installation, current)),
            ),
          ),
        ),
      initialSearchAccumulator,
    )

    const authorizedRepos = [...collected.authorized.values()]
    const offset = (page - 1) * perPage
    const repositories = authorizedRepos.slice(offset, offset + perPage)
    const hasAuthorizedNextPage = authorizedRepos.length > offset + perPage

    return {
      repositories,
      owners,
      page,
      perPage,
      totalCount: null,
      hasMore:
        hasAuthorizedNextPage || (collected.githubHasMore && repositories.length === perPage),
    } satisfies GitHubRepositoryPage
  },
)

export const getAccessibleRepository = Effect.fn("githubApp.getAccessibleRepository")(function* (
  userAccessToken: string,
  owner: string,
  repo: string,
) {
  const normalizedOwner = owner.toLowerCase()
  const normalizedRepo = repo.toLowerCase()
  const repositories = yield* listAccessibleRepositories(userAccessToken)
  return Option.fromNullishOr(
    repositories.find(
      (candidate) => candidate.owner === normalizedOwner && candidate.name === normalizedRepo,
    ),
  )
})

export const requireAccessibleRepository = Effect.fn("githubApp.requireAccessibleRepository")(
  function* (
    userAccessToken: string,
    owner: string,
    repo: string,
    predicate: (candidate: GitHubAppRepository) => boolean,
    message: string,
  ) {
    const repository = yield* getAccessibleRepository(userAccessToken, owner, repo)
    return Option.getOrThrowWith(
      repository.pipe(Option.filter(predicate)),
      () => new GitHubAppError({ message }),
    )
  },
)

export const getGitHubUserProfile = Effect.fn("githubApp.getUserProfile")(function* (
  userAccessToken: string,
) {
  const user = yield* fetchJson<GitHubUserResponse>(
    `${GITHUB_API_BASE}/user`,
    userAccessToken,
    "Failed to fetch GitHub App user profile",
  )
  return toGitHubUserProfile(user)
})

export const createInstallationAccessToken = Effect.fn("githubApp.createInstallationAccessToken")(
  function* (
    config: GitHubAppConfig,
    input: {
      installationId: number
      repositoryId: number
      permissions?: {
        contents?: GitHubAppPermissionLevel
        pull_requests?: GitHubAppPermissionLevel
        metadata?: GitHubAppPermissionLevel
      }
    },
  ) {
    const jwt = yield* createGitHubAppJwt(config)
    const response = yield* fetchWithTimeout(
      `${GITHUB_API_BASE}/app/installations/${input.installationId}/access_tokens`,
      {
        method: "POST",
        headers: githubJsonHeaders(jwt),
        body: stringifyJson({
          repository_ids: [input.repositoryId],
          permissions: input.permissions ?? {
            contents: "write",
            pull_requests: "write",
            metadata: "read",
          },
        }),
      },
    )

    yield* ensureSuccessfulResponse(response, "Failed to create GitHub App installation token")
    const data = yield* Effect.tryPromise({
      try: () => response.json() as Promise<InstallationTokenResponse>,
      catch: githubAppError("Failed to decode GitHub App installation token response"),
    })
    return toInstallationAccessToken(data)
  },
)

export const createPullRequestWithInstallationToken = Effect.fn(
  "githubApp.createPullRequestWithInstallationToken",
)(function* (input: GitHubCreatePullRequestInput) {
  const response = yield* fetchWithTimeout(
    `${GITHUB_API_BASE}/repos/${input.repoOwner}/${input.repoName}/pulls`,
    {
      method: "POST",
      headers: githubJsonHeaders(input.token),
      body: stringifyJson(buildPullRequestBody(input)),
    },
  )

  yield* ensureSuccessfulResponse(response, "Failed to create GitHub pull request")
  const data = yield* Effect.tryPromise({
    try: () => response.json() as Promise<GitHubPullRequestResponse>,
    catch: githubAppError("Failed to decode GitHub pull request response"),
  })
  return toPullRequest(data)
})

export const verifyGitHubWebhookSignature = Effect.fn("githubApp.verifyWebhookSignature")(
  function* (input: { secret: string; signatureHeader: string | null; body: ArrayBuffer }) {
    const signature = input.signatureHeader?.trim() ?? ""
    const verified = yield* Match.value(signature.startsWith("sha256=")).pipe(
      Match.when(false, () => Effect.succeed(false)),
      Match.orElse(() => verifyGitHubWebhookSignatureBytes(input, signature)),
    )
    return verified
  },
)

const verifyGitHubWebhookSignatureBytes = Effect.fn("githubApp.verifyWebhookSignatureBytes")(
  function* (input: { secret: string; body: ArrayBuffer }, signature: string) {
    const signatureBytes = Option.fromNullishOr(hexToBytes(signature.slice("sha256=".length)))
    return yield* Option.match(signatureBytes, {
      onNone: () => Effect.succeed(false),
      onSome: (bytes) => verifyGitHubWebhookSignatureBuffer(input, bytes),
    })
  },
)

const verifyGitHubWebhookSignatureBuffer = Effect.fn("githubApp.verifyWebhookSignatureBuffer")(
  function* (input: { secret: string; body: ArrayBuffer }, signatureBytes: Uint8Array) {
    const signatureBuffer = new ArrayBuffer(signatureBytes.byteLength)
    new Uint8Array(signatureBuffer).set(signatureBytes)

    const encoder = new TextEncoder()
    const key = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.importKey(
          "raw",
          encoder.encode(input.secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["verify"],
        ),
      catch: githubAppError("Failed to import GitHub webhook signing key"),
    })

    return yield* Effect.tryPromise({
      try: () => crypto.subtle.verify("HMAC", key, signatureBuffer, input.body),
      catch: githubAppError("Failed to verify GitHub webhook signature"),
    })
  },
)
