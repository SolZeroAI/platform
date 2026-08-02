/* oxlint-disable c0-lint/no-if-statement, c0-lint/no-ternary -- Better Auth request hooks are an imperative adapter boundary whose path/body guards must reject before library route execution. */
import { CREDENTIAL_AUTH_PROVIDER_ID, getStageMetadataSync } from "@c0-agent/shared"
import { betterAuth } from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { hashPassword } from "better-auth/crypto"
import { genericOAuth } from "better-auth/plugins"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import type { ApiEnv } from "infra/types/env"
import { getAdminConfig, isAdminEmailForEnv } from "../background/db/admin-config"
import {
  getAuthProviderRegistry,
  type ResolvedAuthProviderConfig,
  type ResolvedAuthProviderRegistry,
} from "../background/db/auth-config"
import { betterAuthSessionTransferPlugin } from "./better-auth-session-transfer"
import { OKTA_PROVIDER_ID } from "./oauth-tokens"

export {
  type AuthLogSink,
  type LinkedOAuthReconnectContext,
  LinkedOAuthReconnectRequiredError,
  getLinkedOAuthAccessTokenForUserId,
  getOktaAccessTokenForUserId,
  getOktaAccessTokenIssuer,
  type OktaReconnectContext,
  type OktaReconnectReason,
  OktaAccountReconnectRequiredError,
  OKTA_PROVIDER_ID,
  normalizeOktaAuthorizationServerIssuerUrl,
} from "./oauth-tokens"

export interface BetterAuthUserProfile {
  id: string
  name: string | null
  email: string | null
  image: string | null
}

export interface BetterAuthSessionContext {
  user: {
    id: string
    name: string
    email: string
    image?: string | null
  }
  githubAccountId: string | null
  isAdmin: boolean
}

const GITHUB_PROVIDER_ID = "github"
const GITHUB_APP_USER_TOKEN_PREFIX = "ghu_"
const GITHUB_APP_REFRESH_TOKEN_PREFIX = "ghr_"
const GITHUB_TOKEN_REFRESH_BUFFER_MS = 60_000
const BETTER_AUTH_CLIENT_IP_HEADERS = [
  "cf-connecting-ip",
  "true-client-ip",
  "x-forwarded-for",
  "x-real-ip",
]

interface GitHubAccountTokenRow {
  id: string
  accountId: string
  accessToken: string | null
  refreshToken: string | null
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
}

interface GitHubRefreshTokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  refresh_token_expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

type GitHubAppUserToken = {
  accessToken: string
  accessTokenExpiresAt: number | null
}

type GitHubAppRefreshInput =
  | {
      kind: "refresh"
      db: ApiEnv & { DB: D1Database & { prepare: (...args: unknown[]) => D1PreparedStatement } }
      clientId: string
      clientSecret: string
      refreshToken: string
    }
  | { kind: "skip" }

type LinkedGitHubAccount =
  | {
      kind: "linked"
      accountId: string
    }
  | { kind: "missing" }

type GitHubTokenRefreshFailure =
  | { kind: "missing_token_data" }
  | { kind: "invalid_token_data"; tokenData: GitHubRefreshTokenResponse }

function normalizeBaseUrl(value: string | undefined): string {
  return (value || "http://localhost:3000").replace(/\/+$/, "")
}

function hasQueryableDb(
  env: ApiEnv,
): env is ApiEnv & { DB: D1Database & { prepare: (...args: unknown[]) => D1PreparedStatement } } {
  return Boolean(env.DB && typeof (env.DB as { prepare?: unknown }).prepare === "function")
}

function profileString(profile: Record<string, unknown>, key: string): Option.Option<string> {
  return Option.fromNullishOr(profile[key]).pipe(
    Option.filter((value): value is string => typeof value === "string"),
    Option.map((value) => value.trim()),
    Option.filter((value) => value.length > 0),
  )
}

function mapOidcProfile(profile: Record<string, unknown>) {
  const email = profileString(profile, "email")
  const id = profileString(profile, "sub").pipe(Option.orElse(() => profileString(profile, "id")))
  const name = profileString(profile, "name").pipe(
    Option.orElse(() => profileString(profile, "preferred_username")),
    Option.orElse(() => email),
  )

  return {
    id: Option.getOrUndefined(id),
    email: Option.getOrUndefined(email),
    name: Option.getOrUndefined(name),
  }
}

