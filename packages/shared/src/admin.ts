import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

export interface AdminConfig {
  readonly adminEmails: readonly string[]
  readonly adminDomains: readonly string[]
}

export const AdminConfigSchema = Schema.Struct({
  adminEmails: Schema.Array(Schema.String),
  adminDomains: Schema.Array(Schema.String),
})

export const EMPTY_ADMIN_CONFIG = {
  adminEmails: [],
  adminDomains: [],
} satisfies AdminConfig

const AdminConfigInputSchema = Schema.Struct({
  adminEmails: Schema.optional(Schema.Array(Schema.String)),
  emails: Schema.optional(Schema.Array(Schema.String)),
  adminDomains: Schema.optional(Schema.Array(Schema.String)),
  domains: Schema.optional(Schema.Array(Schema.String)),
})

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase()
}

const dropLeading = (characters: readonly string[], character: string) =>
  Arr.dropWhile(characters, (candidate) => candidate === character)

// Character scans, not regexes, so admin-controlled input cannot trigger regex backtracking.
function normalizeDomain(value: string): string {
  const withoutLeadingAt = dropLeading(Array.from(value.trim().toLowerCase()), "@")

  return Arr.reverse(dropLeading(Arr.reverse(withoutLeadingAt), ".")).join("")
}

function normalizeStringArray(
  value: readonly string[] | undefined,
  normalize: (input: string) => string,
): string[] {
  return [...new Set((value ?? []).map(normalize))].filter(Boolean).sort()
}

export function normalizeAdminConfig(value: unknown): AdminConfig {
  return Option.match(Schema.decodeUnknownOption(AdminConfigInputSchema)(value), {
    onNone: () => EMPTY_ADMIN_CONFIG,
    onSome: (record) => ({
      adminEmails: normalizeStringArray(record.adminEmails ?? record.emails, normalizeEmail),
      adminDomains: normalizeStringArray(record.adminDomains ?? record.domains, normalizeDomain),
    }),
  })
}

export function isAdminEmail(
  email: string | null | undefined,
  config: AdminConfig = EMPTY_ADMIN_CONFIG,
): boolean {
  const normalized = normalizeEmail(email)
  const emailDomain = normalized.split("@")[1] ?? ""

  return (
    normalized !== "" &&
    (new Set(config.adminEmails.map(normalizeEmail)).has(normalized) ||
      new Set(config.adminDomains.map(normalizeDomain)).has(emailDomain))
  )
}
