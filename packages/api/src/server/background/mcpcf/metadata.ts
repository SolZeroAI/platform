import { normalizeMcpcfServerSlug } from "@solzero/shared"

export interface McpcfToolPreview {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface NormalizedMcpcfSourceServer {
  id: string
  slug: string
  label: string
  description: string
  authType: string | null
  upstreamAuthType: string | null
  rawMetadata: Record<string, unknown>
}

function getStringProperty(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  const match = keys
    .map((key) => record[key])
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
  return match ? match.trim() : null
}

const DISPLAY_WORDS = new Map<string, string>([
  ["api", "API"],
  ["ask", "Ask"],
  ["atlassian", "Atlassian"],
  ["dune", "Dune"],
  ["figma", "Figma"],
  ["firehydrant", "FireHydrant"],
  ["gmail", "Gmail"],
  ["google", "Google"],
  ["grafana", "Grafana"],
  ["heymarvin", "HeyMarvin"],
  ["hubspot", "HubSpot"],
  ["jira", "Jira"],
  ["mcp", "MCP"],
  ["mixpanel", "Mixpanel"],
  ["o11y", "O11y"],
  ["oauth", "OAuth"],
  ["okta", "Okta"],
])

function formatDisplayWord(value: string): string {
  const normalized = value.toLowerCase()
  return (
    DISPLAY_WORDS.get(normalized) ?? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
  )
}

function formatMachineLabel(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/(?:-?broker-?mcp)(?:-?token)?$/i, "")
    .replace(/-?mcp(?:-?token)?$/i, "")
    .replace(/-?token$/i, "")
    .replace(/-+$/g, "")

  const words = normalized
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean)

  return words.length > 0 ? words.map(formatDisplayWord).join(" ") : null
}

function looksLikeMachineLabel(value: string): boolean {
  const normalized = value.trim()
  return (
    /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(normalized) ||
    (normalized === normalized.toLowerCase() && DISPLAY_WORDS.has(normalized))
  )
}

export function getMcpcfServerDisplayLabel(input: {
  id: string
  slug?: string | null
  label?: string | null
  rawMetadata?: Record<string, unknown> | null
}): string {
  const rawMetadata = input.rawMetadata ?? {}
  const explicitLabel =
    getStringProperty(rawMetadata, ["displayName", "display_name", "title", "label"]) ??
    input.label?.trim() ??
    null

  if (explicitLabel && !looksLikeMachineLabel(explicitLabel)) {
    return explicitLabel
  }

  const displayLabel = [
    explicitLabel,
    getStringProperty(rawMetadata, ["name"]),
    input.label,
    input.slug,
    input.id,
  ]
    .map((candidate) => (candidate ? formatMachineLabel(candidate) : null))
    .find((label): label is string => label !== null)

  return displayLabel ?? input.id
}

export function formatMcpcfAuthLabel(input: {
  authType?: string | null
  oauthProviderId?: string | null
}): string | null {
  const authType = input.authType?.trim().toLowerCase()
  if (!authType) {
    return null
  }

  if (authType === "oauth") {
    const providerLabel = input.oauthProviderId ? formatMachineLabel(input.oauthProviderId) : null
    return providerLabel ? `${providerLabel} OAuth` : "OAuth"
  }

  if (authType === "api_key" || authType === "apikey") {
    return "MCPCF API key"
  }

  if (authType === "token") {
    return "MCPCF API token"
  }

  return formatMachineLabel(authType)
}

export function formatMcpcfUpstreamAuthLabel(authType: string | null | undefined): string | null {
  const normalized = authType?.trim().toLowerCase()
  if (!normalized) {
    return "None"
  }
  if (normalized === "api_key" || normalized === "apikey") {
    return "User API key"
  }
  if (normalized === "token") {
    return "User token"
  }
  if (normalized === "oauth") {
    return "User OAuth"
  }
  return formatMachineLabel(normalized)
}

export function isMcpcfGatewayTokenAuthType(authType: string | null | undefined): boolean {
  const normalized = authType?.trim().toLowerCase()
  return normalized === "token" || normalized === "api_key" || normalized === "apikey"
}

export function isMcpcfUserTokenAuthType(authType: string | null | undefined): boolean {
  return isMcpcfGatewayTokenAuthType(authType)
}

function getBooleanProperty(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean | null {
  const match = keys.map((key) => record[key]).find((value) => typeof value === "boolean")
  return typeof match === "boolean" ? match : null
}

function slugify(value: string): string {
  const slug =
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "server"
  return normalizeMcpcfServerSlug(slug)
}

function getNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key]
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function getFirstNestedRecord(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const match = keys
    .map((key) => getNestedRecord(record, key))
    .find((nested) => Object.keys(nested).length > 0)
  return match ?? {}
}

function normalizeAuthTypeValue(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    return null
  }
  if (normalized === "none" || normalized === "no_auth" || normalized === "anonymous") {
    return null
  }
  if (normalized === "api-key" || normalized === "apikey") {
    return "api_key"
  }
  if (normalized === "bearer") {
    return "token"
  }
  return normalized
}