function oidcConfig(providerId: string, config: ResolvedAuthProviderConfig) {
  return config.kind === "oidc" && config.enabled
    ? [
        {
          providerId,
          discoveryUrl: `${config.issuer}/.well-known/openid-configuration`,
          issuer: config.issuer,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          scopes: [...(config.scopes ?? [])],
          pkce: true,
          disableSignUp: !config.capabilities.provisionUsers,
          mapProfileToUser: mapOidcProfile,
        },
      ]
    : []
}

const DISABLED_CREDENTIAL_PATHS = new Set([
  "/sign-up/email",
  "/change-password",
  "/set-password",
  "/request-password-reset",
  "/reset-password",
])

function requestString(body: unknown, field: "email" | "provider" | "providerId"): string {
  return typeof body === "object" && body !== null && typeof Reflect.get(body, field) === "string"
    ? String(Reflect.get(body, field)).trim().toLowerCase()
    : ""
}

function requireProviderCapability(
  registry: ResolvedAuthProviderRegistry,
  providerId: string,
  capability: "signIn" | "link",
) {
  const provider = registry.providers[providerId]
  if (!provider?.enabled || !provider.capabilities[capability]) {
    throw new APIError("FORBIDDEN", {
      message: `Provider '${providerId || "unknown"}' is not allowed to ${capability === "signIn" ? "sign in" : "link accounts"}`,
    })
  }
}

function authPolicyHook(env: ApiEnv, registry: ResolvedAuthProviderRegistry) {
  return createAuthMiddleware(async (context) => {
    if (DISABLED_CREDENTIAL_PATHS.has(context.path)) {
      throw new APIError("FORBIDDEN", {
        message: "Credential lifecycle is managed through deployment configuration",
      })
    }
    if (context.path === "/sign-in/email") {
      requireProviderCapability(registry, CREDENTIAL_AUTH_PROVIDER_ID, "signIn")
      const email = requestString(context.body, "email")
      // oxlint-disable-next-line effect/effect-run-in-body -- Better Auth requires a Promise-returning middleware callback at this boundary.
      const adminConfig = await Effect.runPromise(getAdminConfig(env))
      if (!new Set<string>(adminConfig.adminEmails).has(email)) {
        await hashPassword("c0-invalid-managed-credential")
        throw new APIError("UNAUTHORIZED", { message: "Invalid email or password" })
      }
    }
    if (context.path === "/sign-in/social") {
      requireProviderCapability(registry, requestString(context.body, "provider"), "signIn")
    }
    if (context.path === "/sign-in/oauth2") {
      requireProviderCapability(registry, requestString(context.body, "providerId"), "signIn")
    }
    if (context.path === "/link-social") {
      requireProviderCapability(registry, requestString(context.body, "provider"), "link")
    }
    if (context.path === "/oauth2/link") {
      requireProviderCapability(registry, requestString(context.body, "providerId"), "link")
    }
  })
}

function resolveBetterAuthSecret(env: ApiEnv, stageName: string): string {
  return Option.fromNullishOr(env.BETTER_AUTH_SECRET).pipe(
    Option.map((value) => value.trim()),
    Option.filter((value) => value.length > 0),
    Option.getOrElse(() =>
      Match.value(stageName).pipe(
        Match.when("dev", () => "better-auth-dev-secret-change-me"),
        Match.orElse(() => {
          throw new Error("BETTER_AUTH_SECRET is required outside local development")
        }),
      ),
    ),
  )
}

function toDateMs(value: Date | string | number): number {
  return Match.value(value).pipe(
    Match.when(
      (candidate): candidate is Date => candidate instanceof Date,
      (date) => date.getTime(),
    ),
    Match.when(
      (candidate): candidate is number => typeof candidate === "number",
      (numberValue) => numberValue,
    ),
    Match.orElse((dateValue) => Date.parse(dateValue)),
  )
}

function parseDateMsOption(
  value: Date | string | number | null | undefined,
): Option.Option<number> {
  return Option.fromNullishOr(value).pipe(
    Option.map(toDateMs),
    Option.filter((ms) => Number.isFinite(ms)),
  )
}

function isGithubAppUserAccessToken(value: string | null | undefined): value is string {
  return Boolean(value?.startsWith(GITHUB_APP_USER_TOKEN_PREFIX))
}

function isGithubAppRefreshToken(value: string | null | undefined): value is string {
  return Boolean(value?.startsWith(GITHUB_APP_REFRESH_TOKEN_PREFIX))
}

