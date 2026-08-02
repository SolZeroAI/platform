/* oxlint-disable c0-lint/no-if-statement, c0-lint/no-ternary -- Admin configuration normalization is a synchronous untrusted-data boundary with explicit fallback behavior. */
import * as Schema from "effect/Schema"

export interface AdminConfig {
  readonly adminEmails: readonly string[]
  readonly adminDomains: readonly string[]
}

// oxlint-disable-next-line effect/prefer-schema-class -- deployment and runtime configuration is a plain JSON DTO
export const AdminConfigSchema = Schema.Struct({
  adminEmails: Schema.Array(Schema.String),
  adminDomains: Schema.Array(Schema.String),
})

export const EMPTY_ADMIN_CONFIG = {
  adminEmails: [],
  adminDomains: [],
} satisfies AdminConfig

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase()
}

function normalizeDomain(value: string): string {
  const normalized = value.trim().toLowerCase()
  let start = 0
  let end = normalized.length

  // oxlint-disable-next-line effect/imperative-loops -- A linear scan avoids regex backtracking on admin-controlled configuration input.
  while (normalized[start] === "@") {
    start += 1
  }
  // oxlint-disable-next-line effect/imperative-loops -- A linear scan avoids regex backtracking on admin-controlled configuration input.
  while (end > start && normalized[end - 1] === ".") {
    end -= 1
  }

  return normalized.slice(start, end)
}

function normalizeStringArray(value: unknown, normalize: (input: string) => string): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map(normalize))]
        .filter(Boolean)
        .sort()
    : []
}

export function normalizeAdminConfig(value: unknown): AdminConfig {
  if (!isRecord(value)) {
    return EMPTY_ADMIN_CONFIG
  }

  return {
    adminEmails: normalizeStringArray(value.adminEmails ?? value.emails, normalizeEmail),
    adminDomains: normalizeStringArray(value.adminDomains ?? value.domains, normalizeDomain),
  }
}

export function isAdminEmail(
  email: string | null | undefined,
  config: AdminConfig = EMPTY_ADMIN_CONFIG,
): boolean {
  const normalized = normalizeEmail(email)
  if (!normalized) {
    return false
  }

  const emailDomain = normalized.split("@")[1] ?? ""
  return (
    new Set(config.adminEmails.map(normalizeEmail)).has(normalized) ||
    new Set(config.adminDomains.map(normalizeDomain)).has(emailDomain)
  )
}
