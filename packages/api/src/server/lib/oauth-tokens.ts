import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import type { ApiEnv } from "infra/types/env"
import {
  hasControlPlane,
  runControlPlaneSql,
  runControlPlaneSqlFirst,
} from "../effect/db/control-plane-db"
import {
  getAuthProviderRegistry,
  type ResolvedAuthProviderConfig,
} from "../background/db/auth-config"
import { parseJsonRecord } from "./json"

export const OKTA_PROVIDER_ID = "okta"
const OKTA_TOKEN_REFRESH_BUFFER_MS = 60_000

type OAuthAccountTokenRow = {
  id: string
  accountId: string
  accessToken: string | null
  refreshToken: string | null
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
  scope: string | null
}

type QueryableApiEnv = ApiEnv

type OAuthAccessTokenResult = {
  accessToken: string
  accessTokenExpiresAt: number | null
}

type OktaRefreshCredentials = {
  issuer: string
  clientId: string
  clientSecret: string
}

type OktaRefreshInput =
  | {
      kind: "refresh"
      env: QueryableApiEnv
      issuer: string
      clientId: string
      clientSecret: string
      refreshToken: string
    }
  | { kind: "skip" }

export type OktaReconnectReason =
  | "missing_account"
  | "missing_access_token"
  | "missing_refresh_token"
  | "expired_refresh_token"
  | "refresh_unavailable"
  | "invalid_issuer"

export interface OktaReconnectContext {
  reason: OktaReconnectReason
  oktaUserId?: string
  hasAccessToken?: boolean
  hasRefreshToken?: boolean
  accessTokenExpiresAt?: string | null
  refreshTokenExpiresAt?: string | null
  scopeHasOfflineAccess?: boolean
  tokenIssuer?: string | null
  expectedIssuer?: string | null
}

export interface LinkedOAuthReconnectContext {
  providerId: string
  reason:
    | OktaReconnectReason
    | "expired_access_token"
    | "provider_refresh_unsupported"
    | "invalid_issuer"
  providerUserId?: string
  hasAccessToken?: boolean
  hasRefreshToken?: boolean
  accessTokenExpiresAt?: string | null
  refreshTokenExpiresAt?: string | null
  tokenIssuer?: string | null
  expectedIssuer?: string | null
}

interface OktaRefreshTokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  refresh_token_expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

export interface AuthLogSink {
  error(error: Error, event?: Record<string, unknown>): void
}

export class OktaAccountReconnectRequiredError extends Error {
  readonly context: OktaReconnectContext

  constructor(input: { message?: string; context: OktaReconnectContext }) {
    const message = input.message ?? "Reconnect Okta in Settings to use MCP Context Forge tools."
    super(message)
    this.name = "OktaAccountReconnectRequiredError"
    this.context = input.context
  }
}

export class LinkedOAuthReconnectRequiredError extends Error {
  readonly context: LinkedOAuthReconnectContext

  constructor(input: { message?: string; context: LinkedOAuthReconnectContext }) {
    super(
      input.message ?? "Reconnect your configured OAuth account to use MCP Context Forge tools.",
    )
    this.name = "LinkedOAuthReconnectRequiredError"
    this.context = input.context
  }
}

function hasQueryableDb(env: ApiEnv): env is QueryableApiEnv {
  return hasControlPlane(env)
}

function normalizeIssuerUrlOption(value: string | undefined): Option.Option<string> {
  return Option.fromNullishOr(value).pipe(
    Option.map((rawValue) => rawValue.trim().replace(/\/+$/, "")),
    Option.filter((trimmed) => trimmed.length > 0),
    Option.map(normalizeIssuerProtocol),
  )
}

function normalizeIssuerProtocol(trimmed: string): string {
  const withProtocol = Match.value(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)).pipe(
    Match.when(true, () => trimmed),
    Match.orElse(() => `https://${trimmed}`),
  )
  return new URL(withProtocol).toString().replace(/\/+$/, "")
}