function expiresAtFromSecondsOption(seconds: number | undefined): Option.Option<string> {
  return Option.fromNullishOr(seconds).pipe(
    Option.filter((value) => Number.isFinite(value) && value > 0),
    Option.map((value) => new Date(Date.now() + value * 1000).toISOString()),
  )
}

function formatAuthError(error: unknown): string {
  return Match.value(error).pipe(
    Match.when(
      (value: unknown): value is Error => value instanceof Error,
      (resolved) => resolved.message,
    ),
    Match.orElse(String),
  )
}

function validGitHubAppUserTokenOption(
  githubUserId: string,
  token: {
    accessToken?: string | null
    accessTokenExpiresAt?: Date | string | number | null
  },
) {
  const accessTokenExpiresAt = Option.getOrNull(parseDateMsOption(token.accessTokenExpiresAt))
  return Option.liftPredicate(
    token,
    (resolved) =>
      isGithubAppUserAccessToken(resolved.accessToken) &&
      (accessTokenExpiresAt === null ||
        accessTokenExpiresAt - Date.now() > GITHUB_TOKEN_REFRESH_BUFFER_MS),
  ).pipe(
    Option.map((resolved) => ({
      githubUserId,
      accessToken: resolved.accessToken,
      accessTokenExpiresAt,
    })),
  )
}

function invalidTokenRefreshFailureOption(
  failure: unknown,
): Option.Option<Extract<GitHubTokenRefreshFailure, { kind: "invalid_token_data" }>> {
  return Option.liftPredicate(
    failure,
    (value): value is Extract<GitHubTokenRefreshFailure, { kind: "invalid_token_data" }> =>
      Boolean(value) &&
      value !== null &&
      typeof value === "object" &&
      "kind" in value &&
      value.kind === "invalid_token_data" &&
      "tokenData" in value,
  )
}

function logInvalidGitHubTokenRefresh(
  input: {
    env: ApiEnv & { DB: D1Database & { prepare: (...args: unknown[]) => D1PreparedStatement } }
    row: GitHubAccountTokenRow
    response: HttpClientResponse.HttpClientResponse
  },
  tokenData: GitHubRefreshTokenResponse,
) {
  const shouldDeleteBadRefreshToken = Effect.succeed(tokenData.error === "bad_refresh_token")
  const cleanupBadRefreshToken = deleteGitHubAccountTokenRow(input.env, input.row.id).pipe(
    Effect.when(shouldDeleteBadRefreshToken),
    Effect.asVoid,
  )
  return logBetterAuthWarning("Failed to refresh GitHub App user access token:", {
    status: input.response.status,
    error: tokenData.error,
    errorDescription: tokenData.error_description,
  }).pipe(
    Effect.andThen(cleanupBadRefreshToken),
    Effect.map(() => Option.none<GitHubAppUserToken>()),
  )
}

const logBetterAuthWarning = (message: string, context: Record<string, unknown>) =>
  Effect.logWarning(message).pipe(Effect.annotateLogs(context))

const getGitHubAccountTokenRow = Effect.fn("auth.betterAuth.githubAccountTokenRow")(function* (
  env: ApiEnv,
  userId: string,
) {
  return yield* Effect.succeed(env).pipe(
    Effect.filterOrFail(hasQueryableDb, () => "missing_db" as const),
    Effect.flatMap((dbEnv) =>
      Effect.tryPromise(() =>
        dbEnv.DB.prepare(
          `SELECT "id", "accountId", "accessToken", "refreshToken", "accessTokenExpiresAt", "refreshTokenExpiresAt"
           FROM "account"
           WHERE "providerId" = ?1 AND "userId" = ?2
           ORDER BY "updatedAt" DESC
           LIMIT 1`,
        )
          .bind(GITHUB_PROVIDER_ID, userId)
          .first<GitHubAccountTokenRow>(),
      ).pipe(Effect.map(Option.fromNullishOr)),
    ),
    Effect.catch(() => Effect.succeed(Option.none<GitHubAccountTokenRow>())),
  )
})

function postUrlEncodedForm(url: string, body: Record<string, string>) {
  const fetch = globalThis.fetch
  return HttpClient.execute(
    HttpClientRequest.post(url, {
      headers: { Accept: "application/json" },
    }).pipe(HttpClientRequest.bodyUrlParams(body)),
  ).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch), Effect.provide(FetchHttpClient.layer))
}

