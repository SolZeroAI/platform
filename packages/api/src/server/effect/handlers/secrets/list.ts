import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
  json,
  requireGlobalSecretsStore,
  requireOption,
  requirePrincipalUserId,
  runControlPlane,
} from "../shared/control-plane"

function parseOptionalString(value: string | undefined) {
  return Option.fromNullishOr(value?.trim()).pipe(
    Option.filter((trimmed) => trimmed.length > 0),
    Option.getOrUndefined,
  )
}

function parseTagsQuery(value: string | undefined) {
  return Option.fromNullishOr(value?.trim()).pipe(
    Option.filter((trimmed) => trimmed.length > 0),
    Option.map((trimmed) =>
      trimmed
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
    Option.filter((tags) => tags.length > 0),
    Option.getOrUndefined,
  )
}

export function list({
  query,
}: {
  query: {
    q?: string
    tags?: string
  }
}) {
  return runControlPlane(
    Effect.fn("secrets.list")(function* ({ request, env, principal }) {
      const userId = yield* requirePrincipalUserId(request, principal)
      const store = yield* requireOption(
        requireGlobalSecretsStore(env),
        "REPO_SECRETS_ENCRYPTION_KEY not configured",
        500,
      )
      const result = yield* store.listSecrets({
        userId,
        q: parseOptionalString(query.q),
        tags: parseTagsQuery(query.tags),
      })
      return json(result)
    }),
  )
}
