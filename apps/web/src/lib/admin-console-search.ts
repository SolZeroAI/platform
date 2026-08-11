export type AdminView = "sessions" | "workflows" | "ai-search" | "integrations"
export type AdminIntegrationTab = "ai-providers" | "mcps" | "skills"
export type SortDir = "asc" | "desc"
export type AdminRoutePath =
  | "/admin/agents"
  | "/admin/workflows"
  | "/admin/ai-search"
  | "/admin/integrations"

export interface AdminSearch {
  view: AdminView
  integrationTab: AdminIntegrationTab
  sessionsQ?: string
  sessionsStatus?: string
  sessionsKind?: string
  sessionsSource?: string
  sessionsUserId?: string
  sessionsRepoOwner?: string
  sessionsRepoName?: string
  sessionsSortBy: string
  sessionsSortDir: SortDir
  sessionsPage: number
  sessionsPageSize: number
  workflowsQ?: string
  workflowsStatus?: string
  workflowsUserId?: string
  workflowsSortBy: string
  workflowsSortDir: SortDir
  workflowsPage: number
  workflowsPageSize: number
}

export interface SessionTableState {
  q: string
  status: string
  kind: string
  source: string
  userId: string
  repoOwner: string
  repoName: string
  sortBy: string
  sortDir: SortDir
  pageIndex: number
  pageSize: number
}

export interface WorkflowTableState {
  q: string
  status: string
  userId: string
  sortBy: string
  sortDir: SortDir
  pageIndex: number
  pageSize: number
}

export type AdminConsoleSearchUpdate =
  | Partial<AdminSearch>
  | ((previous: AdminSearch) => Partial<AdminSearch>)

export type AdminConsoleSearchUpdater = (input: AdminConsoleSearchUpdate) => void

export type AdminRouteSearch = {
  q?: string
  status?: string
  kind?: string
  source?: string
  userId?: string
  repoOwner?: string
  repoName?: string
  sortBy?: string
  sortDir?: SortDir
  page?: number
  pageSize?: number
  tab?: AdminIntegrationTab
}

export const DEFAULT_PAGE_SIZE = 10
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
export const SESSION_STATUS_OPTIONS = [
  "created",
  "active",
  "completed",
  "archived",
  "deleted",
] as const
export const SESSION_RUNTIME_OPTIONS = AGENT_RUNTIMES
export const SESSION_SOURCE_OPTIONS = ["web", "api", "slack"] as const
export const WORKFLOW_STATUS_OPTIONS = ["active", "archived"] as const

export const ADMIN_VIEW_PATHS = {
  sessions: "/admin/agents",
  workflows: "/admin/workflows",
  "ai-search": "/admin/ai-search",
  integrations: "/admin/integrations",
} satisfies Record<AdminView, AdminRoutePath>

export function adminPathForView(view: AdminView): AdminRoutePath {
  return ADMIN_VIEW_PATHS[view]
}

export function adminViewFromPath(
  pathname: string | undefined,
  search?: Record<string, unknown>,
): AdminView {
  if (pathname?.startsWith("/admin/workflows")) {
    return "workflows"
  }
  if (pathname?.startsWith("/admin/integrations")) {
    return "integrations"
  }
  if (pathname?.startsWith("/admin/ai-search")) {
    return "ai-search"
  }
  if (pathname?.startsWith("/admin/agents")) {
    return "sessions"
  }
  return parseAdminView(search ?? {})
}

export function normalizeAdminSearch(
  search: Record<string, unknown>,
  viewOverride?: AdminView,
): AdminSearch {
  const view = viewOverride ?? parseAdminView(search)
  const requestedIntegrationTab = search.tab ?? search.integrationTab
  const integrationTab =
    view === "integrations" &&
    (requestedIntegrationTab === "mcps" || requestedIntegrationTab === "skills")
      ? requestedIntegrationTab
      : "ai-providers"
  return {
    view,
    integrationTab,
    sessionsQ: parseRouteSearchString(search, view, "sessionsQ", "q", "sessions"),
    sessionsStatus: parseRouteSearchString(search, view, "sessionsStatus", "status", "sessions"),
    sessionsKind: parseRouteSearchString(search, view, "sessionsKind", "kind", "sessions"),
    sessionsSource: parseRouteSearchString(search, view, "sessionsSource", "source", "sessions"),
    sessionsUserId: parseRouteSearchString(search, view, "sessionsUserId", "userId", "sessions"),
    sessionsRepoOwner: parseRouteSearchString(
      search,
      view,
      "sessionsRepoOwner",
      "repoOwner",
      "sessions",
    ),
    sessionsRepoName: parseRouteSearchString(
      search,
      view,
      "sessionsRepoName",
      "repoName",
      "sessions",
    ),
    sessionsSortBy:
      parseRouteSearchString(search, view, "sessionsSortBy", "sortBy", "sessions") ?? "updatedAt",
    sessionsSortDir: parseRouteSortDir(search, view, "sessionsSortDir", "sessions"),
    sessionsPage: parseRoutePositiveInt(search, view, "sessionsPage", "page", "sessions"),
    sessionsPageSize: parseRoutePageSize(search, view, "sessionsPageSize", "pageSize", "sessions"),
    workflowsQ: parseRouteSearchString(search, view, "workflowsQ", "q", "workflows"),
    workflowsStatus: parseRouteSearchString(search, view, "workflowsStatus", "status", "workflows"),
    workflowsUserId: parseRouteSearchString(search, view, "workflowsUserId", "userId", "workflows"),
    workflowsSortBy:
      parseRouteSearchString(search, view, "workflowsSortBy", "sortBy", "workflows") ?? "updatedAt",
    workflowsSortDir: parseRouteSortDir(search, view, "workflowsSortDir", "workflows"),
    workflowsPage: parseRoutePositiveInt(search, view, "workflowsPage", "page", "workflows"),
    workflowsPageSize: parseRoutePageSize(
      search,
      view,
      "workflowsPageSize",
      "pageSize",
      "workflows",
    ),
  }
}

