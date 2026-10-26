export type SidebarLocationSearch = {
  category?: string
  githubSetup?: string
  oktaReconnect?: string
  slackUserId?: string
  mcpQuery?: string
  mcpServerId?: string
  mcpServerLabel?: string
  view?: string
}

type SidebarSearchRecord = {
  category?: unknown
  githubSetup?: unknown
  oktaReconnect?: unknown
  slackUserId?: unknown
  mcpQuery?: unknown
  mcpServerId?: unknown
  mcpServerLabel?: unknown
  view?: unknown
}

function isSidebarSearchRecord(search: unknown): search is SidebarSearchRecord {
  return typeof search === "object" && search !== null
}

function readSearchString(
  search: SidebarSearchRecord,
  key: keyof SidebarLocationSearch,
): string | undefined {
  const value = search[key]

  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function parseSidebarLocationSearch(search: unknown): SidebarLocationSearch {
  if (!isSidebarSearchRecord(search)) {
    return {}
  }

  return {
    category: readSearchString(search, "category"),
    githubSetup: readSearchString(search, "githubSetup"),
    oktaReconnect: readSearchString(search, "oktaReconnect"),
    slackUserId: readSearchString(search, "slackUserId"),
    mcpQuery: readSearchString(search, "mcpQuery"),
    mcpServerId: readSearchString(search, "mcpServerId"),
    mcpServerLabel: readSearchString(search, "mcpServerLabel"),
    view: readSearchString(search, "view"),
  }
}
