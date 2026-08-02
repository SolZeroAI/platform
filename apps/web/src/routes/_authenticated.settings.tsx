import { createFileRoute } from "@tanstack/react-router"
import { Tabs } from "@cloudflare/kumo/components/tabs"
import { useEffect, useState, type ReactNode } from "react"
import { PageHeader } from "@/components/page-header"
import { SettingsBreadcrumbs } from "@/components/settings/settings-breadcrumbs"
import { AgentDefaultsSettings } from "@/components/settings/agent-defaults-settings"
import { AgentSkillsSettings } from "@/components/settings/agent-skills-settings"
import { ApiAccessSettings } from "@/components/settings/api-access-settings"
import { DataControlsSettings } from "@/components/settings/data-controls-settings"
import { LearnMoreSettings } from "@/components/settings/learn-more-settings"
import {
  type OktaReconnectStatus,
  parseOktaReconnectStatus,
  resolveOAuthCallbackError,
} from "@/components/settings/okta-reconnect"
import { ProvidersSettings } from "@/components/settings/providers-settings"
import { SecretsSettings } from "@/components/settings/secrets-settings"
import {
  getSettingsCategoryFromSearch,
  isSettingsCategory,
  type SettingsCategory,
} from "@/components/settings/settings-nav"
import {
  type SlackLinkStatus,
  normalizeSlackUserId,
  parseSlackLinkStatus,
} from "@/components/settings/slack-linking"
import { SidebarLayout } from "@/components/sidebar-layout"
import {
  getSettingsAgentTab,
  isSettingsAgentTab,
  resolveAgentSettingsLocation,
  SETTINGS_AGENT_TABS,
  type SettingsAgentTab,
} from "@/lib/settings-agent-tabs"
import type { ComponentType } from "react"

interface SettingsSearch {
  category?: SettingsCategory
  tab?: SettingsAgentTab
  legacyMcpRedirect?: true
  githubSetup?: "1"
  oktaReconnect?: OktaReconnectStatus
  slackUserId?: string
  slackLink?: SlackLinkStatus
  mcpQuery?: string
  mcpServerId?: string
  mcpServerLabel?: string
  error?: string
  error_description?: string
}

const SETTINGS_DOCS_CATEGORIES = new Set<SettingsCategory>([
  "providers",
  "agents",
  "api-access",
  "data-controls",
  "learn-more",
])

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

export const Route = createFileRoute("/_authenticated/settings")({
  validateSearch: (search): SettingsSearch => {
    const mcpQuery = normalizeSearchString(search.mcpQuery)
    const mcpServerId = normalizeSearchString(search.mcpServerId)
    const mcpServerLabel = normalizeSearchString(search.mcpServerLabel)
    const hasMcpDeepLink = Boolean(mcpQuery || mcpServerId || mcpServerLabel)
    const agentLocation = resolveAgentSettingsLocation({
      category: search.category,
      tab: search.tab,
      hasMcpDeepLink,
    })
    return {
      category: agentLocation.forceAgentsCategory
        ? "agents"
        : isSettingsCategory(search.category)
          ? search.category
          : undefined,
      tab: agentLocation.tab,
      legacyMcpRedirect: agentLocation.legacyMcpRedirect ? true : undefined,
      githubSetup: search.githubSetup === "1" ? "1" : undefined,
      oktaReconnect: parseOktaReconnectStatus(search.oktaReconnect),
      slackUserId:
        typeof search.slackUserId === "string"
          ? normalizeSlackUserId(search.slackUserId)
          : undefined,
      slackLink: parseSlackLinkStatus(search.slackLink),
      mcpQuery,
      mcpServerId,
      mcpServerLabel,
      error: typeof search.error === "string" ? search.error : undefined,
      error_description:
        typeof search.error_description === "string" ? search.error_description : undefined,
    }
  },
  component: SettingsPage,
})

function SettingsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const activeCategory = getSettingsCategoryFromSearch(search)
  const activeAgentTab = getSettingsAgentTab(search.tab)

  useEffect(() => {
    if (!search.legacyMcpRedirect) {
      return
    }
    void navigate({
      replace: true,
      search: (current) => ({
        ...current,
        category: "agents",
        tab: "mcps",
        legacyMcpRedirect: undefined,
      }),
    })
  }, [navigate, search.legacyMcpRedirect])

  return (
    <SidebarLayout>
      <SettingsContent
        activeCategory={activeCategory}
        activeAgentTab={activeAgentTab}
        onAgentTabChange={(tab) => {
          void navigate({
            replace: true,
            search: (current) => ({ ...current, category: "agents", tab }),
          })
        }}
        oktaReconnect={search.oktaReconnect}
        oktaReconnectError={
          search.oktaReconnect === "error"
            ? resolveOAuthCallbackError(search.error, search.error_description)
            : undefined
        }
        slackUserId={search.slackUserId}
        slackLink={search.slackLink}
        slackLinkError={
          search.slackLink === "error"
            ? resolveOAuthCallbackError(search.error, search.error_description)
            : undefined
        }
        mcpQuery={search.mcpQuery}
        mcpServerId={search.mcpServerId}
        mcpServerLabel={search.mcpServerLabel}
      />
    </SidebarLayout>
  )
}