function normalizeIssuerUrl(value: string | undefined) {
  return Option.getOrUndefined(normalizeIssuerUrlOption(value))
}

export function normalizeOktaAuthorizationServerIssuerUrl(value: string | undefined) {
  return Option.getOrUndefined(
    normalizeIssuerUrlOption(value).pipe(Option.map(normalizeOktaIssuerUrl)),
  )
}

function getOktaRefreshCredentials(
  config: ResolvedAuthProviderConfig | undefined,
): Option.Option<OktaRefreshCredentials> {
  return Option.fromNullishOr(config).pipe(
    Option.filter(
      (provider): provider is Extract<ResolvedAuthProviderConfig, { kind: "oidc" }> =>
        provider.enabled && provider.kind === "oidc",
    ),
    Option.flatMap((provider) =>
      Option.fromNullishOr(normalizeOktaAuthorizationServerIssuerUrl(provider.issuer)).pipe(
        Option.map((issuer) => ({
          issuer,
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
        })),
      ),
    ),
  )
}

function normalizeOktaIssuerUrl(issuer: string): string {
  const url = new URL(issuer)
  const path = url.pathname.replace(/\/+$/, "")
  return Match.value(url.hostname.endsWith(".okta.com") && (path === "" || path === "/")).pipe(
    Match.when(true, () => normalizeDefaultOktaIssuerUrl(url)),
    Match.orElse(() => issuer),
  )
}

