"use client"

import {
  Bot,
  CircleHelp,
  Database,
  KeyRound,
  Link2,
  TableProperties,
  type LucideIcon,
} from "lucide-react"

export const SETTINGS_NAV_ITEMS = [
  {
    id: "providers",
    label: "AI Providers",
    icon: TableProperties,
  },
  {
    id: "agents",
    label: "Agents",
    icon: Bot,
  },
  {
    id: "secrets",
    label: "Secrets",
    icon: KeyRound,
  },
  {
    id: "api-access",
    label: "Accounts",
    icon: Link2,
  },
  {
    id: "data-controls",
    label: "Data Controls",
    icon: Database,
  },
  {
    id: "learn-more",
    label: "Learn More",
    icon: CircleHelp,
  },
] as const satisfies readonly {
  id: string
  label: string
  icon: LucideIcon
}[]

export type SettingsCategory = (typeof SETTINGS_NAV_ITEMS)[number]["id"]

export function isSettingsCategory(value: unknown): value is SettingsCategory {
  return typeof value === "string" && SETTINGS_NAV_ITEMS.some((item) => item.id === value)
}

export function getSettingsCategoryLabel(category: SettingsCategory): string {
  return SETTINGS_NAV_ITEMS.find((item) => item.id === category)?.label ?? "Settings"
}

export function getSettingsCategoryFromSearch(search: Record<string, unknown>): SettingsCategory {
  if (search.githubSetup || search.oktaReconnect || search.slackUserId) {
    return "api-access"
  }
  if (search.mcpQuery || search.mcpServerId || search.mcpServerLabel) {
    return "agents"
  }
  return isSettingsCategory(search.category) ? search.category : "providers"
}
