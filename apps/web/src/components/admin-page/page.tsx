import { Banner } from "@cloudflare/kumo/components/banner"
import { Breadcrumbs } from "@cloudflare/kumo/components/breadcrumbs"
import { Tabs } from "@cloudflare/kumo/components/tabs"
import { useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { AdminAgentSkillsPanel } from "@/components/admin-agent-skills-panel"
import { AdminAiSearchPanel } from "@/components/admin-ai-search-panel"
import { AdminAiProviderPanel } from "@/components/admin-ai-provider-panel"
import { resetAdminDocumentScroll } from "@/components/admin-ai-provider-panel-ui"
import { C0Loader } from "@/components/c0-loader"
import { McpcfAdminPanel, McpcfRefreshDialog } from "@/components/admin-mcpcf-panel"
import { PageHeader } from "@/components/page-header"
import { SidebarLayout } from "@/components/sidebar-layout"
import { useAuthSession } from "@/lib/auth-client"
import { appToastManager, showErrorToast } from "@/lib/toast-manager"
import {
  type AdminSearch,
  type AdminAiSearchInitialData,
  type AdminIntegrationsInitialData,
  type AdminIntegrationTab,
  type AdminView,
  adminPathForView,
  compactAdminSearch,
  normalizeAdminSearch,
  sessionSearchPatch,
  useAdminConsole,
  workflowSearchPatch,
} from "@/lib/admin-console"
import { SessionsTable, WorkflowsTable } from "./tables"
import { RunDetailDrawer, SessionDetailDrawer } from "./drawers"

export function AdminPage({
  initialAdminAiSearch = null,
  initialAdminIntegrations = null,
  search,
  view,
}: {
  initialAdminAiSearch?: AdminAiSearchInitialData | null
  initialAdminIntegrations?: AdminIntegrationsInitialData | null
  search: Record<string, unknown>
  view: AdminView
}) {
  return (
    <SidebarLayout>
      <AdminContent
        initialAdminAiSearch={initialAdminAiSearch}
        initialAdminIntegrations={initialAdminIntegrations}
        search={search}
        view={view}
      />
    </SidebarLayout>
  )
}

export function AdminContent({
  initialAdminAiSearch = null,
  initialAdminIntegrations = null,
  search,
  view,
}: {
  initialAdminAiSearch?: AdminAiSearchInitialData | null
  initialAdminIntegrations?: AdminIntegrationsInitialData | null
  search: Record<string, unknown>
  view: AdminView
}) {
  const { data: session, status: authStatus } = useAuthSession()
  const isAdmin = session?.isAdmin === true
  const normalizedSearch = normalizeAdminSearch(search, view)
  const navigate = useNavigate()
  const [integrationHeaderActions, setIntegrationHeaderActions] = useState<ReactNode | null>(null)

  useEffect(() => {
    setIntegrationHeaderActions(null)
  }, [normalizedSearch.integrationTab])

  const updateSearch = useCallback(
    (input: Partial<AdminSearch> | ((previous: AdminSearch) => Partial<AdminSearch>)) => {
      void navigate({
        to: adminPathForView(view),
        replace: true,
        search: (previous) => {
          const normalizedPrevious = normalizeAdminSearch(previous, view)
          const patch = typeof input === "function" ? input(normalizedPrevious) : input
          return compactAdminSearch({ ...normalizedPrevious, ...patch, view })
        },
      })
    },
    [navigate, view],
  )

  const adminConsole = useAdminConsole({
    initialAdminAiSearch,
    initialAdminIntegrations,
    isAdmin,
    search: normalizedSearch,
    updateSearch,
  })
  const {
    actionBusy,
    aiSearch,
    aiProviders,
    closeMcpcfRefresh,
    deleteAiSearchSource,
    error,
    executeSessionAction,
    executeWorkflowAction,
    exportAiSearchConfig,
    exportMcpcfConfig,
    exportLitellmConfig,
    loading,
    mcpcf,
    mcpcfRefresh,
    notice,
    refreshMcpcf,
    retryRun,
    runDetail,
    saveAiSearchSource,
    saveLitellmConfig,
    saveMcpcfConfig,
    selectWorkflowRun,
    sessionDetail,
    sessions,
    sessionTableState,
    sessionTotal,
    setSessionDetail,
    setRunDetail,
    syncLitellmModels,
    resetMcpcfConfig,
    resetLitellmConfig,
    view: activeView,
    viewSession,
    viewWorkflowRuns,
    workflows,
    workflowTableState,
    workflowTotal,
  } = adminConsole

  useEffect(() => {
    if (!error) {
      return
    }
    showErrorToast(error)
  }, [error])

  useEffect(() => {
    if (!notice) {
      return
    }
    appToastManager.add({
      title: notice,
      timeout: 5000,
    })
  }, [notice])

  useEffect(() => {
    const keepDocumentScrollPinned = () => {
      if (document.documentElement.scrollTop !== 0 || document.body.scrollTop !== 0) {
        resetAdminDocumentScroll()
      }
    }

    keepDocumentScrollPinned()
    window.addEventListener("scroll", keepDocumentScrollPinned)
    return () => {
      window.removeEventListener("scroll", keepDocumentScrollPinned)
    }
  }, [])

  if (authStatus === "loading") {
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-kumo-canvas">
        <C0Loader size={32} />
      </div>
    )
  }

  if (!isAdmin) {
    return <AdminDenied email={session?.user.email ?? "unknown account"} />
  }

  return (
    <div
      data-c0-admin-page
      className="flex h-full min-w-0 flex-col overflow-hidden bg-kumo-canvas text-kumo-default"
    >
      <PageHeader
        actions={
          activeView === "integrations" ? (
            <>
              {integrationHeaderActions}
              <IntegrationTabs
                tab={normalizedSearch.integrationTab}
                onChange={(integrationTab) => updateSearch({ integrationTab })}
              />
            </>
          ) : null
        }
      >
        <Breadcrumbs size="sm">
          <Breadcrumbs.Link href="/admin">Admin</Breadcrumbs.Link>
          <Breadcrumbs.Separator />
          <Breadcrumbs.Current>{getAdminViewTitle(activeView)}</Breadcrumbs.Current>
        </Breadcrumbs>
      </PageHeader>

      <main className="min-h-0 flex-1 overflow-auto">
        <section className="px-12 py-8">
          <div
            className={
              activeView === "integrations" || activeView === "ai-search"
                ? "w-full max-w-6xl"
                : "w-full"
            }
          >
            {activeView === "ai-search" ? (
              <AdminAiSearchPanel
                data={aiSearch}
                loading={loading}
                busy={actionBusy}
                onExport={exportAiSearchConfig}
                onSaveSource={saveAiSearchSource}
                onDeleteSource={deleteAiSearchSource}
              />
            ) : activeView === "integrations" ? (
              normalizedSearch.integrationTab === "skills" ? (
                <AdminAgentSkillsPanel onHeaderActionsChange={setIntegrationHeaderActions} />
              ) : normalizedSearch.integrationTab === "mcps" ? (
                <McpcfAdminPanel
                  data={mcpcf}
                  loading={loading}
                  busy={actionBusy}
                  onSave={saveMcpcfConfig}
                  onRefresh={() => void refreshMcpcf()}
                  onReset={resetMcpcfConfig}
                  onExport={exportMcpcfConfig}
                  onHeaderActionsChange={setIntegrationHeaderActions}
                />
              ) : (
                <AdminAiProviderPanel
                  data={aiProviders}
                  loading={loading}
                  busy={actionBusy}
                  onSave={saveLitellmConfig}
                  onSync={() => void syncLitellmModels()}
                  onReset={resetLitellmConfig}
                  onExport={exportLitellmConfig}
                  onHeaderActionsChange={setIntegrationHeaderActions}
                />
              )
            ) : activeView === "sessions" ? (
              <SessionsTable
                sessions={sessions}
                total={sessionTotal}
                state={sessionTableState}
                loading={loading}
                busy={actionBusy}
                onStateChange={(patch) =>
                  updateSearch((previous) => sessionSearchPatch(previous, patch))
                }
                onView={viewSession}
                onAction={executeSessionAction}
              />
            ) : (
              <WorkflowsTable
                workflows={workflows}
                total={workflowTotal}
                state={workflowTableState}
                loading={loading}
                busy={actionBusy}
                onStateChange={(patch) =>
                  updateSearch((previous) => workflowSearchPatch(previous, patch))
                }
                onViewRuns={viewWorkflowRuns}
                onAction={executeWorkflowAction}
              />
            )}
          </div>
        </section>
      </main>

      {sessionDetail ? (
        <SessionDetailDrawer detail={sessionDetail} onClose={() => setSessionDetail(null)} />
      ) : null}
      {runDetail ? (
        <RunDetailDrawer
          detail={runDetail}
          busy={actionBusy}
          onClose={() => setRunDetail(null)}
          onSelectRun={selectWorkflowRun}
          onRetry={retryRun}
        />
      ) : null}
      {mcpcfRefresh.open ? (
        <McpcfRefreshDialog state={mcpcfRefresh} onClose={closeMcpcfRefresh} />
      ) : null}
    </div>
  )
}

