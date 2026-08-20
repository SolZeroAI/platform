// Effect-native runtime and helpers for control-plane HTTP handlers.
//
// Handlers run as Effect programs through `runControlPlane`. Short-circuit responses (auth
// failures, validation errors, setup prompts) are modeled as a tagged `ControlPlaneFailure`
// carrying the JSON payload + status; `runControlPlane` catches it at the boundary and renders
// the HTTP response. Request-scoped logging is always available via the `RequestObservability`
// service, so there is no nullable `log` parameter to thread.
import type { ApiEnv } from "infra/types/env"
import {
  CurrentPrincipal,
  InternalServerError,
  UnauthorizedError,
  type AuthPrincipal,
} from "@solzero/api"
import type { EnrichedRepository, InstallationRepository, RepoMetadata } from "@solzero/shared"
import { getWebUrl } from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { describeError } from "../../../lib/effect-errors"
import type {
  GitHubAppRepository,
  GitHubRepositoryOwner,
  GitHubRepositorySearchOrder,
  GitHubRepositorySearchSort,
  GitHubRepositoryVisibilityFilter,
} from "../../../background/auth/github-app"
import { RepoMetadataStore } from "../../../background/db/repo-metadata"
import { GlobalSecretsStore } from "../../../background/db/repo-secrets"
import { localSpanHeaders, type LocalSpanContext } from "../../../background/observability/tracing"
import type { RunSessionPromptRequest, RunSessionPromptResponse } from "../../../background/types"
import { stringifyJson } from "../../../lib/json"
import * as Context from "effect/Context"
import { D1Drizzle, makeD1Drizzle, type D1DrizzleDatabase } from "../../db/d1-drizzle"
import { getCloudflareBindings } from "../../services/middleware"
import { authenticateControlPlaneRequest } from "../../services/auth"
import {
  annotateCurrentUserIdentity,
  EffectRequestLogger,
  RequestObservability,
  type RequestLogger,
} from "../../services/observability"
import {
  GitHubProvider,
  IdentityProvider,
  providerServicesForEnv,
  type GitHubProviderShape,
  type IdentityProviderShape,
} from "../../services/providers"
import { requireSessionAccess } from "./control-plane/sessions"

export type {
  CreateSessionRequest,
  CreateSessionResponse,
  SlackCreateSessionRequest,
  UpdateSessionToolsRequest,
} from "@solzero/shared"
export type { RunSessionPromptRequest, RunSessionPromptResponse }

export interface ResolvedUserIdentity {
  userId: string
  name: string | null
  email: string | null
  image: string | null
  oktaUserId: string | null
  githubUserId: string | null
  githubAppUserAccessToken: string | null
  githubAppUserAccessTokenExpiresAt: number | null
}

interface RepoListOptions {
  query?: string
  owner?: string
  visibility?: GitHubRepositoryVisibilityFilter
  sort?: GitHubRepositorySearchSort
  order?: GitHubRepositorySearchOrder
  page?: number
  perPage?: number
}

interface EnrichedRepositoryPage {
  repos: EnrichedRepository[]
  owners: GitHubRepositoryOwner[]
  page: number
  perPage: number
  totalCount: number | null
  hasMore: boolean
}

export interface ResolvedAuthorizedRepo {
  repoId: number
  installationId: number
  repoOwner: string
  repoName: string
  defaultBranch: string
  permissions: GitHubAppRepository["permissions"]
}

/** Short-circuit control-plane response carrying a JSON payload + HTTP status. */
export class ControlPlaneFailure extends Schema.TaggedError<ControlPlaneFailure>()(
  "ControlPlaneFailure",
  {
    payload: Schema.Unknown,
    status: Schema.Number,
  },
) {}