function parseAdminView(search: Record<string, unknown>): AdminView {
  return search.view === "sessions" ||
    search.view === "workflows" ||
    search.view === "ai-search" ||
    search.view === "integrations"
    ? search.view
    : "sessions"
}

export function compactAdminSearch(search: AdminSearch): AdminRouteSearch {
  if (search.view === "ai-search") {
    return {}
  }

  if (search.view === "integrations") {
    return {
      tab: search.integrationTab === "ai-providers" ? undefined : search.integrationTab,
    }
  }

  if (search.view === "workflows") {
    return {
      q: emptyToUndefined(search.workflowsQ),
      status: emptyToUndefined(search.workflowsStatus),
      userId: emptyToUndefined(search.workflowsUserId),
      sortBy: defaultStringToUndefined(search.workflowsSortBy, "updatedAt"),
      sortDir: defaultSortDirToUndefined(search.workflowsSortDir),
      page: defaultNumberToUndefined(search.workflowsPage, 1),
      pageSize: defaultNumberToUndefined(search.workflowsPageSize, DEFAULT_PAGE_SIZE),
    }
  }

  return {
    q: emptyToUndefined(search.sessionsQ),
    status: emptyToUndefined(search.sessionsStatus),
    kind: emptyToUndefined(search.sessionsKind),
    source: emptyToUndefined(search.sessionsSource),
    userId: emptyToUndefined(search.sessionsUserId),
    repoOwner: emptyToUndefined(search.sessionsRepoOwner),
    repoName: emptyToUndefined(search.sessionsRepoName),
    sortBy: defaultStringToUndefined(search.sessionsSortBy, "updatedAt"),
    sortDir: defaultSortDirToUndefined(search.sessionsSortDir),
    page: defaultNumberToUndefined(search.sessionsPage, 1),
    pageSize: defaultNumberToUndefined(search.sessionsPageSize, DEFAULT_PAGE_SIZE),
  }
}

export function canonicalAdminSearchForView(
  view: AdminView,
  search: Record<string, unknown>,
): AdminRouteSearch {
  return compactAdminSearch(normalizeAdminSearch(search, view))
}

export function isCanonicalAdminSearch(
  current: Record<string, unknown>,
  canonical: AdminRouteSearch,
): boolean {
  return serializeAdminSearch(current) === serializeAdminSearch(canonical)
}

function serializeAdminSearch(search: Record<string, unknown>): string {
  return JSON.stringify(
    Object.entries(search)
      .flatMap(([key, value]) => {
        const serializedValue = serializeAdminSearchValue(value)
        return serializedValue === undefined ? [] : [[key, serializedValue]]
      })
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
  )
}

function serializeAdminSearchValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return JSON.stringify(value)
}

function parseRouteSearchString(
  search: Record<string, unknown>,
  view: AdminView,
  legacyKey: string,
  routeKey: string,
  routeView: AdminView,
): string | undefined {
  return (
    parseSearchString(search[legacyKey]) ??
    (view === routeView ? parseSearchString(search[routeKey]) : undefined)
  )
}

function parseRouteSortDir(
  search: Record<string, unknown>,
  view: AdminView,
  legacyKey: string,
  routeView: AdminView,
): SortDir {
  return parseSortDir(search[legacyKey] ?? (view === routeView ? search.sortDir : undefined))
}

function parseRoutePositiveInt(
  search: Record<string, unknown>,
  view: AdminView,
  legacyKey: string,
  routeKey: string,
  routeView: AdminView,
): number {
  return parsePositiveInt(
    search[legacyKey] ?? (view === routeView ? search[routeKey] : undefined),
    1,
  )
}