function normalizeDefaultOktaIssuerUrl(url: URL): string {
  url.pathname = "/oauth2/default"
  return url.toString().replace(/\/+$/, "")
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

function isFutureTokenExpiry(
  value: string | null | undefined,
  now = Date.now(),
  bufferMs = OKTA_TOKEN_REFRESH_BUFFER_MS,
): boolean {
  return Option.match(parseDateMsOption(value), {
    onNone: () => true,
    onSome: (expiresAt) => expiresAt - now > bufferMs,
  })
}

function expiresAtFromSecondsOption(seconds: number | undefined): Option.Option<string> {
  return Option.fromNullishOr(seconds).pipe(
    Option.filter((value) => Number.isFinite(value) && value > 0),
    Option.map((value) => new Date(Date.now() + value * 1000).toISOString()),
  )
}

function decodeJwtPayloadOption(
  accessToken: string | null | undefined,
): Option.Option<Record<string, unknown>> {
  return Option.fromNullishOr(accessToken?.split(".")).pipe(
    Option.filter((parts) => parts.length === 3),
    Option.map((parts) => parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    Option.map((payload) => payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")),
    Option.filter((paddedPayload) => /^[A-Za-z0-9+/]*={0,2}$/.test(paddedPayload)),
    Option.flatMap((paddedPayload) => Option.fromNullishOr(parseJsonRecord(atob(paddedPayload)))),
  )
}

export function getOktaAccessTokenIssuer(accessToken: string | null | undefined) {
  return Option.getOrNull(
    decodeJwtPayloadOption(accessToken).pipe(
      Option.flatMap((payload) =>
        Option.liftPredicate(payload.iss, (issuer): issuer is string => typeof issuer === "string"),
      ),
      Option.map((issuer) => normalizeIssuerUrl(issuer) ?? issuer),
    ),
  )
}

function redactAuthSecret(value: string | undefined, secret: string | null | undefined) {
  return Option.match(Option.all([Option.fromNullishOr(value), Option.fromNullishOr(secret)]), {
    onNone: () => value,
    onSome: ([resolvedValue, resolvedSecret]) =>
      resolvedValue.split(resolvedSecret).join("[redacted]"),
  })
}

function postUrlEncodedForm(url: string, body: Record<string, string>) {
  const fetch = globalThis.fetch
  return HttpClient.execute(
    HttpClientRequest.post(url, {
      headers: { Accept: "application/json" },
    }).pipe(HttpClientRequest.bodyUrlParams(body)),
  ).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch), Effect.provide(FetchHttpClient.layer))
}

function logOktaRefreshRequestFailure(
  input: {
    log: AuthLogSink
    row: OAuthAccountTokenRow
    issuer: string
    userId?: string
  },
  errorValue: unknown,
) {
  logOktaRefreshFailure(input.log, errorValue, {
    row: input.row,
    issuer: input.issuer,
    phase: "request",
    userId: input.userId,
  })
  return Option.none<HttpClientResponse.HttpClientResponse>()
}

function logOktaRefreshParseFailure(
  input: {
    log: AuthLogSink
    row: OAuthAccountTokenRow
    issuer: string
    userId?: string
    response: HttpClientResponse.HttpClientResponse
  },
  errorValue: unknown,
) {
  logOktaRefreshFailure(input.log, errorValue, {
    row: input.row,
    issuer: input.issuer,
    phase: "parse_response",
    userId: input.userId,
    status: input.response.status,
  })
  return Option.none<OktaRefreshTokenResponse>()
}

function logInvalidOktaRefreshResponse(
  input: {
    log: AuthLogSink
    row: OAuthAccountTokenRow
    issuer: string
    userId?: string
    response: HttpClientResponse.HttpClientResponse
  },
  tokenData: OktaRefreshTokenResponse,
) {
  logOktaRefreshFailure(input.log, new Error("Okta access token refresh failed"), {
    row: input.row,
    issuer: input.issuer,
    phase: "provider_response",
    userId: input.userId,
    status: input.response.status,
    providerError: Option.getOrUndefined(
      Option.fromNullishOr(tokenData.error).pipe(
        Option.orElse(() =>
          Match.value(Boolean(tokenData.access_token)).pipe(
            Match.when(false, () => Option.some("missing_access_token")),
            Match.orElse(() => Option.none<string>()),
          ),
        ),
      ),
    ),
    errorDescription: redactAuthSecret(tokenData.error_description, input.row.refreshToken),
  })
  return Option.none<OAuthAccessTokenResult>()
}

function oktaScopeHasOfflineAccess(scope: string | null | undefined): boolean {
  return scope?.split(/[,\s]+/).includes("offline_access") ?? false
}

function logOktaRefreshFailure(
  log: AuthLogSink,
  errorValue: unknown,
  input: {
    row: OAuthAccountTokenRow
    issuer: string
    phase: "request" | "parse_response" | "provider_response"
    userId?: string
    status?: number
    providerError?: string
    errorDescription?: string
  },
): void {
  const error = Match.value(errorValue).pipe(
    Match.when(
      (value: unknown): value is Error => value instanceof Error,
      (resolved) => resolved,
    ),
    Match.orElse((resolved) => new Error(String(resolved))),
  )
  log.error(error, {
    event: "auth.okta.token.refresh_failed",
    boundary: "auth.okta.refresh",
    oauth: {
      providerId: OKTA_PROVIDER_ID,
      userId: input.userId ?? null,
      providerUserId: input.row.accountId,
      hasAccessToken: Boolean(input.row.accessToken),
      hasRefreshToken: Boolean(input.row.refreshToken),
      accessTokenExpiresAt: input.row.accessTokenExpiresAt,
      refreshTokenExpiresAt: input.row.refreshTokenExpiresAt,
      scopeHasOfflineAccess: oktaScopeHasOfflineAccess(input.row.scope),
    },
    upstream: {
      issuer: input.issuer,
      phase: input.phase,
      ...Option.match(Option.fromNullishOr(input.status), {
        onNone: () => ({}),
        onSome: (status) => ({ status }),
      }),
      ...Option.match(Option.fromNullishOr(input.providerError), {
        onNone: () => ({}),
        onSome: (providerError) => ({ error: providerError }),
      }),
      ...Option.match(Option.fromNullishOr(input.errorDescription), {
        onNone: () => ({}),
        onSome: (errorDescription) => ({ errorDescription }),
      }),
    },
    _forceKeep: true,
  })
}

const getOAuthAccountTokenRow = Effect.fn("auth.oauthTokens.accountTokenRow")(function* (
  env: ApiEnv,
  providerId: string,
  userId: string,
) {
  return yield* Effect.succeed(env).pipe(
    Effect.filterOrFail(hasQueryableDb, () => "missing_db" as const),
    Effect.flatMap((dbEnv) =>
      Effect.tryPromise(() =>
        runControlPlaneSqlFirst<OAuthAccountTokenRow>(
          dbEnv,
          `SELECT "id", "accountId", "accessToken", "refreshToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope"
           FROM "account"
           WHERE "providerId" = ?1 AND "userId" = ?2
           ORDER BY "updatedAt" DESC
           LIMIT 1`,
          [providerId, userId],
        ),
      ).pipe(Effect.map(Option.fromNullishOr)),
    ),
    Effect.catch(() => Effect.succeed(Option.none<OAuthAccountTokenRow>())),
  )
})

function buildOktaReconnectContext(
  row: Option.Option<OAuthAccountTokenRow>,
  issue?: {
    reason: Extract<OktaReconnectReason, "invalid_issuer">
    tokenIssuer: string | null
    expectedIssuer: string | null
  },
): OktaReconnectContext {
  return Option.match(row, {
    onNone: () => ({ reason: "missing_account" }),
    onSome: (resolvedRow) => buildOktaReconnectContextFromRow(resolvedRow, issue),
  })
}

function buildOktaReconnectContextFromRow(
  row: OAuthAccountTokenRow,
  issue?: {
    reason: Extract<OktaReconnectReason, "invalid_issuer">
    tokenIssuer: string | null
    expectedIssuer: string | null
  },
): OktaReconnectContext {
  const hasAccessToken = Boolean(row.accessToken)
  const hasRefreshToken = Boolean(row.refreshToken)
  const refreshTokenUsable = isFutureTokenExpiry(
    row.refreshTokenExpiresAt,
    Date.now(),
    OKTA_TOKEN_REFRESH_BUFFER_MS,
  )
  const reason = Option.getOrElse(Option.fromNullishOr(issue?.reason), () =>
    Match.value({ hasAccessToken, hasRefreshToken, refreshTokenUsable }).pipe(
      Match.when({ hasAccessToken: false }, () => "missing_access_token" as const),
      Match.when({ hasRefreshToken: false }, () => "missing_refresh_token" as const),
      Match.when({ refreshTokenUsable: true }, () => "refresh_unavailable" as const),
      Match.orElse(() => "expired_refresh_token" as const),
    ),
  )

  return {
    reason,
    oktaUserId: row.accountId,
    hasAccessToken,
    hasRefreshToken,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    refreshTokenExpiresAt: row.refreshTokenExpiresAt,
    scopeHasOfflineAccess: oktaScopeHasOfflineAccess(row.scope),
    ...Option.match(Option.fromNullishOr(issue), {
      onNone: () => ({}),
      onSome: (resolvedIssue) => ({
        tokenIssuer: resolvedIssue.tokenIssuer,
        expectedIssuer: resolvedIssue.expectedIssuer,
      }),
    }),
  }
}

const refreshOktaAccessToken = Effect.fn("auth.oauthTokens.refreshOktaAccessToken")(function* (
  env: ApiEnv,
  row: OAuthAccountTokenRow,
  input: {
    log: AuthLogSink
    userId?: string
    credentials: Option.Option<OktaRefreshCredentials>
  },
) {
  const refreshInput: OktaRefreshInput = Option.match(
    Option.all({
      env: Option.liftPredicate(env, hasQueryableDb),
      credentials: input.credentials,
      refreshToken: Option.fromNullishOr(row.refreshToken).pipe(
        Option.filter(() =>
          isFutureTokenExpiry(row.refreshTokenExpiresAt, Date.now(), OKTA_TOKEN_REFRESH_BUFFER_MS),
        ),
      ),
    }),
    {
      onNone: () => ({ kind: "skip" }),
      onSome: ({ credentials, ...resolved }) => ({
        kind: "refresh",
        ...resolved,
        ...credentials,
      }),
    },
  )

  return yield* Effect.succeed(refreshInput).pipe(
    Effect.filterOrFail(
      (resolved): resolved is Extract<OktaRefreshInput, { kind: "refresh" }> =>
        resolved.kind === "refresh",
      () => "skip_refresh" as const,
    ),
    Effect.flatMap((resolved) =>
      refreshOktaAccessTokenWithCredentials({
        ...resolved,
        row,
        log: input.log,
        userId: input.userId,
      }),
    ),
    Effect.catch(() => Effect.succeed(Option.none<OAuthAccessTokenResult>())),
  )
})

const refreshOktaAccessTokenWithCredentials = Effect.fn(
  "auth.oauthTokens.refreshOktaAccessTokenWithCredentials",
)(function* (
  input: Extract<OktaRefreshInput, { kind: "refresh" }> & {
    row: OAuthAccountTokenRow
    log: AuthLogSink
    userId?: string
  },
) {
  const responseOption = yield* postUrlEncodedForm(`${input.issuer}/v1/token`, {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  }).pipe(
    Effect.map(Option.some),
    Effect.catch((errorValue) => Effect.succeed(logOktaRefreshRequestFailure(input, errorValue))),
  )

  return yield* Effect.succeed(responseOption).pipe(
    Effect.filterOrFail(Option.isSome, () => "missing_response" as const),
    Effect.flatMap(({ value: response }) =>
      refreshOktaAccessTokenFromResponse({
        ...input,
        response,
      }),
    ),
    Effect.catch(() => Effect.succeed(Option.none<OAuthAccessTokenResult>())),
  )
})

const refreshOktaAccessTokenFromResponse = Effect.fn(
  "auth.oauthTokens.refreshOktaAccessTokenFromResponse",
)(function* (
  input: Extract<OktaRefreshInput, { kind: "refresh" }> & {
    row: OAuthAccountTokenRow
    log: AuthLogSink
    userId?: string
    response: HttpClientResponse.HttpClientResponse
  },
) {
  const tokenDataOption = yield* input.response.json.pipe(
    Effect.map((tokenData) => Option.some(tokenData as OktaRefreshTokenResponse)),
    Effect.catch((errorValue) => Effect.succeed(logOktaRefreshParseFailure(input, errorValue))),
  )

  return yield* Effect.succeed(tokenDataOption).pipe(
    Effect.filterOrFail(Option.isSome, () => ({ kind: "missing_token_data" as const })),
    Effect.map(({ value }) => value),
    Effect.filterOrFail(
      (tokenData) =>
        input.response.status >= 200 &&
        input.response.status < 300 &&
        !tokenData.error &&
        Boolean(tokenData.access_token),
      (tokenData) => ({ kind: "invalid_token_data" as const, tokenData }),
    ),
    Effect.flatMap((tokenData) =>
      persistOktaAccessTokenRefresh(input.env, input.row, {
        ...tokenData,
        access_token: tokenData.access_token as string,
      }),
    ),
    Effect.catch((failure) =>
      Effect.fromOption(
        Option.liftPredicate(
          failure,
          (failed): failed is { kind: "invalid_token_data"; tokenData: OktaRefreshTokenResponse } =>
            Boolean(failed) &&
            failed !== null &&
            typeof failed === "object" &&
            "kind" in failed &&
            failed.kind === "invalid_token_data" &&
            "tokenData" in failed,
        ),
      ).pipe(
        Effect.map(({ tokenData }) => logInvalidOktaRefreshResponse(input, tokenData)),
        Effect.catch(() => Effect.succeed(Option.none<OAuthAccessTokenResult>())),
      ),
    ),
  )
})

const persistOktaAccessTokenRefresh = Effect.fn("auth.oauthTokens.persistOktaAccessTokenRefresh")(
  function* (
    env: QueryableApiEnv,
    row: OAuthAccountTokenRow,
    tokenData: OktaRefreshTokenResponse & { access_token: string },
  ) {
    const accessTokenExpiresAt = Option.getOrNull(expiresAtFromSecondsOption(tokenData.expires_in))
    const refreshToken = tokenData.refresh_token ?? row.refreshToken
    const refreshTokenExpiresAt =
      Option.getOrNull(expiresAtFromSecondsOption(tokenData.refresh_token_expires_in)) ??
      row.refreshTokenExpiresAt

    yield* Effect.tryPromise(() =>
      runControlPlaneSql(
        env,
        `UPDATE "account"
       SET "accessToken" = ?1,
           "refreshToken" = ?2,
           "accessTokenExpiresAt" = ?3,
           "refreshTokenExpiresAt" = ?4,
           "scope" = ?5,
           "updatedAt" = ?6
       WHERE "id" = ?7`,
        [
          tokenData.access_token,
          refreshToken,
          accessTokenExpiresAt,
          refreshTokenExpiresAt,
          tokenData.scope ?? "",
          new Date().toISOString(),
          row.id,
        ],
      ),
    )

    return Option.some({
      accessToken: tokenData.access_token,
      accessTokenExpiresAt: Option.getOrNull(parseDateMsOption(accessTokenExpiresAt)),
    })
  },
)

export const getOktaAccessTokenForUserId = Effect.fn(
  "auth.oauthTokens.getOktaAccessTokenForUserId",
)(function* (
  env: ApiEnv,
  userId: string,
  options: {
    log: AuthLogSink
    expectedIssuer?: string | null
    reconnectMessage?: string
  },
) {
  const rowOption = yield* getOAuthAccountTokenRow(env, OKTA_PROVIDER_ID, userId)
  const row = yield* Effect.fromOption(rowOption).pipe(
    Effect.catch(() =>
      Effect.fail(
        new OktaAccountReconnectRequiredError({
          message: options.reconnectMessage,
          context: buildOktaReconnectContext(rowOption),
        }),
      ),
    ),
  )
  const authConfig = yield* getAuthProviderRegistry(env)
  const refreshCredentials = getOktaRefreshCredentials(authConfig.providers[OKTA_PROVIDER_ID])
  const expectedIssuer = Option.getOrNull(
    Match.value("expectedIssuer" in options).pipe(
      Match.when(true, () =>
        Option.fromNullishOr(
          normalizeOktaAuthorizationServerIssuerUrl(options.expectedIssuer ?? undefined),
        ),
      ),
      Match.orElse(() => Option.map(refreshCredentials, (credentials) => credentials.issuer)),
    ),
  )
  const tokenIssuer = getOktaAccessTokenIssuer(row.accessToken)
  const hasIssuerMismatch = Boolean(expectedIssuer && tokenIssuer && tokenIssuer !== expectedIssuer)
  const currentToken = Option.liftPredicate(
    row,
    (resolved) =>
      Boolean(resolved.accessToken) &&
      !hasIssuerMismatch &&
      isFutureTokenExpiry(resolved.accessTokenExpiresAt, Date.now(), OKTA_TOKEN_REFRESH_BUFFER_MS),
  ).pipe(
    Option.map((resolved) => ({
      oktaUserId: resolved.accountId,
      accessToken: resolved.accessToken as string,
      accessTokenExpiresAt: Option.getOrNull(parseDateMsOption(resolved.accessTokenExpiresAt)),
    })),
  )

  const resolvedToken = yield* Effect.succeed(currentToken).pipe(
    Effect.filterOrFail(Option.isSome, () => "missing_current_token" as const),
    Effect.map(({ value }) => Option.some(value)),
    Effect.catch(() =>
      refreshOktaAccessToken(env, row, {
        log: options.log,
        userId,
        credentials: refreshCredentials,
      }).pipe(
        Effect.map((refreshedToken) =>
          Option.map(refreshedToken as Option.Option<OAuthAccessTokenResult>, (token) => ({
            oktaUserId: row.accountId,
            accessToken: token.accessToken,
            accessTokenExpiresAt: token.accessTokenExpiresAt,
          })),
        ),
      ),
    ),
  )

  const token = yield* Effect.fromOption(resolvedToken).pipe(
    Effect.catch(() =>
      Effect.fail(
        new OktaAccountReconnectRequiredError({
          message: options.reconnectMessage,
          context: buildOktaReconnectContext(
            rowOption,
            Option.getOrUndefined(
              Option.liftPredicate(hasIssuerMismatch, Boolean).pipe(
                Option.map(() => ({
                  reason: "invalid_issuer" as const,
                  tokenIssuer,
                  expectedIssuer,
                })),
              ),
            ),
          ),
        }),
      ),
    ),
  )

  return token
})

function buildLinkedOAuthReconnectContext(input: {
  providerId: string
  row: Option.Option<OAuthAccountTokenRow>
  reason?: LinkedOAuthReconnectContext["reason"]
  tokenIssuer?: string | null
  expectedIssuer?: string | null
}): LinkedOAuthReconnectContext {
  return Option.match(input.row, {
    onNone: () => ({
      providerId: input.providerId,
      reason: input.reason ?? "missing_account",
    }),
    onSome: (row) => ({
      providerId: input.providerId,
      reason: Option.getOrElse(Option.fromNullishOr(input.reason), () =>
        Match.value({
          hasAccessToken: Boolean(row.accessToken),
          hasRefreshToken: Boolean(row.refreshToken),
        }).pipe(
          Match.when({ hasAccessToken: false }, () => "missing_access_token" as const),
          Match.when({ hasRefreshToken: true }, () => "provider_refresh_unsupported" as const),
          Match.orElse(() => "expired_access_token" as const),
        ),
      ),
      providerUserId: row.accountId,
      hasAccessToken: Boolean(row.accessToken),
      hasRefreshToken: Boolean(row.refreshToken),
      accessTokenExpiresAt: row.accessTokenExpiresAt,
      refreshTokenExpiresAt: row.refreshTokenExpiresAt,
      tokenIssuer: input.tokenIssuer,
      expectedIssuer: input.expectedIssuer,
    }),
  })
}

const getStoredLinkedOAuthAccessToken = Effect.fn(
  "auth.oauthTokens.getStoredLinkedOAuthAccessToken",
)(function* (
  env: ApiEnv,
  input: {
    userId: string
    providerId: string
    expectedIssuer: string | null
  },
) {
  const row = yield* getOAuthAccountTokenRow(env, input.providerId, input.userId)
  const tokenIssuer = getOktaAccessTokenIssuer(Option.getOrNull(row)?.accessToken)
  const hasIssuerMismatch = Boolean(
    input.expectedIssuer && tokenIssuer && tokenIssuer !== input.expectedIssuer,
  )
  const linkedToken = Option.liftPredicate(
    row,
    (rowOption): rowOption is Option.Option<OAuthAccountTokenRow> & { _tag: "Some" } =>
      Option.isSome(rowOption) &&
      Boolean(rowOption.value.accessToken) &&
      !hasIssuerMismatch &&
      isFutureTokenExpiry(
        rowOption.value.accessTokenExpiresAt,
        Date.now(),
        OKTA_TOKEN_REFRESH_BUFFER_MS,
      ),
  ).pipe(
    Option.map(({ value: resolvedRow }) => ({
      providerId: input.providerId,
      providerUserId: resolvedRow.accountId,
      accessToken: resolvedRow.accessToken as string,
      accessTokenExpiresAt: Option.getOrNull(parseDateMsOption(resolvedRow.accessTokenExpiresAt)),
      accessTokenIssuer: tokenIssuer,
      expectedAccessTokenIssuer: input.expectedIssuer,
    })),
  )

  return yield* Effect.fromOption(linkedToken).pipe(
    Effect.catch(() =>
      Effect.fail(
        new LinkedOAuthReconnectRequiredError({
          context: buildLinkedOAuthReconnectContext({
            providerId: input.providerId,
            row,
            reason: Option.getOrUndefined(
              Option.liftPredicate(hasIssuerMismatch, Boolean).pipe(
                Option.map(() => "invalid_issuer" as const),
              ),
            ),
            tokenIssuer,
            expectedIssuer: input.expectedIssuer,
          }),
        }),
      ),
    ),
  )
})

const getLinkedOktaOAuthAccessToken = Effect.fn("auth.oauthTokens.getLinkedOktaOAuthAccessToken")(
  function* (
    env: ApiEnv,
    input: {
      userId: string
      providerId: string
      expectedIssuer: string | null
      log: AuthLogSink
    },
  ) {
    const token = yield* getOktaAccessTokenForUserId(env, input.userId, {
      expectedIssuer: input.expectedIssuer,
      reconnectMessage: "Reconnect your configured OAuth account to use MCP Context Forge tools.",
      log: input.log,
    }).pipe(
      Effect.catchIf(
        (errorValue): errorValue is OktaAccountReconnectRequiredError =>
          errorValue instanceof OktaAccountReconnectRequiredError,
        (errorValue) =>
          Effect.fail(
            new LinkedOAuthReconnectRequiredError({
              context: {
                providerId: input.providerId,
                reason: errorValue.context.reason,
                providerUserId: errorValue.context.oktaUserId,
                hasAccessToken: errorValue.context.hasAccessToken,
                hasRefreshToken: errorValue.context.hasRefreshToken,
                accessTokenExpiresAt: errorValue.context.accessTokenExpiresAt,
                refreshTokenExpiresAt: errorValue.context.refreshTokenExpiresAt,
                tokenIssuer: errorValue.context.tokenIssuer,
                expectedIssuer: errorValue.context.expectedIssuer,
              },
            }),
          ),
      ),
    )

    return {
      providerId: input.providerId,
      providerUserId: token.oktaUserId,
      accessToken: token.accessToken,
      accessTokenExpiresAt: token.accessTokenExpiresAt,
      accessTokenIssuer: getOktaAccessTokenIssuer(token.accessToken),
      expectedAccessTokenIssuer: input.expectedIssuer,
    }
  },
)

export const getLinkedOAuthAccessTokenForUserId = Effect.fn(
  "auth.oauthTokens.getLinkedOAuthAccessTokenForUserId",
)(function* (
  env: ApiEnv,
  input: {
    userId: string
    providerId: string
    log: AuthLogSink
    expectedIssuer?: string | null
  },
) {
  const providerId = input.providerId.trim()
  yield* Effect.succeed(providerId).pipe(
    Effect.filterOrFail(
      (resolved) => resolved.length > 0,
      () => "missing_provider_id" as const,
    ),
    Effect.catch(() =>
      Effect.fail(
        new LinkedOAuthReconnectRequiredError({
          context: {
            providerId,
            reason: "missing_account",
          },
        }),
      ),
    ),
  )

  const expectedIssuer =
    normalizeOktaAuthorizationServerIssuerUrl(input.expectedIssuer ?? undefined) ?? null

  return yield* Match.value(providerId).pipe(
    Match.when(OKTA_PROVIDER_ID, () =>
      getLinkedOktaOAuthAccessToken(env, {
        userId: input.userId,
        providerId,
        expectedIssuer,
        log: input.log,
      }),
    ),
    Match.orElse(() =>
      getStoredLinkedOAuthAccessToken(env, {
        userId: input.userId,
        providerId,
        expectedIssuer,
      }),
    ),
  )
})