export function AdminDenied({ email }: { email: string }) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-kumo-canvas text-kumo-default">
      <PageHeader>
        <h1 className="truncate text-lg font-medium text-kumo-default">Admin</h1>
      </PageHeader>
      <div className="flex flex-1 items-center justify-center p-6">
        <Banner
          variant="error"
          title="Admin access denied"
          description={`${email} is not an admin.`}
          className="max-w-md"
        />
      </div>
    </div>
  )
}

export const ADMIN_VIEW_TABS: Array<{ value: AdminView; label: string }> = [
  { value: "sessions", label: "Agents" },
  { value: "workflows", label: "Workflows" },
  { value: "ai-search", label: "AI Search" },
  { value: "integrations", label: "Integrations" },
]

export function AdminViewTabs({
  view,
  onChange,
}: {
  view: AdminView
  onChange: (view: AdminView) => void
}) {
  return (
    <Tabs
      value={view}
      onValueChange={(value) => {
        if (isAdminView(value)) {
          onChange(value)
        }
      }}
      tabs={ADMIN_VIEW_TABS}
      variant="segmented"
    />
  )
}

export const INTEGRATION_TABS: Array<{
  value: AdminIntegrationTab
  label: string
}> = [
  { value: "ai-providers", label: "AI Providers" },
  { value: "mcps", label: "MCPs" },
  { value: "skills", label: "Skills" },
]

export function IntegrationTabs({
  tab,
  onChange,
}: {
  tab: AdminIntegrationTab
  onChange: (tab: AdminIntegrationTab) => void
}) {
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (value === "ai-providers" || value === "mcps" || value === "skills") {
          onChange(value)
        }
      }}
      tabs={INTEGRATION_TABS}
      variant="segmented"
    />
  )
}

export function isAdminView(value: string): value is AdminView {
  return (
    value === "sessions" ||
    value === "workflows" ||
    value === "ai-search" ||
    value === "integrations"
  )
}

export function getAdminViewTitle(view: AdminView): string {
  switch (view) {
    case "sessions":
      return "Agents"
    case "workflows":
      return "Workflows"
    case "ai-search":
      return "AI Search"
    case "integrations":
      return "Integrations"
  }
}