export function json(data: unknown, status = 200): Response {
  return new Response(stringifyJson(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status)
}

const failWith = (payload: unknown, status: number) =>
  Effect.fail(new ControlPlaneFailure({ payload, status }))

export const failMessage = (message: string, status: number) => failWith({ error: message }, status)

/** Short-circuits with `message`/`status` when `condition` holds, otherwise no-ops. */
export const failWhen = Effect.fn("controlPlane.failWhen")(function* (
  condition: boolean,
  message: string,
  status: number,
) {
  const guard = Effect.succeed(condition)
  yield* Effect.when(failMessage(message, status), guard)
})

export const failUnless = (condition: boolean, message: string, status: number) =>
  failWhen(!condition, message, status)

/** Resolves an Option into a value, failing with a control-plane short-circuit when absent. */
export function requireOption<A>(option: Option.Option<A>, message: string, status: number) {
  return Effect.gen(function* () {
    return yield* Option.match(option, {
      onNone: () => failMessage(message, status),
      onSome: (value) => Effect.succeed(value),
    })
  })
}

export const logControlPlaneError = Effect.fn("controlPlane.logError")(function* (
  cause: unknown,
  fields: Record<string, unknown>,
) {
  const log = yield* EffectRequestLogger
  yield* log.error(cause, fields)
})

export { describeError }

/** Logs an unhandled control-plane error and renders the legacy 500 response. */
const respondUnhandledError = Effect.fn("controlPlane.respondUnhandledError")(function* (
  cause: unknown,
) {
  yield* logControlPlaneError(cause, { event: "control_plane.unhandled_error" })
  return error(describeError(cause), 500)
})

export function resolvePrincipalUserId(
  _request: Request,
  principal: AuthPrincipal | null,
): Option.Option<string> {
  return Option.map(Option.fromNullishOr(principal), (value) => value.userId)
}

/** Resolves the acting user id, short-circuiting with a 401 when no identity is present. */
export const requirePrincipalUserId = Effect.fn("controlPlane.requirePrincipalUserId")(function* (
  request: Request,
  principal: AuthPrincipal | null,
) {
  return yield* requireOption(resolvePrincipalUserId(request, principal), "Unauthorized", 401)
})

const resolveOktaIdentityAnnotation = Effect.fn("controlPlane.resolveOktaIdentityAnnotation")(
  function* (env: ApiEnv, userId: string, identityProvider: IdentityProviderShape) {
    const oktaUserId = yield* identityProvider
      .resolveOktaUserId(env, userId)
      .pipe(Effect.orElseSucceed(() => null))
    return Option.some<{ userId: string; oktaUserId: string | null }>({ userId, oktaUserId })
  },
)

/**
 * Resolves the user identity annotation context for request observability.
 * Okta resolution failures degrade to a null Okta id instead of failing the request.
 */
export const resolveRequestIdentityAnnotation = Effect.fn(
  "controlPlane.resolveRequestIdentityAnnotation",
)(function* (
  request: Request,
  env: ApiEnv,
  principal: AuthPrincipal | null,
  identityProvider: IdentityProviderShape,
) {
  return yield* Option.match(resolvePrincipalUserId(request, principal), {
    onSome: (userId) => resolveOktaIdentityAnnotation(env, userId, identityProvider),
    onNone: () => Effect.succeed(Option.none()),
  })
})

export function requireGlobalSecretsStore(env: ApiEnv): Option.Option<GlobalSecretsStore> {
  return Option.map(
    Option.fromNullishOr(env.REPO_SECRETS_ENCRYPTION_KEY),
    (key) => new GlobalSecretsStore(makeD1Drizzle(env.DB), key),
  )
}

export const requireGlobalSecretsStoreEffect = Effect.fn("controlPlane.requireGlobalSecretsStore")(
  function* (env: ApiEnv, message: string) {
    return yield* requireOption(requireGlobalSecretsStore(env), message, 500)
  },
)

function normalizeRepoKey(owner: string, name: string): string {
  return `${owner.toLowerCase()}/${name.toLowerCase()}`
}

function enrichRepositories(
  repos: InstallationRepository[],
  metadataMap: Map<string, RepoMetadata>,
): EnrichedRepository[] {
  return repos.map((repo) =>
    Option.match(Option.fromNullishOr(metadataMap.get(normalizeRepoKey(repo.owner, repo.name))), {
      onSome: (metadata) => ({ ...repo, metadata }),
      onNone: () => repo,
    }),
  )
}

function buildGitHubAppInstallUrl(env: ApiEnv): Option.Option<string> {
  return Option.map(
    Option.fromNullishOr(env.GITHUB_APP_SLUG?.trim()).pipe(
      Option.filter((slug) => slug.length > 0),
    ),
    (slug) => `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`,
  )
}

function buildSetupUrl(env: ApiEnv, extraParams?: Record<string, string>): string {
  const baseUrl = getWebUrl(env).replace(/\/+$/, "")
  const params = new URLSearchParams(Object.entries(extraParams ?? {}))
  return Match.value(params.size > 0).pipe(
    Match.when(true, () => `${baseUrl}/settings?${params.toString()}`),
    Match.orElse(() => `${baseUrl}/settings`),
  )
}

export function buildSetupResponse(
  env: ApiEnv,
  message: string,
  status: number,
  extraParams?: Record<string, string>,
): Response {
  return json(
    {
      error: message,
      setupUrl: buildSetupUrl(env, extraParams),
    },
    status,
  )
}

export const failSetup = (
  env: ApiEnv,
  message: string,
  status: number,
  extraParams?: Record<string, string>,
) => failWith({ error: message, setupUrl: buildSetupUrl(env, extraParams) }, status)

/** Short-circuits with a setup-prompt response when `condition` holds, otherwise no-ops. */
export const failSetupWhen = Effect.fn("controlPlane.failSetupWhen")(function* (
  condition: boolean,
  env: ApiEnv,
  message: string,
  status: number,
  extraParams?: Record<string, string>,
) {
  const guard = Effect.succeed(condition)
  yield* Effect.when(failSetup(env, message, status, extraParams), guard)
})

export const resolveUserIdentityByUserId = Effect.fn("controlPlane.resolveUserIdentityByUserId")(
  function* (env: ApiEnv, userId: string, identityProvider: IdentityProviderShape) {
    const profile = yield* requireOption(
      Option.fromNullishOr(yield* identityProvider.getBetterAuthUserProfile(env, userId)),
      "User not found",
      401,
    )
    const githubToken = yield* identityProvider.getGitHubAppUserAccessTokenForUserId(env, userId)
    const oktaUserId = yield* identityProvider.resolveOktaUserId(env, userId)
    return {
      userId,
      name: profile.name,
      email: profile.email,
      image: profile.image,
      oktaUserId,
      githubUserId: githubToken?.githubUserId ?? null,
      githubAppUserAccessToken: githubToken?.accessToken ?? null,
      githubAppUserAccessTokenExpiresAt: githubToken?.accessTokenExpiresAt ?? null,
    } satisfies ResolvedUserIdentity
  },
)

export const resolveUserIdentity = Effect.fn("controlPlane.resolveUserIdentity")(function* (
  request: Request,
  env: ApiEnv,
  principal: AuthPrincipal | null,
  identityProvider: IdentityProviderShape = providerServicesForEnv(env).identityProvider,
) {
  yield* requireOption(Option.fromNullishOr(principal), "Unauthorized", 401)
  const userId = yield* requireOption(
    resolvePrincipalUserId(request, principal),
    "Missing acting user context",
    401,
  )
  return yield* resolveUserIdentityByUserId(env, userId, identityProvider)
})

function shouldUseRepoSearch(options: RepoListOptions): boolean {
  return (
    Boolean(options.query?.trim()) ||
    options.visibility === "private" ||
    options.visibility === "public" ||
    options.sort === "updated"
  )
}

const fetchReposPage = Effect.fn("controlPlane.fetchReposPage")(function* (
  githubProvider: GitHubProviderShape,
  accessToken: string,
  options: RepoListOptions,
) {
  return yield* Match.value(shouldUseRepoSearch(options)).pipe(
    Match.when(true, () =>
      githubProvider.searchAccessibleRepositories(accessToken, {
        query: options.query,
        owner: options.owner,
        visibility: options.visibility ?? "all",
        sort: options.sort ?? "best-match",
        order: options.order ?? "desc",
        page: options.page,
        perPage: options.perPage,
      }),
    ),
    Match.orElse(() =>
      githubProvider.listAccessibleRepositoriesPage(accessToken, {
        owner: options.owner,
        page: options.page,
        perPage: options.perPage,
      }),
    ),
  )
})

const fetchAndEnrichReposPage = Effect.fn("controlPlane.fetchAndEnrichReposPage")(function* (
  env: ApiEnv,
  githubProvider: GitHubProviderShape,
  accessToken: string,
  options: RepoListOptions,
) {
  const pageResult = yield* fetchReposPage(githubProvider, accessToken, options)
  const metadataStore = new RepoMetadataStore(makeD1Drizzle(env.DB))
  const metadataMap = yield* metadataStore
    .getBatch(pageResult.repositories.map((repo) => ({ owner: repo.owner, name: repo.name })))
    .pipe(
      Effect.tapError((cause) =>
        logControlPlaneError(cause, { event: "control_plane.repo_metadata_fetch_failed" }),
      ),
      Effect.orElseSucceed(() => new Map<string, RepoMetadata>()),
    )

  return {
    repos: enrichRepositories(pageResult.repositories, metadataMap),
    owners: pageResult.owners,
    page: pageResult.page,
    perPage: pageResult.perPage,
    totalCount: pageResult.totalCount,
    hasMore: pageResult.hasMore,
  } satisfies EnrichedRepositoryPage
})

export const handleListRepos = Effect.fn("controlPlane.handleListRepos")(function* (
  env: ApiEnv,
  identity: ResolvedUserIdentity,
  options: RepoListOptions = {},
  githubProvider: GitHubProviderShape = providerServicesForEnv(env).githubProvider,
) {
  const accessToken = yield* Option.match(Option.fromNullishOr(identity.githubAppUserAccessToken), {
    onSome: (token) => Effect.succeed(token),
    onNone: () =>
      failSetup(env, "GitHub App is not authorized for this user", 403, { githubSetup: "1" }),
  })
  const page = yield* fetchAndEnrichReposPage(env, githubProvider, accessToken, options).pipe(
    Effect.tapError((cause) =>
      logControlPlaneError(cause, { event: "control_plane.repo_list_failed" }),
    ),
    Effect.catch(() => failMessage("Failed to fetch repositories from GitHub", 500)),
  )
  return json({
    repos: page.repos,
    githubAppInstallUrl: Option.getOrNull(buildGitHubAppInstallUrl(env)),
    owners: page.owners,
    pagination: {
      page: page.page,
      perPage: page.perPage,
      totalCount: page.totalCount,
      hasMore: page.hasMore,
    },
  })
})

const fetchAuthorizedRepo = Effect.fn("controlPlane.fetchAuthorizedRepo")(function* (
  githubProvider: GitHubProviderShape,
  accessToken: string,
  owner: string,
  name: string,
) {
  return Option.map(
    yield* githubProvider.getAccessibleRepository(accessToken, owner, name),
    (resolved): ResolvedAuthorizedRepo => ({
      repoId: resolved.id,
      installationId: resolved.installationId,
      repoOwner: owner,
      repoName: name,
      defaultBranch: resolved.defaultBranch,
      permissions: resolved.permissions,
    }),
  )
})

export const resolveAuthorizedRepo = Effect.fn("controlPlane.resolveAuthorizedRepo")(function* (
  identity: ResolvedUserIdentity,
  repoOwner: string,
  repoName: string,
  githubProvider: GitHubProviderShape,
) {
  const owner = repoOwner.toLowerCase()
  const name = repoName.toLowerCase()
  return yield* Option.match(Option.fromNullishOr(identity.githubAppUserAccessToken), {
    onNone: () => Effect.succeed(Option.none<ResolvedAuthorizedRepo>()),
    onSome: (accessToken) => fetchAuthorizedRepo(githubProvider, accessToken, owner, name),
  })
})

export const resolveIdentityAndRepo = Effect.fn("controlPlane.resolveIdentityAndRepo")(function* (
  request: Request,
  env: ApiEnv,
  principal: AuthPrincipal | null,
  repoOwner: string,
  repoName: string,
  providers = providerServicesForEnv(env),
) {
  const identity = yield* resolveUserIdentity(request, env, principal, providers.identityProvider)
  const repoOption = yield* resolveAuthorizedRepo(
    identity,
    repoOwner,
    repoName,
    providers.githubProvider,
  ).pipe(
    Effect.tapError((cause) =>
      logControlPlaneError(cause, { event: "control_plane.repo_authorization_failed" }),
    ),
    Effect.catch(() => failMessage("Failed to resolve repository", 500)),
  )
  const repo = yield* Option.match(repoOption, {
    onSome: (value) => Effect.succeed(value),
    onNone: () =>
      Option.match(Option.fromNullishOr(identity.githubAppUserAccessToken), {
        onSome: () =>
          failMessage("Repository is not accessible to both this user and the GitHub App", 403),
        onNone: () =>
          failSetup(env, "GitHub App is not authorized for this user", 403, { githubSetup: "1" }),
      }),
  })
  return { identity, repo }
})

function buildSpanTracedRequest(
  url: string,
  init: RequestInit | undefined,
  context: LocalSpanContext,
): Request {
  const headers = new Headers(init?.headers)
  Object.entries(localSpanHeaders(context)).forEach(([key, value]) => headers.set(key, value))
  return new Request(url, { ...init, headers })
}

export function buildInternalRequest(
  url: string,
  init: RequestInit | undefined,
  localSpanContext?: LocalSpanContext,
): Request {
  return Option.match(Option.fromNullishOr(localSpanContext), {
    onNone: () => new Request(url, init),
    onSome: (context) => buildSpanTracedRequest(url, init, context),
  })
}

export interface InternalRequestsService {
  readonly request: (url: string, init?: RequestInit) => Request
  readonly fetch: (
    stub: DurableObjectStub,
    url: string,
    init?: RequestInit,
    // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Service method exposes an Effectful Durable Object fetch.
  ) => Effect.Effect<Response, unknown>
}

export class InternalRequests extends Context.Service<InternalRequests, InternalRequestsService>()(
  "s0/api/InternalRequests",
) {}

export function makeInternalRequests(localSpanContext?: LocalSpanContext): InternalRequestsService {
  return {
    request: (url, init) => buildInternalRequest(url, init, localSpanContext),
    fetch: (stub, url, init) =>
      Effect.tryPromise(() => stub.fetch(buildInternalRequest(url, init, localSpanContext))),
  }
}

export {
  createSessionWithIdentity,
  resolveSlackLinkedUserId,
  enqueuePromptForSession,
  formatSessionListResponse,
  getSessionStub,
  parsePromptExecutionMode,
  requireSessionAccess,
  requireSessionAccessForUser,
  resolveRequestedCustomMcpServers,
  resolveRequestedSessionTools,
  validateRequestedAiSearchSessionTools,
  validateRequestedMcpcfSessionTools,
  validateRequestedSecretKeys,
  waitForPromptResult,
} from "./control-plane/sessions"
export { resolveSessionListToolAvailability } from "./control-plane/session-tool-availability"
export type { AuthPrincipal } from "@solzero/api"

export interface ControlPlaneContext {
  request: Request
  serverRequest: HttpServerRequest.HttpServerRequest
  env: ApiEnv
  ctx: ExecutionContext
  db: D1DrizzleDatabase
  principal: AuthPrincipal | null
  log: RequestLogger
  identityProvider: IdentityProviderShape
  githubProvider: GitHubProviderShape
}

// oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Generic handler contract: A/E/R are the parameters, so the channels must be named explicitly here.
type ControlPlaneHandler<A, E, R> = (context: ControlPlaneContext) => Effect.Effect<A, E, R>

export function toEffectResponse(response: Response) {
  return HttpServerResponse.raw(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
  })
}

