import type { InstallationRepository, PullRequest } from "@c0-agent/shared"

export const GITHUB_FETCH_TIMEOUT_MS = 30_000
export const GITHUB_API_BASE = "https://api.github.com"
export const GITHUB_API_VERSION = "2022-11-28"
export const GITHUB_USER_AGENT = "c0-agent"

export type GitHubAppPermissionLevel = "read" | "write"

export interface GitHubAppConfig {
  appId: string
  clientId: string
  clientSecret: string
  privateKey: string
  slug: string | null
  webhookSecret: string | null
}

export interface GitHubRepositoryPermissions {
  contents: GitHubAppPermissionLevel | null
  pullRequests: GitHubAppPermissionLevel | null
  metadata: GitHubAppPermissionLevel | null
  userCanPull: boolean
  userCanPush: boolean
  userCanAdmin: boolean
  canPush: boolean
  canOpenPullRequests: boolean
}

export interface GitHubAppRepository extends InstallationRepository {
  installationId: number
  permissions: GitHubRepositoryPermissions
}

export interface GitHubInstallationAccessToken {
  token: string
  expiresAt: string
  permissions: Record<string, string>
  repositorySelection: "all" | "selected" | null
}

export interface GitHubCreatePullRequestInput {
  token: string
  repoOwner: string
  repoName: string
  title: string
  body?: string | null
  head: string
  base: string
  draft?: boolean
}

export interface GitHubUserProfile {
  id: number
  login: string
  name: string | null
  email: string | null
}

export type GitHubRepositoryVisibilityFilter = "all" | "private" | "public"
export type GitHubRepositorySearchSort = "best-match" | "updated"
export type GitHubRepositorySearchOrder = "asc" | "desc"

export interface GitHubRepositoryOwner {
  login: string
  type: string
}

export interface GitHubRepositoryPage {
  repositories: GitHubAppRepository[]
  owners: GitHubRepositoryOwner[]
  page: number
  perPage: number
  totalCount: number | null
  hasMore: boolean
}

export interface RepositoryPageAccumulator {
  repositories: GitHubAppRepository[]
  skipped: number
  totalCount: number
}

export interface GitHubRepositoryPageOptions {
  owner?: string | null
  page?: number
  perPage?: number
}

export interface GitHubRepositorySearchOptions extends GitHubRepositoryPageOptions {
  query?: string | null
  visibility?: GitHubRepositoryVisibilityFilter
  sort?: GitHubRepositorySearchSort
  order?: GitHubRepositorySearchOrder
}

export interface GitHubInstallation {
  id: number
  permissions?: Record<string, string>
  suspended_at?: string | null
  account?: {
    login: string
    type?: string
  } | null
}

export interface GitHubInstallationResponse {
  total_count: number
  installations: GitHubInstallation[]
}

export interface GitHubInstallationRepositoriesResponse {
  total_count: number
  repositories: GitHubRepoResponse[]
}

export interface GitHubRepositorySearchResponse {
  total_count: number
  incomplete_results: boolean
  items: GitHubRepoResponse[]
}

export interface GitHubRepoResponse {
  id: number
  name: string
  full_name: string
  description: string | null
  private: boolean
  default_branch: string
  owner: {
    login: string
  }
  permissions?: {
    admin?: boolean
    maintain?: boolean
    push?: boolean
    triage?: boolean
    pull?: boolean
  }
}

export interface InstallationTokenResponse {
  token: string
  expires_at: string
  permissions?: Record<string, string>
  repository_selection?: "all" | "selected"
}

export interface GitHubPullRequestResponse {
  number: number
  title: string
  body: string | null
  html_url: string
  state: "open" | "closed"
  head: { ref: string }
  base: { ref: string }
  merged?: boolean
  created_at: string
  updated_at: string
}

export interface GitHubUserResponse {
  id: number
  login: string
  name: string | null
  email: string | null
}

function bigEndianBytes(value: number): number[] {
  return value > 0 ? [...bigEndianBytes(value >> 8), value & 0xff] : []
}

function encodeDerLength(length: number): Uint8Array {
  if (length < 0x80) {
    return new Uint8Array([length])
  }

  const bytes = bigEndianBytes(length)
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const output = new Uint8Array(length)
  parts.reduce((offset, part) => {
    output.set(part, offset)
    return offset + part.length
  }, 0)
  return output
}

