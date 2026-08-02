import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { handleListRepos, resolveUserIdentity, runControlPlane } from "../shared/control-plane"

function parsePositiveInteger(value: string | null) {
  return Option.fromNullishOr(value).pipe(
    Option.map((raw) => Number.parseInt(raw, 10)),
    Option.filter((parsed) => Number.isInteger(parsed) && parsed > 0),
    Option.getOrUndefined,
  )
}

function parseVisibility(value: string | null) {
  return Option.fromNullishOr(value).pipe(
    Option.filter((raw): raw is "private" | "public" => raw === "private" || raw === "public"),
    Option.getOrUndefined,
  )
}

function parseSort(value: string | null) {
  return Option.fromNullishOr(value).pipe(
    Option.filter((raw): raw is "updated" => raw === "updated"),
    Option.getOrUndefined,
  )
}

function parseOrder(value: string | null) {
  return Option.fromNullishOr(value).pipe(
    Option.filter((raw): raw is "asc" | "desc" => raw === "asc" || raw === "desc"),
    Option.getOrUndefined,
  )
}

function parseOptionalString(value: string | null) {
  return Option.fromNullishOr(value?.trim()).pipe(
    Option.filter((trimmed) => trimmed.length > 0),
    Option.getOrUndefined,
  )
}

export function list() {
  return runControlPlane(
    Effect.fn("repos.list")(function* ({
      request,
      env,
      principal,
      identityProvider,
      githubProvider,
    }) {
      const identity = yield* resolveUserIdentity(request, env, principal, identityProvider)
      const searchParams = new URL(request.url).searchParams
      return yield* handleListRepos(
        env,
        identity,
        {
          query: parseOptionalString(searchParams.get("q")),
          owner: parseOptionalString(searchParams.get("owner")),
          visibility: parseVisibility(searchParams.get("visibility")),
          sort: parseSort(searchParams.get("sort")),
          order: parseOrder(searchParams.get("order")),
          page: parsePositiveInteger(searchParams.get("page")),
          perPage: parsePositiveInteger(searchParams.get("perPage")),
        },
        githubProvider,
      )
    }),
  )
}