const refreshGitHubAppUserToken = Effect.fn("auth.betterAuth.refreshGitHubAppUserToken")(function* (
  env: ApiEnv,
  row: GitHubAccountTokenRow,
) {
  const refreshInput = Option.all({
    db: Option.liftPredicate(env, hasQueryableDb),
    clientId: Option.fromNullishOr(env.GITHUB_APP_CLIENT_ID),
    clientSecret: Option.fromNullishOr(env.GITHUB_APP_CLIENT_SECRET),
    refreshToken: Option.liftPredicate(row.refreshToken, isGithubAppRefreshToken),
  })

  const resolvedInput: GitHubAppRefreshInput = Option.match(refreshInput, {
    onNone: () => ({ kind: "skip" }),
    onSome: ({ db, clientId, clientSecret, refreshToken }) => ({
      kind: "refresh",
      db,
      clientId,
      clientSecret,
      refreshToken,
    }),
  })

  return yield* Effect.succeed(resolvedInput).pipe(
    Effect.filterOrFail(
      (input): input is Extract<GitHubAppRefreshInput, { kind: "refresh" }> =>
        input.kind === "refresh",
      () => "skip_refresh" as const,
    ),
    Effect.flatMap(({ db, clientId, clientSecret, refreshToken }) =>
      refreshGitHubAppUserTokenWithCredentials({
        env: db,
        row,
        clientId,
        clientSecret,
        refreshToken,
      }),
    ),
    Effect.catch(() => Effect.succeed(Option.none<GitHubAppUserToken>())),
  )
})

const refreshGitHubAppUserTokenWithCredentials = Effect.fn(
  "auth.betterAuth.refreshGitHubAppUserTokenWithCredentials",
)(function* (input: {
  env: ApiEnv & { DB: D1Database & { prepare: (...args: unknown[]) => D1PreparedStatement } }
  row: GitHubAccountTokenRow
  clientId: string
  clientSecret: string
  refreshToken: string
}) {
  const responseOption = yield* postUrlEncodedForm("https://github.com/login/oauth/access_token", {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  }).pipe(
    Effect.map(Option.some),
    Effect.catch((errorValue) =>
      logBetterAuthWarning("Failed to refresh GitHub App user access token:", {
        error: formatAuthError(errorValue),
      }).pipe(Effect.map(() => Option.none())),
    ),
  )

  return yield* Effect.succeed(responseOption).pipe(
    Effect.filterOrFail(Option.isSome, () => "missing_response" as const),
    Effect.flatMap(({ value: response }) =>
      refreshGitHubAppUserTokenFromResponse({
        ...input,
        response,
      }),
    ),
    Effect.catch(() => Effect.succeed(Option.none<GitHubAppUserToken>())),
  )
})

const refreshGitHubAppUserTokenFromResponse = Effect.fn(
  "auth.betterAuth.refreshGitHubAppUserTokenFromResponse",
)(function* (input: {
  env: ApiEnv & { DB: D1Database & { prepare: (...args: unknown[]) => D1PreparedStatement } }
  row: GitHubAccountTokenRow
  response: HttpClientResponse.HttpClientResponse
}) {
  const tokenDataOption = yield* input.response.json.pipe(
    Effect.map((tokenData) => Option.some(tokenData as GitHubRefreshTokenResponse)),
    Effect.catch((errorValue) =>
      logBetterAuthWarning("Failed to parse GitHub App user access token refresh response:", {
        error: formatAuthError(errorValue),
      }).pipe(Effect.map(() => Option.none<GitHubRefreshTokenResponse>())),
    ),
  )

  return yield* Effect.succeed(tokenDataOption).pipe(
    Effect.filterOrFail(Option.isSome, () => ({ kind: "missing_token_data" as const })),
    Effect.map(({ value }) => value),
    Effect.filterOrFail(
      (tokenData) =>
        input.response.status >= 200 &&
        input.response.status < 300 &&
        !tokenData.error &&
        isGithubAppUserAccessToken(tokenData.access_token),
      (tokenData) => ({ kind: "invalid_token_data" as const, tokenData }),
    ),
    Effect.flatMap((tokenData) =>
      persistGitHubAppUserTokenRefresh(input.env, input.row, {
        ...tokenData,
        access_token: tokenData.access_token,
      }),
    ),
    Effect.catch((failure) =>
      Effect.fromOption(invalidTokenRefreshFailureOption(failure)).pipe(
        Effect.flatMap(({ tokenData }) => logInvalidGitHubTokenRefresh(input, tokenData)),
        Effect.catch(() => Effect.succeed(Option.none<GitHubAppUserToken>())),
      ),
    ),
  )
})

