import type { AgentSkillItem, SessionListResponse } from "@solzero/api"
import { runApi } from "@/lib/api-client"
import type { SettingsAgentTab } from "@/lib/settings-agent-tabs"
import { loadApiAccessData, type ApiAccessData } from "./api-access-settings"
import { archivedSessionsRequest } from "./data-controls-settings"
import type { SettingsCategory } from "./settings-nav"

/** The first data of the settings pane that the URL selects. */
export type SettingsPaneData =
  | { readonly pane: "skills"; readonly skills: readonly AgentSkillItem[] }
  | { readonly pane: "data-controls"; readonly archived: SessionListResponse }
  | { readonly pane: "api-access"; readonly apiAccess: ApiAccessData }
  | { readonly pane: "none" }

export interface SettingsPaneLocation {
  readonly category: SettingsCategory
  readonly tab: SettingsAgentTab
}

/**
 * Loads the first data of one settings pane. Providers and agent runtimes use the provider
 * settings from the authenticated shell. Secrets and MCP servers query as their filters change.
 */
export async function loadSettingsPaneData(
  location: SettingsPaneLocation,
  signal: AbortSignal,
): Promise<SettingsPaneData> {
  if (location.category === "agents" && location.tab === "skills") {
    const response = await runApi((client) => client.skills.list(), {
      signal,
      fallbackMessage: "Failed to load agent skills",
    })

    return { pane: "skills", skills: response.skills }
  }

  if (location.category === "data-controls") {
    const archived = await runApi(archivedSessionsRequest(0), {
      signal,
      fallbackMessage: "Failed to load archived sessions",
    })

    return { pane: "data-controls", archived }
  }

  if (location.category === "api-access") {
    return { pane: "api-access", apiAccess: await loadApiAccessData(signal) }
  }

  return { pane: "none" }
}
