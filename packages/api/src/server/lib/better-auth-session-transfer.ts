import type { BetterAuthPlugin } from "better-auth"
import { createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { ApiEnv } from "infra/types/env"
import { isAdminEmailForEnv } from "../background/db/admin-config"

const SESSION_TRANSFER_TTL_MS = 2 * 60 * 1000
const SESSION_TRANSFER_IDENTIFIER_PREFIX = "c0-session-transfer"

interface ActiveBetterAuthSession {
  session: {
    token: string
  }
  user?: {
    email?: string | null
  }
}

type UrlConstructorWithCanParse = typeof URL & {
  canParse?: (input: string, base?: string) => boolean
}

interface CreateSessionTransferUrlOptions {
  baseURL: string
  redeemPath: string
  sessionToken: string
  redirect?: string | undefined
  createVerificationValue: (data: {
    identifier: string
    value: string
    expiresAt: Date
  }) => Promise<unknown>
}

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes)
  crypto.getRandomValues(values)
  return [...values].map((value) => value.toString(16).padStart(2, "0")).join("")
}

async function hashSessionTransferToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("")
}

function sessionTransferIdentifier(tokenHash: string): string {
  return `${SESSION_TRANSFER_IDENTIFIER_PREFIX}:${tokenHash}`
}

function parseUrlOption(input: string, base?: string): Option.Option<URL> {
  return Match.value((URL as UrlConstructorWithCanParse).canParse?.(input, base) === true).pipe(
    Match.when(true, () => Option.some(new URL(input, base))),
    Match.orElse(() => Option.none<URL>()),
  )
}

function resolveSessionTransferRedirect(
  value: string | undefined,
  baseURL: string,
): Option.Option<string> {
  return Option.fromNullishOr(value).pipe(
    Option.flatMap((rawValue) =>
      parseUrlOption(baseURL).pipe(
        Option.flatMap((baseUrl) =>
          parseUrlOption(rawValue, baseUrl.origin).pipe(
            Option.filter(
              (parsed) => parsed.origin === baseUrl.origin && !parsed.pathname.startsWith("//"),
            ),
            Option.map((parsed) => `${parsed.pathname}${parsed.search}${parsed.hash}`),
          ),
        ),
      ),
    ),
  )
}

function normalizeSessionTransferRedirect(value: string | undefined, baseURL: string): string {
  return Option.getOrElse(resolveSessionTransferRedirect(value, baseURL), () => "/")
}

function escapeHtmlCharacter(character: string): string {
  return Match.value(character).pipe(
    Match.when("&", () => "&amp;"),
    Match.when("<", () => "&lt;"),
    Match.when(">", () => "&gt;"),
    Match.when('"', () => "&quot;"),
    Match.when("'", () => "&#39;"),
    Match.orElse(() => character),
  )
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, escapeHtmlCharacter)
}

async function buildSessionTransferUrl(options: CreateSessionTransferUrlOptions) {
  const redirect = normalizeSessionTransferRedirect(options.redirect, options.baseURL)
  const token = randomHex(32)
  const tokenHash = await hashSessionTransferToken(token)
  const expiresAt = new Date(Date.now() + SESSION_TRANSFER_TTL_MS)

  await options.createVerificationValue({
    identifier: sessionTransferIdentifier(tokenHash),
    value: options.sessionToken,
    expiresAt,
  })

  const redeemUrl = new URL(`${options.baseURL}${options.redeemPath}`)
  redeemUrl.searchParams.set("token", token)
  redeemUrl.searchParams.set("redirect", redirect)

  return {
    redeemUrl,
    expiresAt,
  }
}

function renderSessionTransferHtml(redeemUrl: URL): Response {
  const escapedRedeemUrl = escapeHtml(redeemUrl.toString())
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Session Transfer</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 48rem; line-height: 1.5; }
      code { overflow-wrap: anywhere; }
      a { color: #075985; }
    </style>
  </head>
  <body>
    <h1>Session Transfer</h1>
    <p>Open this one-time URL in another browser within two minutes:</p>
    <p><a href="${escapedRedeemUrl}">${escapedRedeemUrl}</a></p>
    <p><code>${escapedRedeemUrl}</code></p>
  </body>
</html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  )
}

function forbiddenSessionTransferResponse() {
  return new Response("Session transfer is only available to admins.", { status: 403 })
}