function derSequence(...children: Uint8Array[]): Uint8Array {
  const body = concatBytes(children)
  return concatBytes([new Uint8Array([0x30]), encodeDerLength(body.length), body])
}

function derInteger(value: number): Uint8Array {
  return new Uint8Array([0x02, 0x01, value])
}

function derNull(): Uint8Array {
  return new Uint8Array([0x05, 0x00])
}

function derObjectIdentifier(bytes: number[]): Uint8Array {
  return concatBytes([new Uint8Array([0x06]), encodeDerLength(bytes.length), new Uint8Array(bytes)])
}

function derOctetString(bytes: Uint8Array): Uint8Array {
  return concatBytes([new Uint8Array([0x04]), encodeDerLength(bytes.length), bytes])
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
}

function pemBody(pem: string): string {
  return pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s/g, "")
}

function wrapPem(label: string, base64: string): string {
  const lines = base64.match(/.{1,64}/g) ?? []
  return [`-----BEGIN ${label}-----`, ...lines, `-----END ${label}-----`].join("\n")
}

function convertPkcs1ToPkcs8Pem(pkcs1Pem: string): string {
  const pkcs1 = base64ToBytes(pemBody(pkcs1Pem))
  const rsaEncryptionOid = derObjectIdentifier([
    0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
  ])
  const algorithmIdentifier = derSequence(rsaEncryptionOid, derNull())
  const privateKeyInfo = derSequence(derInteger(0), algorithmIdentifier, derOctetString(pkcs1))
  return wrapPem("PRIVATE KEY", bytesToBase64(privateKeyInfo))
}

export function normalizePrivateKeyForJose(value: string): string {
  const privateKey = value.replace(/\\n/g, "\n").trim()
  return privateKey.includes("BEGIN RSA PRIVATE KEY")
    ? convertPkcs1ToPkcs8Pem(privateKey)
    : privateKey
}

export function githubHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": GITHUB_USER_AGENT,
  }
}

export function githubJsonHeaders(accessToken: string): HeadersInit {
  return {
    ...githubHeaders(accessToken),
    "Content-Type": "application/json",
  }
}

function normalizePermission(value: unknown): GitHubAppPermissionLevel | null {
  return value === "read" || value === "write" ? value : null
}

function isWritePermission(value: GitHubAppPermissionLevel | null): boolean {
  return value === "write"
}

export function toRepository(
  repo: GitHubRepoResponse,
  installationId: number,
  installationPermissions: Record<string, string> | undefined,
): GitHubAppRepository {
  const contents = normalizePermission(installationPermissions?.contents)
  const pullRequests = normalizePermission(installationPermissions?.pull_requests)
  const metadata = normalizePermission(installationPermissions?.metadata)
  const userCanPull = repo.permissions?.pull === true
  const userCanPush = repo.permissions?.push === true || repo.permissions?.admin === true
  const userCanAdmin = repo.permissions?.admin === true

  return {
    id: repo.id,
    owner: repo.owner.login.toLowerCase(),
    name: repo.name.toLowerCase(),
    fullName: repo.full_name.toLowerCase(),
    description: repo.description,
    private: repo.private,
    defaultBranch: repo.default_branch,
    installationId,
    permissions: {
      contents,
      pullRequests,
      metadata,
      userCanPull,
      userCanPush,
      userCanAdmin,
      canPush: userCanPush && isWritePermission(contents),
      canOpenPullRequests:
        userCanPush && isWritePermission(contents) && isWritePermission(pullRequests),
    },
  }
}

export function normalizePage(value: number | undefined): number {
  return Number.isInteger(value) && value && value > 0 ? value : 1
}

export function normalizePerPage(value: number | undefined): number {
  if (!Number.isInteger(value) || !value || value <= 0) {
    return 20
  }
  return Math.min(value, 100)
}

function isActiveInstallation(installation: GitHubInstallation): boolean {
  return !installation.suspended_at
}

function toRepositoryOwnerEntry(
  installation: GitHubInstallation,
): readonly [string, GitHubRepositoryOwner] | null {
  const login = installation.account?.login.toLowerCase()
  if (!isActiveInstallation(installation) || !login) {
    return null
  }
  return [login, { login, type: installation.account?.type || "User" }] as const
}

export function toRepositoryOwners(installations: GitHubInstallation[]): GitHubRepositoryOwner[] {
  const owners = new Map<string, GitHubRepositoryOwner>(
    installations
      .map(toRepositoryOwnerEntry)
      .filter((entry): entry is readonly [string, GitHubRepositoryOwner] => entry !== null),
  )
  return [...owners.values()].sort((left, right) => left.login.localeCompare(right.login))
}