export function normalizeMcpcfGatewayAuthType(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null
  }
  const record = raw as Record<string, unknown>
  const authRecord = getNestedRecord(record, "auth")
  const authenticationRecord = getNestedRecord(record, "authentication")
  const oauthRecord = getNestedRecord(record, "oauth")
  const oauthConfigRecord = getFirstNestedRecord(record, ["oauthConfig", "oauth_config"])
  const value =
    getStringProperty(record, ["auth_type", "authType", "auth"]) ??
    getStringProperty(authRecord, ["type", "auth_type", "authType"]) ??
    getStringProperty(authenticationRecord, ["type", "auth_type", "authType"]) ??
    getStringProperty(oauthRecord, ["type", "provider"])
  if (value) {
    return normalizeAuthTypeValue(value)
  }

  const oauthEnabled =
    getBooleanProperty(record, ["oauthEnabled", "oauth_enabled"]) ??
    getBooleanProperty(oauthRecord, ["enabled"]) ??
    getBooleanProperty(oauthConfigRecord, ["enabled"])
  if (oauthEnabled === true) {
    return "oauth"
  }
  if (Object.keys(oauthConfigRecord).length > 0) {
    return "oauth"
  }
  if (oauthEnabled === false) {
    return "token"
  }

  return null
}

export function normalizeMcpcfAuthType(raw: unknown): string | null {
  return normalizeMcpcfGatewayAuthType(raw)
}

export function normalizeMcpcfUpstreamAuthType(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null
  }
  const record = raw as Record<string, unknown>
  const upstreamRecord = getFirstNestedRecord(record, [
    "upstreamAuth",
    "upstream_auth",
    "upstreamAuthentication",
    "upstream_authentication",
    "upstream",
    "userCredential",
    "user_credential",
    "userCredentials",
    "user_credentials",
  ])
  const value =
    getStringProperty(record, [
      "upstreamAuthType",
      "upstream_auth_type",
      "upstreamCredentialType",
      "upstream_credential_type",
      "userCredentialType",
      "user_credential_type",
      "userAuthType",
      "user_auth_type",
    ]) ??
    getStringProperty(upstreamRecord, [
      "type",
      "auth_type",
      "authType",
      "credential_type",
      "credentialType",
    ])
  return normalizeAuthTypeValue(value)
}

export function normalizeMcpcfSourceServer(raw: unknown): NormalizedMcpcfSourceServer | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null
  }
  const rawMetadata = raw as Record<string, unknown>
  const id = getStringProperty(rawMetadata, ["id", "server_id", "serverId"])
  if (!id) {
    return null
  }
  const slugSource = getStringProperty(rawMetadata, ["slug", "name", "label", "title"]) ?? id
  const slug = slugify(slugSource)
  const label = getMcpcfServerDisplayLabel({
    id,
    slug,
    label: getStringProperty(rawMetadata, ["label", "name", "title"]) ?? id,
    rawMetadata,
  })
  return {
    id,
    slug,
    label,
    description: getStringProperty(rawMetadata, ["description", "summary"]) ?? "",
    authType: normalizeMcpcfGatewayAuthType(rawMetadata),
    upstreamAuthType: normalizeMcpcfUpstreamAuthType(rawMetadata),
    rawMetadata,
  }
}

export function normalizeMcpcfToolPreview(raw: unknown): McpcfToolPreview | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null
  }
  const record = raw as Record<string, unknown>
  const name = getStringProperty(record, ["name", "tool_name", "toolName"])
  if (!name) {
    return null
  }
  const description = getStringProperty(record, ["description", "summary"]) ?? undefined
  return {
    name,
    ...(description ? { description } : {}),
    ...("inputSchema" in record ? { inputSchema: record.inputSchema } : {}),
    ...("input_schema" in record ? { inputSchema: record.input_schema } : {}),
  }
}

function cleanToolDescription(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim().replace(/\.$/, "") ?? ""
}

function isGenericRegistryToolName(name: string): boolean {
  return /(^|[-_])(?:broker[-_])?(?:health|capabilities)$/i.test(name)
}

function truncateDescription(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

export function getMcpcfServerDescription(input: {
  description?: string | null
  tools?: readonly McpcfToolPreview[] | null
}): string {
  const description = input.description?.trim()
  if (description) {
    return description
  }

  const seenDescriptions = new Set<string>()
  const descriptions = (input.tools ?? [])
    .filter(
      (tool) =>
        Boolean(cleanToolDescription(tool.description)) && !isGenericRegistryToolName(tool.name),
    )
    .map((tool) => cleanToolDescription(tool.description))
    .filter((toolDescription) => {
      const key = toolDescription.toLowerCase()
      if (seenDescriptions.has(key)) {
        return false
      }
      seenDescriptions.add(key)
      return true
    })
    .slice(0, 2)

  if (descriptions.length > 0) {
    return truncateDescription(`Tools include: ${descriptions.join("; ")}.`, 180)
  }

  return "No server description provided by MCP Context Forge. Expand to inspect available tools."
}