function resolveSessionTransferAdmin(
  env: ApiEnv,
  email: string | null | undefined,
): Promise<boolean> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Better Auth plugin endpoints are Promise boundaries.
  return Effect.runPromise(isAdminEmailForEnv(env, email))
}

class SessionTransferQuery extends Schema.Class<SessionTransferQuery>("SessionTransferQuery")({
  redirect: Schema.optionalKey(Schema.String),
}) {}

class RedeemSessionTransferQuery extends Schema.Class<RedeemSessionTransferQuery>(
  "RedeemSessionTransferQuery",
)({
  redirect: Schema.optionalKey(Schema.String),
  token: Schema.NonEmptyString,
}) {}

export function betterAuthSessionTransferPlugin(env: ApiEnv): BetterAuthPlugin {
  const transferQuery = Schema.toStandardSchemaV1(SessionTransferQuery)
  const redeemQuery = Schema.toStandardSchemaV1(RedeemSessionTransferQuery)

  function createGenerateSessionTransferEndpoint(path: string) {
    return createAuthEndpoint(
      path,
      {
        method: "GET",
        query: transferQuery,
        use: [sessionMiddleware],
      },
      async function (ctx) {
        const activeSession = ctx.context.session as ActiveBetterAuthSession
        const isAdmin = await resolveSessionTransferAdmin(env, activeSession.user?.email)
        return Match.value(isAdmin).pipe(
          Match.when(false, () => forbiddenSessionTransferResponse()),
          Match.orElse(async function () {
            const transfer = await buildSessionTransferUrl({
              baseURL: ctx.context.baseURL,
              redeemPath: `${path}/redeem`,
              sessionToken: activeSession.session.token,
              redirect: ctx.query.redirect,
              createVerificationValue: (data) =>
                ctx.context.internalAdapter.createVerificationValue(data),
            })
            return Match.value(
              Boolean(ctx.headers?.get("accept")?.includes("application/json")),
            ).pipe(
              Match.when(true, () =>
                ctx.json({
                  redeemUrl: transfer.redeemUrl.toString(),
                  expiresAt: transfer.expiresAt.toISOString(),
                }),
              ),
              Match.orElse(() => renderSessionTransferHtml(transfer.redeemUrl)),
            )
          }),
        )
      },
    )
  }

  function createRedeemSessionTransferEndpoint(path: string) {
    return createAuthEndpoint(
      path,
      {
        method: "GET",
        query: redeemQuery,
      },
      async function (ctx) {
        const tokenHash = await hashSessionTransferToken(ctx.query.token)
        const identifier = sessionTransferIdentifier(tokenHash)
        const verification = await ctx.context.internalAdapter.consumeVerificationValue(identifier)
        return Option.match(Option.fromNullishOr(verification), {
          onNone: () =>
            new Response("Invalid or already used session transfer token.", {
              status: 400,
            }),
          onSome: (validVerification) =>
            Match.value(validVerification.expiresAt < new Date()).pipe(
              Match.when(
                true,
                () => new Response("Session transfer token expired.", { status: 400 }),
              ),
              Match.orElse(async function () {
                const session = await ctx.context.internalAdapter.findSession(
                  validVerification.value,
                )
                return Option.match(
                  Option.fromNullishOr(session).pipe(
                    Option.filter((value) => value.session.expiresAt >= new Date()),
                  ),
                  {
                    onNone: () =>
                      new Response("Source session is no longer valid.", { status: 400 }),
                    onSome: async function (activeSession) {
                      await setSessionCookie(ctx, activeSession)
                      throw ctx.redirect(
                        normalizeSessionTransferRedirect(ctx.query.redirect, ctx.context.baseURL),
                      )
                    },
                  },
                )
              }),
            ),
        })
      },
    )
  }

  return {
    id: "c0-session-transfer",
    endpoints: {
      generateSessionTransfer: createGenerateSessionTransferEndpoint("/session-transfer"),
      redeemSessionTransfer: createRedeemSessionTransferEndpoint("/session-transfer/redeem"),
      generateDevSessionTransfer: createGenerateSessionTransferEndpoint("/dev-session-transfer"),
      redeemDevSessionTransfer: createRedeemSessionTransferEndpoint("/dev-session-transfer/redeem"),
    },
  }
}
