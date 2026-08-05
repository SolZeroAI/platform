"use client"

import type {
  AdminAiProvidersResponse,
  AdminAiSearchExportResponse,
  AdminAiSearchResponse,
  AdminAiSearchSourcePayload,
  AdminLitellmConfigPayload,
  AdminLitellmExportResponse,
  AdminLitellmSyncResponse,
  AdminMcpcfConfigPayload,
  AdminMcpcfExportResponse,
  AdminMcpcfRefreshResponse,
  AdminMcpcfResponse,
  AdminSessionDetailResponse,
  AdminSessionListResponse,
  AdminSessionRecord,
  AdminWorkflowListResponse,
  AdminWorkflowRecord,
  AdminWorkflowRunEvent,
  AdminWorkflowRunEventsResponse,
  AdminWorkflowRunRecord,
  AdminWorkflowRunsResponse,
} from "@solzero/api"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { McpcfRefreshState } from "@/components/admin-mcpcf-panel"
import {
  delay,
  getErrorMessage,
  requestJson,
  retryWorkflowRun,
  runSessionAction,
  runWorkflowAction,
} from "@/lib/admin-console-actions"
import {
  sessionQueryParams,
  workflowQueryParams,
  type AdminConsoleSearchUpdater,
  type AdminSearch,
} from "./admin-console-search"

export {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  SESSION_RUNTIME_OPTIONS,
  SESSION_SOURCE_OPTIONS,
  SESSION_STATUS_OPTIONS,
  WORKFLOW_STATUS_OPTIONS,
  adminPathForView,
  adminViewFromPath,
  canonicalAdminSearchForView,
  compactAdminSearch,
  isCanonicalAdminSearch,
  normalizeAdminSearch,
  sessionSearchPatch,
  sessionStateFromSearch,
  workflowSearchPatch,
  workflowStateFromSearch,
} from "./admin-console-search"
export type {
  AdminConsoleSearchUpdate,
  AdminConsoleSearchUpdater,
  AdminIntegrationTab,
  AdminRoutePath,
  AdminRouteSearch,
  AdminSearch,
  AdminView,
  SessionTableState,
  SortDir,
  WorkflowTableState,
} from "./admin-console-search"

export interface WorkflowRunDetail {
  workflow: AdminWorkflowRecord
  runs: readonly AdminWorkflowRunRecord[]
  selectedRunId: string | null
  events: readonly AdminWorkflowRunEvent[]
}

export interface AdminIntegrationsInitialData {
  aiProviders: AdminAiProvidersResponse | null
  mcpcf: AdminMcpcfResponse | null
  error: string
}

export interface AdminAiSearchInitialData {
  aiSearch: AdminAiSearchResponse | null
  error: string
}

