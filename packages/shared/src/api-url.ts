/** Join a canonical API path without discarding a configured public /api base. */
export function publicApiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
}

/** Better Auth owns /api/auth; API-key management belongs to the Effect API. */
export function canonicalApiPath(pathname: string): string {
  // oxlint-disable-next-line s0-lint/no-if-statement -- Public ingress must preserve Better Auth's configured base path.
  if (
    (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) &&
    pathname !== "/api/auth/api-keys" &&
    !pathname.startsWith("/api/auth/api-keys/")
  ) {
    return pathname
  }
  // oxlint-disable-next-line s0-lint/no-if-statement -- Match a path segment, never /apiary or another partial prefix.
  if (pathname === "/api") return "/"
  // oxlint-disable-next-line s0-lint/no-ternary -- This synchronous path adapter is shared by Worker ingress and URL tests.
  return pathname.startsWith("/api/") ? pathname.slice(4) : pathname
}
