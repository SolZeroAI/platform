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

function readSearchString(search: object, key: keyof SidebarLocationSearch): string | undefined {
  const value = Reflect.get(search, key)
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function parseSidebarLocationSearch(search: unknown): SidebarLocationSearch {
  if (typeof search !== "object" || search === null) {
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