const persistGitHubAppUserTokenRefresh = Effect.fn(
  "auth.betterAuth.persistGitHubAppUserTokenRefresh",
)(function* (
  env: ApiEnv & { DB: D1Database & { prepare: (...args: unknown[]) => D1PreparedStatement } },
  row: GitHubAccountTokenRow,
  tokenData: GitHubRefreshTokenResponse & { access_token?: string },
) {
  const accessTokenExpiresAt = Option.getOrNull(expiresAtFromSecondsOption(tokenData.expires_in))
  const refreshToken = tokenData.refresh_token ?? row.refreshToken
  const refreshTokenExpiresAt =
    Option.getOrNull(expiresAtFromSecondsOption(tokenData.refresh_token_expires_in)) ??
    row.refreshTokenExpiresAt

  yield* Effect.tryPromise(() =>
    env.DB.prepare(
      `UPDATE "account"
       SET "accessToken" = ?1,
           "refreshToken" = ?2,
           "accessTokenExpiresAt" = ?3,
           "refreshTokenExpiresAt" = ?4,
           "scope" = ?5,
           "updatedAt" = ?6
       WHERE "id" = ?7`,
    )
      .bind(
        tokenData.access_token,
        refreshToken,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        tokenData.scope ?? "",
        new Date().toISOString(),
        row.id,
      )
      .run(),
  )

  return Option.some({
    accessToken: tokenData.access_token as string,
    accessTokenExpiresAt: Option.getOrNull(parseDateMsOption(accessTokenExpiresAt)),
  })
})

const deleteGitHubAccountTokenRow = Effect.fn("auth.betterAuth.deleteGitHubAccountTokenRow")(
  function* (env: ApiEnv, accountRowId: string) {
    yield* Effect.succeed(env).pipe(
      Effect.filterOrFail(hasQueryableDb, () => "missing_db" as const),
      Effect.flatMap((dbEnv) =>
        Effect.tryPromise(() =>
          dbEnv.DB.prepare(`DELETE FROM "account" WHERE "id" = ?1 AND "providerId" = ?2`)
            .bind(accountRowId, GITHUB_PROVIDER_ID)
            .run(),
        ),
      ),
      Effect.catch(() => Effect.void),
    )
  },
)

export function createBetterAuth(env: ApiEnv, authConfig?: ResolvedAuthProviderRegistry) {
  const stageMetadata = getStageMetadataSync(env)
  const baseURL = normalizeBaseUrl(stageMetadata.infra.authBaseUrl)
  const registry = authConfig ?? { defaultSignInProviderId: "", providers: {} }
  const genericOAuthConfigs = Object.entries(registry.providers).flatMap(([providerId, provider]) =>
    oidcConfig(providerId, provider),
  )
  const socialProviders: Record<string, Record<string, unknown>> = Object.fromEntries(
    Object.entries(registry.providers)
      .filter(
        (entry): entry is [string, Extract<ResolvedAuthProviderConfig, { kind: "social" }>] =>
          entry[1].kind === "social" && entry[1].enabled,
      )
      .map(([providerId, provider]) => [
        providerId,
        {
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
          scopes: provider.scopes,
          disableSignUp: !provider.capabilities.provisionUsers,
        },
      ]),
  )
  const genericOAuthPlugins = Match.value(genericOAuthConfigs.length > 0).pipe(
    Match.when(true, () => [
      genericOAuth({
        config: genericOAuthConfigs,
      }),
    ]),
    Match.orElse(() => []),
  )
  const plugins = [
    ...genericOAuthPlugins,
    ...Match.value(stageMetadata.app.betterAuthSessionTransferEnabled).pipe(
      Match.when(true, () => [betterAuthSessionTransferPlugin(env)]),
      Match.orElse(() => []),
    ),
  ]

  return betterAuth({
    database: env.DB,
    baseURL,
    basePath: "/api/auth",
    trustedOrigins: [...new Set(stageMetadata.infra.authTrustedOrigins.map(normalizeBaseUrl))],
    secret: resolveBetterAuthSecret(env, stageMetadata.name),
    advanced: {
      ipAddress: {
        ipAddressHeaders: BETTER_AUTH_CLIENT_IP_HEADERS,
      },
      skipTrailingSlashes: true,
    },
    emailAndPassword: {
      enabled:
        registry.providers[CREDENTIAL_AUTH_PROVIDER_ID]?.enabled === true &&
        registry.providers[CREDENTIAL_AUTH_PROVIDER_ID]?.capabilities.signIn === true,
      disableSignUp: true,
    },
    hooks: {
      before: authPolicyHook(env, registry),
    },
    socialProviders,
    account: {
      accountLinking: {
        allowDifferentEmails: true,
        disableImplicitLinking: true,
        trustedProviders: Object.entries(registry.providers)
          .filter(([, provider]) => provider.enabled && provider.capabilities.link)
          .map(([providerId]) => providerId),
      },
    },
    plugins,
  })
}