function SettingsContent({
  activeCategory,
  activeAgentTab,
  onAgentTabChange,
  oktaReconnect,
  oktaReconnectError,
  slackUserId,
  slackLink,
  slackLinkError,
  mcpQuery,
  mcpServerId,
  mcpServerLabel,
}: {
  activeCategory: SettingsCategory
  activeAgentTab: SettingsAgentTab
  onAgentTabChange: (tab: SettingsAgentTab) => void
  oktaReconnect?: OktaReconnectStatus
  oktaReconnectError?: string
  slackUserId?: string
  slackLink?: SlackLinkStatus
  slackLinkError?: string
  mcpQuery?: string
  mcpServerId?: string
  mcpServerLabel?: string
}) {
  const [headerActions, setHeaderActions] = useState<ReactNode | null>(null)

  useEffect(() => {
    setHeaderActions(null)
  }, [activeAgentTab, activeCategory])

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        actions={
          activeCategory === "agents" ? (
            <>
              {activeAgentTab === "runtimes" ? headerActions : null}
              <AgentSettingsTabs tab={activeAgentTab} onChange={onAgentTabChange} />
            </>
          ) : activeCategory === "providers" ? (
            headerActions
          ) : null
        }
      >
        <SettingsBreadcrumbs category={activeCategory} />
      </PageHeader>

      <div
        className={
          SETTINGS_DOCS_CATEGORIES.has(activeCategory)
            ? "flex-1 overflow-y-auto px-12 py-8"
            : "flex-1 overflow-y-auto p-8"
        }
      >
        <div
          className={
            SETTINGS_DOCS_CATEGORIES.has(activeCategory) ? "w-full max-w-6xl" : "w-full max-w-2xl"
          }
        >
          {activeCategory === "providers" && (
            <ProvidersSettings onHeaderActionsChange={setHeaderActions} />
          )}
          {activeCategory === "agents" && (
            <>
              {activeAgentTab === "runtimes" ? (
                <AgentDefaultsSettings onHeaderActionsChange={setHeaderActions} />
              ) : activeAgentTab === "skills" ? (
                <AgentSkillsSettings />
              ) : (
                <McpSettingsPane
                  initialQuery={mcpQuery}
                  selectedServerId={mcpServerId}
                  selectedServerLabel={mcpServerLabel}
                />
              )}
            </>
          )}
          {activeCategory === "secrets" && <SecretsSettings />}
          {activeCategory === "api-access" && (
            <ApiAccessSettings
              oktaReconnect={oktaReconnect}
              oktaReconnectError={oktaReconnectError}
              slackUserId={slackUserId}
              slackLink={slackLink}
              slackLinkError={slackLinkError}
            />
          )}
          {activeCategory === "data-controls" && <DataControlsSettings />}
          {activeCategory === "learn-more" && <LearnMoreSettings />}
        </div>
      </div>
    </div>
  )
}

export function AgentSettingsTabs({
  tab,
  onChange,
}: {
  tab: SettingsAgentTab
  onChange: (tab: SettingsAgentTab) => void
}) {
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (isSettingsAgentTab(value)) {
          onChange(value)
        }
      }}
      tabs={SETTINGS_AGENT_TABS}
      variant="segmented"
    />
  )
}

interface McpSettingsPaneProps {
  initialQuery?: string
  selectedServerId?: string
  selectedServerLabel?: string
}

function McpSettingsPane(props: McpSettingsPaneProps) {
  const [McpSettingsComponent, setMcpSettingsComponent] =
    useState<ComponentType<McpSettingsPaneProps> | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let mounted = true
    import("../components/settings/mcp-settings")
      .then((module) => {
        if (mounted) {
          setMcpSettingsComponent(() => module.McpSettings)
        }
      })
      .catch(() => {
        if (mounted) {
          setLoadError(true)
        }
      })
    return () => {
      mounted = false
    }
  }, [])

  if (loadError) {
    return <p className="text-sm text-kumo-danger">Failed to load MCP settings.</p>
  }

  if (!McpSettingsComponent) {
    return <p className="text-sm text-kumo-subtle">Loading MCP settings...</p>
  }

  return <McpSettingsComponent {...props} />
}