export function filterInstallationsByOwner(
  installations: GitHubInstallation[],
  owner: string | null | undefined,
): GitHubInstallation[] {
  const ownerKey = owner?.trim().toLowerCase()
  return installations.filter((installation) => {
    if (!isActiveInstallation(installation)) {
      return false
    }
    return !ownerKey || installation.account?.login.toLowerCase() === ownerKey
  })
}

export function repositoryOwnerQualifier(owner: string, owners: GitHubRepositoryOwner[]): string {
  const ownerType = owners.find((candidate) => candidate.login === owner)?.type.toLowerCase()
  return `${ownerType === "organization" ? "org" : "user"}:${owner}`
}

export function buildRepositorySearchQuery(
  options: GitHubRepositorySearchOptions,
  owners: GitHubRepositoryOwner[],
  owner: string | null,
): string {
  const parts: string[] = []
  const query = options.query?.trim()

  if (query) {
    parts.push(query)
  }

  if (owner) {
    parts.push(repositoryOwnerQualifier(owner, owners))
  }

  if (options.visibility === "private" || options.visibility === "public") {
    parts.push(`is:${options.visibility}`)
  }

  return parts.length > 0 ? parts.join(" ") : "archived:false"
}

export interface SearchAccumulator {
  authorized: Map<number, GitHubAppRepository>
  githubHasMore: boolean
  done: boolean
}

export interface SearchInstallationContext {
  userAccessToken: string
  options: GitHubRepositorySearchOptions
  owners: GitHubRepositoryOwner[]
  targetCount: number
  maxSearchPages: number
}

export function applySearchItems(
  context: SearchInstallationContext,
  installedRepositories: ReadonlyMap<number, GitHubAppRepository>,
  acc: SearchAccumulator,
  items: readonly GitHubRepoResponse[],
): SearchAccumulator {
  return items.reduce<SearchAccumulator>((current, repo) => {
    if (current.done) {
      return current
    }
    if (current.authorized.size > context.targetCount) {
      return { ...current, done: true }
    }
    if (context.options.visibility === "private" && repo.private !== true) {
      return current
    }
    if (context.options.visibility === "public" && repo.private === true) {
      return current
    }
    const installedRepo = installedRepositories.get(repo.id)
    if (installedRepo) {
      current.authorized.set(repo.id, installedRepo)
    }
    return current
  }, acc)
}

export function toGitHubUserProfile(user: GitHubUserResponse): GitHubUserProfile {
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    email: user.email,
  }
}

export function toInstallationAccessToken(
  data: InstallationTokenResponse,
): GitHubInstallationAccessToken {
  return {
    token: data.token,
    expiresAt: data.expires_at,
    permissions: data.permissions ?? {},
    repositorySelection: data.repository_selection ?? null,
  }
}

export function toPullRequest(data: GitHubPullRequestResponse): PullRequest {
  return {
    number: data.number,
    title: data.title,
    body: data.body ?? "",
    url: data.html_url,
    state: data.merged ? "merged" : data.state,
    headRef: data.head.ref,
    baseRef: data.base.ref,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  }
}

export function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    return null
  }
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16))
}

export function responseErrorBody(response: Response): Promise<string | null> {
  return response.ok ? Promise.resolve(null) : response.text()
}

export function formatGitHubApiError(prefix: string, response: Response, body: string): string {
  return `${prefix}: ${response.status} ${body}`
}

export function createGitHubAbortState(timeoutMs: number): {
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
} {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return { controller, timer }
}

export function clearGitHubAbortState(state: { timer: ReturnType<typeof setTimeout> }): void {
  clearTimeout(state.timer)
}

export function buildRepositorySearchParams(
  options: GitHubRepositorySearchOptions,
  searchPage: number,
): URLSearchParams {
  const params = new URLSearchParams({
    q: "",
    per_page: "100",
    page: String(searchPage),
  })
  if (options.sort === "updated") {
    params.set("sort", "updated")
    params.set("order", options.order === "asc" ? "asc" : "desc")
  }
  return params
}

export function buildPullRequestBody(input: GitHubCreatePullRequestInput): Record<string, unknown> {
  return {
    title: input.title,
    body: input.body ?? "",
    head: input.head,
    base: input.base,
    ...(input.draft ? { draft: true } : {}),
  }
}