export const getLinkedUserIdByProviderAccountId = Effect.fn(
  "auth.betterAuth.getLinkedUserIdByProviderAccountId",
)(function* (env: ApiEnv, providerId: string, accountId: string) {
  return yield* Effect.succeed(env).pipe(
    Effect.filterOrFail(hasQueryableDb, () => "missing_db" as const),
    Effect.flatMap((dbEnv) =>
      Effect.tryPromise(() =>
        dbEnv.DB.prepare(
          `SELECT "userId"
           FROM "account"
           WHERE "providerId" = ?1 AND "accountId" = ?2
           LIMIT 1`,
        )
          .bind(providerId, accountId)
          .first<{ userId: string }>(),
      ).pipe(Effect.map((row) => row?.userId ?? null)),
    ),
    Effect.catch(() => Effect.succeed(null)),
  )
})

export const getBetterAuthUserProfile = Effect.fn("auth.betterAuth.getBetterAuthUserProfile")(
  function* (env: ApiEnv, userId: string) {
    return yield* Effect.succeed(env).pipe(
      Effect.filterOrFail(hasQueryableDb, () => "missing_db" as const),
      Effect.flatMap((dbEnv) =>
        Effect.tryPromise(() =>
          dbEnv.DB.prepare(
            `SELECT "id", "name", "email", "image"
             FROM "user"
             WHERE "id" = ?1
             LIMIT 1`,
          )
            .bind(userId)
            .first<BetterAuthUserProfile>(),
        ).pipe(Effect.map((row) => row ?? null)),
      ),
      Effect.catch(() => Effect.succeed(null)),
    )
  },
)

export const getLinkedProviderAccountIdForUser = Effect.fn(
  "auth.betterAuth.getLinkedProviderAccountIdForUser",
)(function* (env: ApiEnv, providerId: string, userId: string) {
  return yield* Effect.succeed(env).pipe(
    Effect.filterOrFail(hasQueryableDb, () => "missing_db" as const),
    Effect.flatMap((dbEnv) =>
      Effect.tryPromise(() =>
        dbEnv.DB.prepare(
          `SELECT "accountId"
           FROM "account"
           WHERE "providerId" = ?1 AND "userId" = ?2
           LIMIT 1`,
        )
          .bind(providerId, userId)
          .first<{ accountId: string }>(),
      ).pipe(Effect.map((row) => row?.accountId ?? null)),
    ),
    Effect.catch(() => Effect.succeed(null)),
  )
})

export function normalizeUserId(value: string): string {
  const normalized = value
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "_")
  return Match.value(normalized.length > 0).pipe(
    Match.when(true, () => normalized),
    Match.orElse(() => {
      throw new Error("userId is required")
    }),
  )
}

export const resolveOktaUserId = Effect.fn("auth.betterAuth.resolveOktaUserId")(function* (
  env: ApiEnv,
  userId: string,
) {
  return yield* getLinkedProviderAccountIdForUser(env, OKTA_PROVIDER_ID, userId)
})

export function prefixStorageKeyWithUserId(userId: string, key: string): string {
  const normalizedUserId = normalizeUserId(userId)
  const normalizedKey = key.trim().replace(/^\/+/, "")
  return Match.value(
    normalizedKey === normalizedUserId || normalizedKey.startsWith(`${normalizedUserId}/`),
  ).pipe(
    Match.when(true, () => normalizedKey),
    Match.orElse(() => `${normalizedUserId}/${normalizedKey}`),
  )
}