export function requestFromSource(request: HttpServerRequest.HttpServerRequest) {
  return Match.value(request.source).pipe(
    Match.when(Match.instanceOf(Request), (source) => source),
    Match.orElse(() => new Request(request.url, { method: request.method })),
  )
}

const toHandlerResponse = (value: unknown): Response =>
  Match.value(value).pipe(
    Match.when(Match.instanceOf(Response), (response) => response),
    Match.orElse((data) => json(data)),
  )

const annotateRequestIdentity = Effect.fn("controlPlane.annotateRequestIdentity")(function* (
  context: ControlPlaneContext,
) {
  const identity = yield* resolveRequestIdentityAnnotation(
    context.request,
    context.env,
    context.principal,
    context.identityProvider,
  ).pipe(Effect.orElseSucceed(() => Option.none<{ userId: string; oktaUserId: string | null }>()))
  yield* Option.match(identity, {
    onNone: () => Effect.void,
    onSome: (value) => annotateCurrentUserIdentity(value),
  })
})

export function runControlPlane<A, E, R>(handler: ControlPlaneHandler<A, E, R>) {
  const program = Effect.gen(function* () {
    const { env, ctx } = yield* getCloudflareBindings
    const db = yield* D1Drizzle
    const serverRequest = yield* HttpServerRequest.HttpServerRequest
    const identityProvider = yield* IdentityProvider
    const githubProvider = yield* GitHubProvider
    const observability = yield* RequestObservability
    const request = requestFromSource(serverRequest)

    const principal = Option.getOrNull(yield* Effect.serviceOption(CurrentPrincipal))
    const context: ControlPlaneContext = {
      request,
      serverRequest,
      env,
      ctx,
      db,
      principal,
      log: observability.log,
      identityProvider,
      githubProvider,
    }
    const internalRequests = makeInternalRequests(observability.context.localTraceContext)
    yield* annotateRequestIdentity(context).pipe(
      Effect.provideService(EffectRequestLogger, observability.effectLog),
    )
    return yield* handler(context).pipe(
      Effect.provideService(InternalRequests, internalRequests),
      Effect.provideService(EffectRequestLogger, observability.effectLog),
      Effect.map(toHandlerResponse),
    )
  })
  const widenedErrors = program.pipe(Effect.mapError((cause): unknown => cause))
  return widenedErrors.pipe(
    Effect.catchIf(
      (cause): cause is ControlPlaneFailure => cause instanceof ControlPlaneFailure,
      (failure) => Effect.succeed(json(failure.payload, failure.status)),
    ),
    Effect.catch(respondUnhandledError),
    Effect.map(toEffectResponse),
  )
}

