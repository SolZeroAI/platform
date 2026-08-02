import type { ApiEnv } from "infra/types/env"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { stringifyJson } from "../../lib/json"
import { getGitHubAppConfig, GitHubAppError, verifyGitHubWebhookSignature } from "./github-app"

function json(data: unknown, status = 200): Response {
  return new Response(stringifyJson(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function configuredWebhookSecret(env: ApiEnv) {
  return getGitHubAppConfig(env).pipe(
    Option.flatMap((config) => Option.fromNullishOr(config.webhookSecret)),
  )
}

const handleConfiguredGitHubAppWebhookRequest = Effect.fn(
  "githubApp.handleConfiguredWebhookRequest",
)(function* (request: Request, secret: string) {
  const body = yield* Effect.tryPromise({
    try: () => request.arrayBuffer(),
    catch: (cause) => new GitHubAppError({ message: "Failed to read GitHub webhook body", cause }),
  })
  const validSignature = yield* verifyGitHubWebhookSignature({
    secret,
    signatureHeader: request.headers.get("x-hub-signature-256"),
    body,
  })
  return yield* Match.value(validSignature).pipe(
    Match.when(false, () =>
      Effect.succeed(json({ error: "Invalid GitHub webhook signature" }, 401)),
    ),
    Match.orElse(() =>
      Effect.succeed(
        json({
          ok: true,
          event: request.headers.get("x-github-event") ?? "unknown",
          delivery: request.headers.get("x-github-delivery") ?? null,
        }),
      ),
    ),
  )
})

export const handleGitHubAppWebhookRequestEffect = Effect.fn("githubApp.handleWebhookRequest")(
  function* (request: Request, env: ApiEnv) {
    return yield* Match.value(request.method).pipe(
      Match.when("POST", () =>
        Option.match(configuredWebhookSecret(env), {
          onNone: () =>
            Effect.succeed(json({ error: "GitHub App webhook secret is not configured" }, 500)),
          onSome: (secret) => handleConfiguredGitHubAppWebhookRequest(request, secret),
        }),
      ),
      Match.orElse(() => Effect.succeed(json({ error: "Method not allowed" }, 405))),
    )
  },
)

export function handleGitHubAppWebhookRequest(request: Request, env: ApiEnv): Promise<Response> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Worker fetch boundary for the GitHub webhook route.
  return Effect.runPromise(handleGitHubAppWebhookRequestEffect(request, env))
}