const resolveGitHubAppUserAccessTokenFromBetterAuth = Effect.fn(
  "auth.betterAuth.resolveGitHubAppUserAccessTokenFromBetterAuth",
)(function* (env: ApiEnv, userId: string) {
  const githubUserId = yield* getLinkedProviderAccountIdForUser(env, GITHUB_PROVIDER_ID, userId)
  const authConfig = yield* getAuthProviderRegistry(env)
  const linkedAccount: LinkedGitHubAccount = Option.match(Option.fromNullishOr(githubUserId), {
    onNone: () => ({ kind: "missing" }),
    onSome: (accountId) => ({ kind: "linked", accountId }),
  })

  return yield* Effect.succeed(linkedAccount).pipe(
    Effect.filterOrFail(
      (account): account is Extract<LinkedGitHubAccount, { kind: "linked" }> =>
        account.kind === "linked",
      () => "missing_account" as const,
    ),
    Effect.flatMap(({ accountId }) =>
      Effect.tryPromise(() =>
        createBetterAuth(env, authConfig).api.getAccessToken({
          body: {
            providerId: GITHUB_PROVIDER_ID,
            accountId,
            userId,
          },
        }),
      ).pipe(
        Effect.map((token) => Option.getOrNull(validGitHubAppUserTokenOption(accountId, token))),
      ),
    ),
    Effect.catch(() => Effect.succeed(null)),
  )
})

const getGitHubAppUserAccessTokenFromRow = Effect.fn(
  "auth.betterAuth.getGitHubAppUserAccessTokenFromRow",
)(function* (env: ApiEnv, row: GitHubAccountTokenRow) {
  const currentTokenOption = validGitHubAppUserTokenOption(row.accountId, {
    accessToken: row.accessToken,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
  })

  return yield* Effect.succeed(currentTokenOption).pipe(
    Effect.filterOrFail(Option.isSome, () => "missing_current_token" as const),
    Effect.map(({ value }) => value),
    Effect.catch(() =>
      refreshGitHubAppUserToken(env, row).pipe(
        Effect.map((refreshedToken) =>
          Option.getOrNull(
            Option.map(refreshedToken as Option.Option<GitHubAppUserToken>, (token) => ({
              githubUserId: row.accountId,
              accessToken: token.accessToken,
              accessTokenExpiresAt: token.accessTokenExpiresAt,
            })),
          ),
        ),
      ),
    ),
  )
})

export const getGitHubAppUserAccessTokenForUserId = Effect.fn(
  "auth.betterAuth.getGitHubAppUserAccessTokenForUserId",
)(function* (env: ApiEnv, userId: string) {
  const rowOption = yield* getGitHubAccountTokenRow(env, userId)
  return yield* Effect.succeed(rowOption).pipe(
    Effect.filterOrFail(Option.isSome, () => "missing_row" as const),
    Effect.flatMap(({ value: row }) => getGitHubAppUserAccessTokenFromRow(env, row)),
    Effect.catch(() =>
      resolveGitHubAppUserAccessTokenFromBetterAuth(env, userId).pipe(
        Effect.catch((errorValue) =>
          logBetterAuthWarning("Failed to resolve GitHub App user access token from Better Auth:", {
            error: formatAuthError(errorValue),
          }).pipe(Effect.map(() => null)),
        ),
      ),
    ),
  )
})

export const getSessionContextFromHeaders = Effect.fn(
  "auth.betterAuth.getSessionContextFromHeaders",
)(function* (env: ApiEnv, requestHeaders: HeadersInit) {
  const authConfig = yield* getAuthProviderRegistry(env)
  const session = yield* Effect.tryPromise(() =>
    createBetterAuth(env, authConfig).api.getSession({
      headers: new Headers(requestHeaders),
    }),
  )

  return yield* Effect.succeed(Option.fromNullishOr(session?.user)).pipe(
    Effect.filterOrFail(Option.isSome, () => "missing_session_user" as const),
    Effect.flatMap(({ value: user }) =>
      Effect.all(
        [
          getLinkedProviderAccountIdForUser(env, "github", user.id),
          isAdminEmailForEnv(env, user.email),
        ],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map(([githubAccountId, isAdmin]) => ({
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image ?? null,
          },
          githubAccountId,
          isAdmin,
        })),
      ),
    ),
    Effect.catch(() => Effect.succeed(null)),
  )
})