export function useAdminConsole({
  initialAdminAiSearch = null,
  initialAdminIntegrations = null,
  isAdmin,
  search,
  updateSearch,
}: {
  initialAdminAiSearch?: AdminAiSearchInitialData | null
  initialAdminIntegrations?: AdminIntegrationsInitialData | null
  isAdmin: boolean
  search: AdminSearch
  updateSearch: AdminConsoleSearchUpdater
}) {
  const view = search.view
  const {
    sessionsKind,
    sessionsPage,
    sessionsPageSize,
    sessionsQ,
    sessionsRepoName,
    sessionsRepoOwner,
    sessionsSortBy,
    sessionsSortDir,
    sessionsSource,
    sessionsStatus,
    sessionsUserId,
    workflowsPage,
    workflowsPageSize,
    workflowsQ,
    workflowsSortBy,
    workflowsSortDir,
    workflowsStatus,
    workflowsUserId,
  } = search
  const [sessions, setSessions] = useState<readonly AdminSessionRecord[]>([])
  const [workflows, setWorkflows] = useState<readonly AdminWorkflowRecord[]>([])
  const [mcpcf, setMcpcf] = useState<AdminMcpcfResponse | null>(
    initialAdminIntegrations?.mcpcf ?? null,
  )
  const [aiProviders, setAiProviders] = useState<AdminAiProvidersResponse | null>(
    initialAdminIntegrations?.aiProviders ?? null,
  )
  const [aiSearch, setAiSearch] = useState<AdminAiSearchResponse | null>(
    initialAdminAiSearch?.aiSearch ?? null,
  )
  const [sessionTotal, setSessionTotal] = useState(0)
  const [workflowTotal, setWorkflowTotal] = useState(0)
  const [sessionDetail, setSessionDetail] = useState<AdminSessionDetailResponse | null>(null)
  const [runDetail, setRunDetail] = useState<WorkflowRunDetail | null>(null)
  const [loading, setLoading] = useState(
    !(
      (view === "integrations" && initialAdminIntegrations !== null) ||
      (view === "ai-search" && initialAdminAiSearch !== null)
    ),
  )
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [error, setError] = useState(
    initialAdminAiSearch?.error ?? initialAdminIntegrations?.error ?? "",
  )
  const [notice, setNotice] = useState("")
  const [mcpcfRefresh, setMcpcfRefresh] = useState<McpcfRefreshState>({
    open: false,
    phase: "validating",
    result: null,
    error: "",
  })

  const sessionTableState = useMemo(
    () => ({
      q: sessionsQ ?? "",
      status: sessionsStatus ?? "",
      kind: sessionsKind ?? "",
      source: sessionsSource ?? "",
      userId: sessionsUserId ?? "",
      repoOwner: sessionsRepoOwner ?? "",
      repoName: sessionsRepoName ?? "",
      sortBy: sessionsSortBy,
      sortDir: sessionsSortDir,
      pageIndex: sessionsPage - 1,
      pageSize: sessionsPageSize,
    }),
    [
      sessionsKind,
      sessionsPage,
      sessionsPageSize,
      sessionsQ,
      sessionsRepoName,
      sessionsRepoOwner,
      sessionsSortBy,
      sessionsSortDir,
      sessionsSource,
      sessionsStatus,
      sessionsUserId,
    ],
  )
  const workflowTableState = useMemo(
    () => ({
      q: workflowsQ ?? "",
      status: workflowsStatus ?? "",
      userId: workflowsUserId ?? "",
      sortBy: workflowsSortBy,
      sortDir: workflowsSortDir,
      pageIndex: workflowsPage - 1,
      pageSize: workflowsPageSize,
    }),
    [
      workflowsPage,
      workflowsPageSize,
      workflowsQ,
      workflowsSortBy,
      workflowsSortDir,
      workflowsStatus,
      workflowsUserId,
    ],
  )
  const fetchSequenceRef = useRef(0)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!isAdmin) {
        setLoading(false)
        return
      }
      const sequence = fetchSequenceRef.current + 1
      fetchSequenceRef.current = sequence
      setLoading(true)
      setError("")
      try {
        const sessionParams = sessionQueryParams(sessionTableState)
        const workflowParams = workflowQueryParams(workflowTableState)
        const [sessionData, workflowData, aiSearchData, mcpcfData, aiProvidersData] =
          await Promise.all([
            view === "sessions"
              ? requestJson<AdminSessionListResponse>(
                  `/api/admin/sessions?${sessionParams.toString()}`,
                  { signal },
                )
              : Promise.resolve(null),
            view === "workflows"
              ? requestJson<AdminWorkflowListResponse>(
                  `/api/admin/workflows?${workflowParams.toString()}`,
                  { signal },
                )
              : Promise.resolve(null),
            view === "ai-search"
              ? requestJson<AdminAiSearchResponse>("/api/admin/ai-search", { signal })
              : Promise.resolve(null),
            view === "integrations"
              ? requestJson<AdminMcpcfResponse>("/api/admin/mcpcf", { signal })
              : Promise.resolve(null),
            view === "integrations"
              ? requestJson<AdminAiProvidersResponse>("/api/admin/ai-providers", { signal })
              : Promise.resolve(null),
          ])
        if (fetchSequenceRef.current !== sequence) {
          return
        }
        if (sessionData) {
          setSessions(sessionData.sessions)
          setSessionTotal(sessionData.total)
        }
        if (workflowData) {
          setWorkflows(workflowData.workflows)
          setWorkflowTotal(workflowData.total)
        }
        if (aiSearchData) {
          setAiSearch(aiSearchData)
        }
        if (mcpcfData) {
          setMcpcf(mcpcfData)
        }
        if (aiProvidersData) {
          setAiProviders(aiProvidersData)
        }
      } catch (errorValue) {
        if (errorValue instanceof Error && errorValue.name === "AbortError") {
          return
        }
        setError(getErrorMessage(errorValue))
      } finally {
        if (fetchSequenceRef.current === sequence) {
          setLoading(false)
        }
      }
    },
    [isAdmin, sessionTableState, view, workflowTableState],
  )

  useEffect(() => {
    if (view !== "integrations" || initialAdminIntegrations === null) {
      return
    }
    setMcpcf(initialAdminIntegrations.mcpcf)
    setAiProviders(initialAdminIntegrations.aiProviders)
    setError(initialAdminIntegrations.error)
    setLoading(false)
  }, [initialAdminIntegrations, view])

  useEffect(() => {
    if (view !== "ai-search" || initialAdminAiSearch === null) {
      return
    }
    setAiSearch(initialAdminAiSearch.aiSearch)
    setError(initialAdminAiSearch.error)
    setLoading(false)
  }, [initialAdminAiSearch, view])

  useEffect(() => {
    if (view === "ai-search" && initialAdminAiSearch !== null) {
      return
    }
    if (view === "integrations" && initialAdminIntegrations !== null) {
      return
    }
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      void load(controller.signal)
    }, 200)
    return () => {
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [initialAdminAiSearch, initialAdminIntegrations, load, view])

  useEffect(() => {
    if (!isAdmin || view !== "workflows") {
      return
    }
    const hasActiveRuns = workflows.some(
      (workflow) =>
        workflow.latestRun?.status === "queued" || workflow.latestRun?.status === "running",
    )
    if (!hasActiveRuns) {
      return
    }
    const interval = setInterval(() => {
      void load()
    }, 7_500)
    return () => clearInterval(interval)
  }, [isAdmin, load, view, workflows])

  const runAction = useCallback(
    async (key: string, action: () => Promise<void>): Promise<boolean> => {
      setActionBusy(key)
      setError("")
      setNotice("")
      try {
        await action()
        await load()
        return true
      } catch (errorValue) {
        setError(getErrorMessage(errorValue))
        return false
      } finally {
        setActionBusy(null)
      }
    },
    [load],
  )

  const saveMcpcfConfig = useCallback(
    async (payload: AdminMcpcfConfigPayload) => {
      return await runAction("mcpcf-save", async () => {
        const next = await requestJson<AdminMcpcfResponse>("/api/admin/mcpcf/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        setMcpcf(next)
        setNotice("MCP Context Forge configuration saved.")
      })
    },
    [runAction],
  )

  const saveLitellmConfig = useCallback(
    async (payload: AdminLitellmConfigPayload) => {
      return await runAction("litellm-save", async () => {
        const next = await requestJson<AdminAiProvidersResponse>(
          "/api/admin/ai-providers/litellm",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        )
        setAiProviders(next)
        setNotice("LiteLLM configuration saved.")
      })
    },
    [runAction],
  )

  const saveAiSearchSource = useCallback(
    async (payload: AdminAiSearchSourcePayload, mode: "create" | "update") => {
      return await runAction(`ai-search-source-${mode}-${payload.id}`, async () => {
        const endpoint =
          mode === "create"
            ? "/api/admin/ai-search/sources"
            : `/api/admin/ai-search/sources/${encodeURIComponent(payload.id)}`
        const next = await requestJson<AdminAiSearchResponse>(endpoint, {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        setAiSearch(next)
        setNotice(`AI Search source ${mode === "create" ? "created" : "saved"}.`)
      })
    },
    [runAction],
  )

  const deleteAiSearchSource = useCallback(
    async (sourceId: string) => {
      return await runAction(`ai-search-source-delete-${sourceId}`, async () => {
        const next = await requestJson<AdminAiSearchResponse>(
          `/api/admin/ai-search/sources/${encodeURIComponent(sourceId)}`,
          { method: "DELETE" },
        )
        setAiSearch(next)
        setNotice("AI Search source deleted.")
      })
    },
    [runAction],
  )

  const exportAiSearchConfig = useCallback(async () => {
    setActionBusy("ai-search-export")
    setError("")
    setNotice("")
    try {
      const result = await requestJson<AdminAiSearchExportResponse>("/api/admin/ai-search/export", {
        method: "POST",
      })
      return result.dotenv
    } catch (errorValue) {
      setError(getErrorMessage(errorValue))
      return null
    } finally {
      setActionBusy(null)
    }
  }, [])

  const syncLitellmModels = useCallback(async () => {
    return await runAction("litellm-sync", async () => {
      const result = await requestJson<AdminLitellmSyncResponse>(
        "/api/admin/ai-providers/litellm/sync",
        { method: "POST" },
      )
      setAiProviders(await requestJson<AdminAiProvidersResponse>("/api/admin/ai-providers"))
      if (result.status === "failure") {
        return
      }
      if (result.status === "skipped") {
        setNotice(`LiteLLM sync skipped: ${result.reason ?? "disabled"}`)
        return
      }
      setNotice(`LiteLLM model registry refreshed (${result.models} models).`)
    })
  }, [runAction])

  const resetLitellmConfig = useCallback(async () => {
    return await runAction("litellm-reset", async () => {
      const next = await requestJson<AdminAiProvidersResponse>("/api/admin/ai-providers/litellm", {
        method: "DELETE",
      })
      setAiProviders(next)
      setNotice("LiteLLM KV configuration reset.")
    })
  }, [runAction])

  const exportLitellmConfig = useCallback(async () => {
    setActionBusy("litellm-export")
    setError("")
    setNotice("")
    try {
      const result = await requestJson<AdminLitellmExportResponse>(
        "/api/admin/ai-providers/litellm/export",
        { method: "POST" },
      )
      if (result.variableCount === 0) {
        setNotice("No LiteLLM KV configuration values to export.")
      }
      return result.dotenv
    } catch (errorValue) {
      setError(getErrorMessage(errorValue))
      return null
    } finally {
      setActionBusy(null)
    }
  }, [])

  const resetMcpcfConfig = useCallback(async () => {
    return await runAction("mcpcf-reset", async () => {
      const next = await requestJson<AdminMcpcfResponse>("/api/admin/mcpcf/config", {
        method: "DELETE",
      })
      setMcpcf(next)
      setNotice("MCP Context Forge KV configuration reset.")
    })
  }, [runAction])

  const exportMcpcfConfig = useCallback(async () => {
    setActionBusy("mcpcf-export")
    setError("")
    setNotice("")
    try {
      const result = await requestJson<AdminMcpcfExportResponse>("/api/admin/mcpcf/config/export", {
        method: "POST",
      })
      if (result.variableCount === 0) {
        setNotice("No MCP Context Forge KV configuration values to export.")
      }
      return result.dotenv
    } catch (errorValue) {
      setError(getErrorMessage(errorValue))
      return null
    } finally {
      setActionBusy(null)
    }
  }, [])

  const refreshMcpcf = useCallback(async () => {
    setMcpcfRefresh({ open: true, phase: "validating", result: null, error: "" })
    setActionBusy("mcpcf-refresh")
    setError("")
    setNotice("")
    try {
      await delay(150)
      setMcpcfRefresh({ open: true, phase: "fetching", result: null, error: "" })
      const result = await requestJson<AdminMcpcfRefreshResponse>("/api/admin/mcpcf/refresh", {
        method: "POST",
      })
      setMcpcfRefresh({ open: true, phase: "applying", result, error: "" })
      setMcpcf(await requestJson<AdminMcpcfResponse>("/api/admin/mcpcf"))
      setMcpcfRefresh({ open: true, phase: "complete", result, error: "" })
      setNotice("MCP Context Forge registry refreshed.")
    } catch (errorValue) {
      const message = getErrorMessage(errorValue)
      setMcpcfRefresh({ open: true, phase: "failed", result: null, error: message })
      setError(message)
    } finally {
      setActionBusy(null)
    }
  }, [])

  const viewSession = useCallback(
    (id: string) =>
      void runAction(`session-view-${id}`, async () => {
        setSessionDetail(await requestJson<AdminSessionDetailResponse>(`/api/admin/sessions/${id}`))
      }),
    [runAction],
  )

  const executeSessionAction = useCallback(
    (id: string, action: "stop" | "archive" | "unarchive" | "delete") =>
      void runAction(`session-${action}-${id}`, async () => {
        await runSessionAction(id, action)
        if (sessionDetail?.session.id === id) {
          setSessionDetail(
            await requestJson<AdminSessionDetailResponse>(`/api/admin/sessions/${id}`),
          )
        }
      }),
    [runAction, sessionDetail],
  )

  const viewWorkflowRuns = useCallback(
    (workflow: AdminWorkflowRecord) =>
      void runAction(`workflow-runs-${workflow.id}`, async () => {
        const runs = await requestJson<AdminWorkflowRunsResponse>(
          `/api/admin/workflows/${workflow.id}/runs`,
        )
        const selectedRunId = runs.runs[0]?.id ?? null
        const events = selectedRunId
          ? await requestJson<AdminWorkflowRunEventsResponse>(
              `/api/admin/workflows/${workflow.id}/runs/${selectedRunId}/events`,
            )
          : { events: [] }
        setRunDetail({
          workflow,
          runs: runs.runs,
          selectedRunId,
          events: events.events,
        })
      }),
    [runAction],
  )

  const executeWorkflowAction = useCallback(
    (workflow: AdminWorkflowRecord, action: "run" | "archive" | "unarchive") =>
      void runAction(`workflow-${action}-${workflow.id}`, async () => {
        await runWorkflowAction(workflow, action)
        if (runDetail?.workflow.id === workflow.id) {
          const runs = await requestJson<AdminWorkflowRunsResponse>(
            `/api/admin/workflows/${workflow.id}/runs`,
          )
          setRunDetail({ ...runDetail, runs: runs.runs })
        }
      }),
    [runAction, runDetail],
  )

  const selectWorkflowRun = useCallback(
    (runId: string) =>
      void runAction(`run-events-${runId}`, async () => {
        if (!runDetail) {
          return
        }
        const events = await requestJson<AdminWorkflowRunEventsResponse>(
          `/api/admin/workflows/${runDetail.workflow.id}/runs/${runId}/events`,
        )
        setRunDetail({ ...runDetail, selectedRunId: runId, events: events.events })
      }),
    [runAction, runDetail],
  )

  const retryRun = useCallback(
    (runId: string) =>
      void runAction(`workflow-retry-${runId}`, async () => {
        if (!runDetail) {
          return
        }
        await retryWorkflowRun(runDetail.workflow.id, runId)
        const runs = await requestJson<AdminWorkflowRunsResponse>(
          `/api/admin/workflows/${runDetail.workflow.id}/runs`,
        )
        setRunDetail({ ...runDetail, runs: runs.runs })
        await load()
      }),
    [load, runAction, runDetail],
  )

  const closeMcpcfRefresh = useCallback(() => {
    setMcpcfRefresh({ open: false, phase: "validating", result: null, error: "" })
  }, [])

  return {
    view,
    aiSearch,
    aiProviders,
    sessions,
    workflows,
    mcpcf,
    sessionTotal,
    workflowTotal,
    sessionDetail,
    runDetail,
    loading,
    actionBusy,
    error,
    notice,
    mcpcfRefresh,
    sessionTableState,
    workflowTableState,
    updateSearch,
    saveLitellmConfig,
    syncLitellmModels,
    resetLitellmConfig,
    exportLitellmConfig,
    resetMcpcfConfig,
    exportMcpcfConfig,
    saveAiSearchSource,
    deleteAiSearchSource,
    exportAiSearchConfig,
    saveMcpcfConfig,
    refreshMcpcf,
    viewSession,
    executeSessionAction,
    viewWorkflowRuns,
    executeWorkflowAction,
    selectWorkflowRun,
    retryRun,
    setSessionDetail,
    setRunDetail,
    closeMcpcfRefresh,
  }
}
