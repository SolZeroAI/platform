export type SettingsAgentTab = "runtimes" | "skills" | "mcps"

export const SETTINGS_AGENT_TABS: Array<{ value: SettingsAgentTab; label: string }> = [
  { value: "runtimes", label: "Runtimes" },
  { value: "skills", label: "Skills" },
  { value: "mcps", label: "MCPs" },
]

export function isSettingsAgentTab(value: unknown): value is SettingsAgentTab {
  return value === "runtimes" || value === "skills" || value === "mcps"
}

export function getSettingsAgentTab(value: unknown): SettingsAgentTab {
  return isSettingsAgentTab(value) ? value : "runtimes"
}

export function resolveAgentSettingsLocation(input: {
  category: unknown
  tab: unknown
  hasMcpDeepLink: boolean
}): {
  forceAgentsCategory: boolean
  tab: SettingsAgentTab | undefined
  legacyMcpRedirect: boolean
} {
  const legacyMcpRedirect = input.category === "mcp"
  const forceAgentsCategory = legacyMcpRedirect || input.hasMcpDeepLink
  return {
    forceAgentsCategory,
    tab: forceAgentsCategory ? "mcps" : isSettingsAgentTab(input.tab) ? input.tab : undefined,
    legacyMcpRedirect,
  }
}