function parseRoutePageSize(
  search: Record<string, unknown>,
  view: AdminView,
  legacyKey: string,
  routeKey: string,
  routeView: AdminView,
): number {
  return parsePageSize(search[legacyKey] ?? (view === routeView ? search[routeKey] : undefined))
}

function defaultStringToUndefined(value: string, defaultValue: string): string | undefined {
  const compactValue = emptyToUndefined(value)
  return compactValue === defaultValue ? undefined : compactValue
}

function defaultSortDirToUndefined(value: SortDir): SortDir | undefined {
  return value === "desc" ? undefined : value
}

function defaultNumberToUndefined(value: number, defaultValue: number): number | undefined {
  return value === defaultValue ? undefined : value
}

export function sessionStateFromSearch(search: AdminSearch): SessionTableState {
  return {
    q: search.sessionsQ ?? "",
    status: search.sessionsStatus ?? "",
    kind: search.sessionsKind ?? "",
    source: search.sessionsSource ?? "",
    userId: search.sessionsUserId ?? "",
    repoOwner: search.sessionsRepoOwner ?? "",
    repoName: search.sessionsRepoName ?? "",
    sortBy: search.sessionsSortBy,
    sortDir: search.sessionsSortDir,
    pageIndex: search.sessionsPage - 1,
    pageSize: search.sessionsPageSize,
  }
}

export function workflowStateFromSearch(search: AdminSearch): WorkflowTableState {
  return {
    q: search.workflowsQ ?? "",
    status: search.workflowsStatus ?? "",
    userId: search.workflowsUserId ?? "",
    sortBy: search.workflowsSortBy,
    sortDir: search.workflowsSortDir,
    pageIndex: search.workflowsPage - 1,
    pageSize: search.workflowsPageSize,
  }
}

export function sessionSearchPatch(
  previous: AdminSearch,
  patch: Partial<SessionTableState>,
): Partial<AdminSearch> {
  return {
    sessionsQ: patch.q,
    sessionsStatus: patch.status,
    sessionsKind: patch.kind,
    sessionsSource: patch.source,
    sessionsUserId: patch.userId,
    sessionsRepoOwner: patch.repoOwner,
    sessionsRepoName: patch.repoName,
    sessionsSortBy: patch.sortBy ?? previous.sessionsSortBy,
    sessionsSortDir: patch.sortDir ?? previous.sessionsSortDir,
    sessionsPage: patch.pageIndex === undefined ? previous.sessionsPage : patch.pageIndex + 1,
    sessionsPageSize: patch.pageSize ?? previous.sessionsPageSize,
  }
}

export function workflowSearchPatch(
  previous: AdminSearch,
  patch: Partial<WorkflowTableState>,
): Partial<AdminSearch> {
  return {
    workflowsQ: patch.q,
    workflowsStatus: patch.status,
    workflowsUserId: patch.userId,
    workflowsSortBy: patch.sortBy ?? previous.workflowsSortBy,
    workflowsSortDir: patch.sortDir ?? previous.workflowsSortDir,
    workflowsPage: patch.pageIndex === undefined ? previous.workflowsPage : patch.pageIndex + 1,
    workflowsPageSize: patch.pageSize ?? previous.workflowsPageSize,
  }
}

function parseSearchString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function parseSortDir(value: unknown): SortDir {
  return value === "asc" ? "asc" : "desc"
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function parsePageSize(value: unknown): number {
  const parsed = parsePositiveInt(value, DEFAULT_PAGE_SIZE)
  return PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number])
    ? parsed
    : DEFAULT_PAGE_SIZE
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value?.trim() ? value.trim() : undefined
}

export function sessionQueryParams(state: SessionTableState): URLSearchParams {
  const params = baseTableQueryParams(state)
  setOptionalParam(params, "status", state.status)
  setOptionalParam(params, "agentRuntime", state.kind)
  setOptionalParam(params, "source", state.source)
  setOptionalParam(params, "userId", state.userId)
  setOptionalParam(params, "repoOwner", state.repoOwner)
  setOptionalParam(params, "repoName", state.repoName)
  return params
}

export function workflowQueryParams(state: WorkflowTableState): URLSearchParams {
  const params = baseTableQueryParams(state)
  setOptionalParam(params, "status", state.status)
  setOptionalParam(params, "userId", state.userId)
  return params
}

function baseTableQueryParams(state: {
  q: string
  sortBy: string
  sortDir: SortDir
  pageIndex: number
  pageSize: number
}): URLSearchParams {
  const params = new URLSearchParams()
  params.set("limit", String(state.pageSize))
  params.set("offset", String(state.pageIndex * state.pageSize))
  params.set("sortBy", state.sortBy)
  params.set("sortDir", state.sortDir)
  setOptionalParam(params, "q", state.q)
  return params
}

function setOptionalParam(params: URLSearchParams, key: string, value: string | undefined) {
  if (value?.trim()) {
    params.set(key, value.trim())
  }
}
import { AGENT_RUNTIMES } from "@solzero/shared"
