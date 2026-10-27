import * as Match from "effect/Match"

/** Join a canonical API path without discarding a configured public /api base. */
export function publicApiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
}

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/** Better Auth owns /api/auth; API-key management belongs to the Effect API. */
export function canonicalApiPath(pathname: string): string {
  return Match.value(pathname).pipe(
    Match.when(
      (path) => isUnder(path, "/api/auth") && !isUnder(path, "/api/auth/api-keys"),
      (path) => path,
    ),
    // Match a whole path segment, never /apiary or another partial prefix.
    Match.when("/api", () => "/"),
    Match.when(
      (path) => path.startsWith("/api/"),
      (path) => path.slice("/api".length),
    ),
    Match.orElse((path) => path),
  )
}