const authorizeSessionProxy = Effect.fn("controlPlane.authorizeSessionProxy")(function* (
  request: Request,
  env: ApiEnv,
  sessionId: string,
) {
  const principal = yield* authenticateControlPlaneRequest(request, env)
  yield* requireSessionAccess(request, env, principal, sessionId)
  return null
})

/**
 * Promise bridge for the raw Worker preview-proxy router (a non-Effect boundary): authenticates
 * and authorizes a session request, resolving to a short-circuit Response on failure or `null`
 * when access is granted.
 */
export function authorizeSessionProxyRequest(
  request: Request,
  env: ApiEnv,
  sessionId: string,
): Promise<Response | null> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary for the non-Effect Worker preview-proxy router, which cannot import Effect without re-gating its imperative request plumbing.
  return Effect.runPromise(
    authorizeSessionProxy(request, env, sessionId).pipe(
      Effect.catchIf(
        (cause): cause is ControlPlaneFailure => cause instanceof ControlPlaneFailure,
        (failure) => Effect.succeed<Response | null>(json(failure.payload, failure.status)),
      ),
      Effect.catchIf(UnauthorizedError.is, (cause) =>
        Effect.succeed<Response | null>(error(cause.message, 401)),
      ),
      Effect.catchIf(
        (cause): cause is InternalServerError => cause instanceof InternalServerError,
        (cause) => Effect.succeed<Response | null>(error(cause.message, 500)),
      ),
      Effect.catch((cause) => Effect.succeed<Response | null>(error(describeError(cause), 500))),
    ),
  )
}
