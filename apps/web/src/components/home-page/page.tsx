import { useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  DEFAULT_ISOLATE_STEP_LIMIT,
  DEFAULT_SUBAGENT_MODE,
  getDefaultSessionCustomMcpServers,
  getGitHubRepoTool,
  isAgentRuntimeCompatibleWithProvider,
  normalizeSessionTools,
  sessionKindForAgentRuntime,
  type AgentRuntime,
  type OpenCodeMcpServers,
  parseSessionToolsFromSearchParams,
  type ProviderSettingsResponse,
  type SessionToolSpec,
  type SubagentMode,
  stringifyOpenCodeMcpServers,
  stringifySessionTools,
} from "@c0-agent/shared"
import { C0Loader } from "@/components/c0-loader"
import { type RepoQueryState } from "@/components/home-session-tools-dialog"
import { SidebarLayout } from "@/components/sidebar-layout"
import { useProviderSettings } from "@/hooks/use-provider-settings"
import { useAuthSession } from "@/lib/auth-client"
import { stashSessionPromptError } from "@/lib/session-prompt"
import { HomeContentWithSidebar } from "./content"
import { getDefaultVisibleModel } from "./model-selection"
import { getErrorMessage } from "./session-kind"

export interface Repo {
  id: number
  fullName: string
  owner: string
  name: string
  description: string | null
  private: boolean
}

export interface RepoPagination {
  page: number
  perPage: number
  totalCount: number | null
  hasMore: boolean
}

export const INITIAL_REPO_QUERY: RepoQueryState = {
  q: "",
  owner: "all",
  visibility: "all",
  sort: "best-match",
  order: "desc",
  page: 1,
  perPage: 10,
}

export const AGENT_RUNTIME_TOOLBAR_CLASS_NAME = "home-toolbar-accent-blue"

export const REPOSITORY_TOOLBAR_CLASS_NAME = "home-toolbar-accent-green"

export const SECRETS_TOOLBAR_CLASS_NAME = "home-toolbar-accent-amber"

export function HomePage({
  initialProviderSettings = null,
}: {
  initialProviderSettings?: ProviderSettingsResponse | null
}) {
  const { data: session, status } = useAuthSession()
  const isAdmin = session?.isAdmin === true
  const navigate = useNavigate({ from: "/" })
  const {
    catalog: providerCatalog,
    settings: providerSettings,
    error: providerError,
    loading: providerLoading,
  } = useProviderSettings({ initialData: initialProviderSettings })
  const [repos, setRepos] = useState<Repo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [repoLoadError, setRepoLoadError] = useState("")
  const [needsGitHubLink, setNeedsGitHubLink] = useState(false)
  const [githubAppInstallUrl, setGithubAppInstallUrl] = useState<string | null>(null)
  const [repoQuery, setRepoQuery] = useState<RepoQueryState>(INITIAL_REPO_QUERY)
  const [repoPagination, setRepoPagination] = useState<RepoPagination | null>(null)
  const [selectedTools, setSelectedTools] = useState<SessionToolSpec[]>([])
  const [selectedSecretKeys, setSelectedSecretKeys] = useState<string[]>([])
  const [selectedCustomMcpServers, setSelectedCustomMcpServers] = useState<OpenCodeMcpServers>(() =>
    getDefaultSessionCustomMcpServers(),
  )
  const [selectedIsolateStepLimit, setSelectedIsolateStepLimit] = useState(
    DEFAULT_ISOLATE_STEP_LIMIT,
  )
  const [selectedSubagents, setSelectedSubagents] = useState<SubagentMode>(DEFAULT_SUBAGENT_MODE)
  const [selectedAgentRuntime, setSelectedAgentRuntime] = useState<AgentRuntime>("isolate")
  const [selectedModel, setSelectedModel] = useState(() => getDefaultVisibleModel(providerCatalog))
  const [reasoningEffort, setReasoningEffort] = useState<string | undefined>(undefined)
  const [prompt, setPrompt] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState("")
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null)
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const selectedModelSourceRef = useRef<"default" | "manual">("default")
  const previousReasoningModelRef = useRef<string | null>(null)
  const sessionCreationPromise = useRef<Promise<string | null> | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const pendingConfigRef = useRef<{
    toolsKey: string
    customMcpKey: string
    secretKeysKey: string
    stepLimit: number
    subagents: SubagentMode
    model: string
    agentRuntime: AgentRuntime
  } | null>(null)
  const rawModelOptions = useMemo(
    () => providerCatalog?.modelOptions ?? [],
    [providerCatalog?.modelOptions],
  )
  const modelOptions = useMemo(
    () =>
      rawModelOptions
        .map((group) => ({
          ...group,
          models: group.models.filter((model) =>
            isAgentRuntimeCompatibleWithProvider(selectedAgentRuntime, model.providerId),
          ),
        }))
        .filter((group) => group.models.length > 0),
    [rawModelOptions, selectedAgentRuntime],
  )
  const providerDefaultModelConfigured = Boolean(providerCatalog?.defaultModel)
  const allModels = useMemo(() => modelOptions.flatMap((group) => group.models), [modelOptions])
  const defaultIsolateStepLimit =
    providerSettings?.defaultIsolateStepLimit ?? DEFAULT_ISOLATE_STEP_LIMIT
  const selectedToolsKey = useMemo(() => stringifySessionTools(selectedTools), [selectedTools])
  const selectedCustomMcpKey = useMemo(
    () => stringifyOpenCodeMcpServers(selectedCustomMcpServers),
    [selectedCustomMcpServers],
  )
  const selectedSecretKeysKey = useMemo(
    () => JSON.stringify([...selectedSecretKeys].sort()),
    [selectedSecretKeys],
  )
  const selectedRepoTool = useMemo(() => getGitHubRepoTool(selectedTools), [selectedTools])
  const selectedModelOption = useMemo(
    () => allModels.find((model) => model.id === selectedModel) ?? null,
    [allModels, selectedModel],
  )

  const fetchRepos = useCallback(
    async (options: { query?: RepoQueryState } = {}) => {
      const activeQuery = options.query ?? repoQuery
      const params = new URLSearchParams({
        page: String(activeQuery.page),
        perPage: String(activeQuery.perPage),
      })
      const trimmedQuery = activeQuery.q.trim()
      if (trimmedQuery) {
        params.set("q", trimmedQuery)
      }
      if (activeQuery.owner !== "all") {
        params.set("owner", activeQuery.owner)
      }
      if (activeQuery.visibility !== "all") {
        params.set("visibility", activeQuery.visibility)
      }
      if (activeQuery.sort !== "best-match") {
        params.set("sort", activeQuery.sort)
        params.set("order", activeQuery.order)
      }
      setLoadingRepos(true)
      setRepoLoadError("")
      setNeedsGitHubLink(false)
      try {
        const res = await fetch(`/api/repos?${params.toString()}`)
        const data = (await res.json().catch(() => ({}))) as {
          repos?: Repo[]
          pagination?: RepoPagination
          error?: string
          githubAppInstallUrl?: string | null
        }
        if (!res.ok) {
          if (res.status === 403) {
            setNeedsGitHubLink(true)
            setRepos([])
            return
          }
          throw new Error(data.error ?? `Request failed with status ${res.status}`)
        }
        const repoList = Array.isArray(data.repos) ? data.repos : []
        setRepos(repoList)
        setRepoPagination(data.pagination ?? null)
        setGithubAppInstallUrl(data.githubAppInstallUrl ?? null)
      } catch (errorValue) {
        setRepoLoadError(getErrorMessage(errorValue))
      } finally {
        setLoadingRepos(false)
      }
    },
    [repoQuery],
  )

  useEffect(() => {
    if (session?.user.id) {
      const timeoutId = setTimeout(() => {
        void fetchRepos({ query: repoQuery })
      }, 250)
      return () => clearTimeout(timeoutId)
    }
    return undefined
  }, [session?.user.id, repoQuery, fetchRepos])

  const updateRepoQuery = useCallback((patch: Partial<RepoQueryState>) => {
    setRepoQuery((current) => ({
      ...current,
      ...patch,
      page: patch.page ?? current.page,
    }))
  }, [])

  useEffect(() => {
    try {
      const queryTools = parseSessionToolsFromSearchParams(
        new URLSearchParams(window.location.search),
      )
      if (queryTools.length > 0) {
        setSelectedTools((current) => normalizeSessionTools([...current, ...queryTools]))
      }
    } catch (errorValue) {
      setError(`Invalid session tool query params: ${getErrorMessage(errorValue)}`)
    }
  }, [])

  useEffect(() => {
    if (!providerCatalog) {
      return
    }

    const visibleModelIds = new Set(allModels.map((model) => model.id))
    const defaultModel = providerCatalog.defaultModel ?? ""
    setSelectedModel((current) => {
      const currentIsVisible = Boolean(current && visibleModelIds.has(current))
      const defaultIsVisible = Boolean(defaultModel && visibleModelIds.has(defaultModel))

      const fallbackModel = defaultIsVisible ? defaultModel : ""
      if (!currentIsVisible) {
        selectedModelSourceRef.current = "default"
        return fallbackModel
      }

      if (selectedModelSourceRef.current === "default") {
        return fallbackModel
      }

      return current
    })
  }, [providerCatalog, allModels])

  useEffect(() => {
    const previousModel = previousReasoningModelRef.current
    previousReasoningModelRef.current = selectedModel
    const selectedModelChanged = previousModel !== selectedModel

    if (!selectedModelOption?.reasoning) {
      setReasoningEffort(undefined)
      return
    }

    const reasoning = selectedModelOption.reasoning

    setReasoningEffort((current) =>
      selectedModelChanged && selectedModelSourceRef.current === "default"
        ? reasoning.default
        : current && reasoning.efforts.some((effort) => effort === current)
          ? current
          : reasoning.default,
    )
  }, [selectedModel, selectedModelOption])

  useEffect(() => {
    setSelectedIsolateStepLimit((current) =>
      current === DEFAULT_ISOLATE_STEP_LIMIT ? defaultIsolateStepLimit : current,
    )
  }, [defaultIsolateStepLimit])

  useEffect(() => {
    const currentConfig = {
      toolsKey: selectedToolsKey,
      customMcpKey: selectedCustomMcpKey,
      secretKeysKey: selectedSecretKeysKey,
      stepLimit: selectedIsolateStepLimit,
      subagents: selectedSubagents,
      model: selectedModel,
      agentRuntime: selectedAgentRuntime,
    }
    if (
      pendingConfigRef.current?.toolsKey === currentConfig.toolsKey &&
      pendingConfigRef.current?.customMcpKey === currentConfig.customMcpKey &&
      pendingConfigRef.current?.secretKeysKey === currentConfig.secretKeysKey &&
      pendingConfigRef.current?.stepLimit === currentConfig.stepLimit &&
      pendingConfigRef.current?.subagents === currentConfig.subagents &&
      pendingConfigRef.current?.model === currentConfig.model &&
      pendingConfigRef.current?.agentRuntime === currentConfig.agentRuntime
    ) {
      return
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setPendingSessionId(null)
    setIsCreatingSession(false)
    sessionCreationPromise.current = null
    pendingConfigRef.current = null
  }, [
    selectedCustomMcpKey,
    selectedSecretKeysKey,
    selectedIsolateStepLimit,
    selectedSubagents,
    selectedAgentRuntime,
    selectedModel,
    selectedToolsKey,
  ])

  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setPendingSessionId(null)
    setIsCreatingSession(false)
    sessionCreationPromise.current = null
    pendingConfigRef.current = null
  }, [])

  const createSessionForWarming = useCallback(async () => {
    if (pendingSessionId) {
      return pendingSessionId
    }
    if (sessionCreationPromise.current) {
      return sessionCreationPromise.current
    }
    if (!selectedModel) {
      return null
    }

    setIsCreatingSession(true)
    const currentConfig = {
      toolsKey: selectedToolsKey,
      customMcpKey: selectedCustomMcpKey,
      secretKeysKey: selectedSecretKeysKey,
      stepLimit: selectedIsolateStepLimit,
      subagents: selectedSubagents,
      model: selectedModel,
      agentRuntime: selectedAgentRuntime,
    }
    pendingConfigRef.current = currentConfig

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    const promise = (async () => {
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentRuntime: selectedAgentRuntime,
            sessionKind: sessionKindForAgentRuntime(selectedAgentRuntime),
            ...(selectedRepoTool
              ? {
                  repoOwner: selectedRepoTool.repoOwner,
                  repoName: selectedRepoTool.repoName,
                }
              : {}),
            tools: selectedTools,
            customMcpServers: selectedCustomMcpServers,
            secretKeys: selectedSecretKeys,
            isolateStepLimit: selectedIsolateStepLimit,
            ...(selectedAgentRuntime === "isolate" ? { subagents: selectedSubagents } : {}),
            model: selectedModel,
            reasoningEffort,
          }),
          signal: abortController.signal,
        })

        if (res.ok) {
          const data = await res.json()
          if (
            pendingConfigRef.current?.toolsKey === currentConfig.toolsKey &&
            pendingConfigRef.current?.customMcpKey === currentConfig.customMcpKey &&
            pendingConfigRef.current?.secretKeysKey === currentConfig.secretKeysKey &&
            pendingConfigRef.current?.stepLimit === currentConfig.stepLimit &&
            pendingConfigRef.current?.subagents === currentConfig.subagents &&
            pendingConfigRef.current?.model === currentConfig.model &&
            pendingConfigRef.current?.agentRuntime === currentConfig.agentRuntime
          ) {
            setPendingSessionId(data.sessionId)
            return data.sessionId as string
          }
          return null
        }
        return null
      } catch (errorValue) {
        if (errorValue instanceof Error && errorValue.name === "AbortError") {
          return null
        }
        console.error("Failed to create agent for warming:", errorValue)
        return null
      } finally {
        if (abortControllerRef.current === abortController) {
          setIsCreatingSession(false)
          sessionCreationPromise.current = null
          abortControllerRef.current = null
        }
      }
    })()

    sessionCreationPromise.current = promise
    return promise
  }, [
    pendingSessionId,
    reasoningEffort,
    selectedCustomMcpKey,
    selectedCustomMcpServers,
    selectedSecretKeys,
    selectedSecretKeysKey,
    selectedIsolateStepLimit,
    selectedSubagents,
    selectedAgentRuntime,
    selectedModel,
    selectedRepoTool,
    selectedTools,
    selectedToolsKey,
  ])

  const handleModelChange = useCallback(
    (model: string) => {
      selectedModelSourceRef.current = "manual"
      setSelectedModel(model)
      const nextModel = allModels.find((item) => item.id === model)
      setReasoningEffort(nextModel?.reasoning?.default)
    },
    [allModels],
  )

  const handlePromptChange = (value: string) => {
    const wasEmpty = prompt.length === 0
    setPrompt(value)
    if (wasEmpty && value.length > 0 && !pendingSessionId && !isCreatingSession) {
      createSessionForWarming()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim()) {
      return
    }
    if (modelOptions.length === 0) {
      setError("An admin needs to set up an AI Provider before agents can run.")
      return
    }
    if (!selectedModel) {
      setError("Choose a model before starting an agent.")
      return
    }

    setError("")

    try {
      let sessionId = pendingSessionId
      if (!sessionId) {
        setCreating(true)
        sessionId = await createSessionForWarming()
        setCreating(false)
      }

      if (!sessionId) {
        setError("Failed to create agent")
        setCreating(false)
        return
      }

      void (async () => {
        try {
          const res = await fetch(`/api/sessions/${sessionId}/prompt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: prompt,
              model: selectedModel,
              reasoningEffort,
            }),
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            const message =
              data && typeof data === "object" && "error" in data && typeof data.error === "string"
                ? data.error
                : "Failed to send prompt"
            stashSessionPromptError(sessionId, message)
          }
        } catch {
          stashSessionPromptError(sessionId, "Failed to send prompt")
        }
      })()

      void navigate({
        to: "/session/$id",
        params: { id: sessionId },
        search: { boot: "1" },
      })
    } catch {
      setError("Failed to create agent")
      setCreating(false)
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <C0Loader size={32} />
      </div>
    )
  }

  return (
    <SidebarLayout>
      <HomeContentWithSidebar
        isAuthenticated={!!session}
        isAdmin={isAdmin}
        repos={repos}
        repoQuery={repoQuery}
        repoPagination={repoPagination}
        loadingRepos={loadingRepos}
        repoLoadError={repoLoadError}
        needsGitHubLink={needsGitHubLink}
        githubAppInstallUrl={githubAppInstallUrl}
        updateRepoQuery={updateRepoQuery}
        selectedTools={selectedTools}
        selectedSecretKeys={selectedSecretKeys}
        selectedCustomMcpServers={selectedCustomMcpServers}
        setSelectedToolState={(value) => {
          setSelectedTools(value.tools)
          setSelectedSecretKeys(value.secretKeys ?? selectedSecretKeys)
          setSelectedCustomMcpServers(value.customMcpServers)
          setSelectedIsolateStepLimit(value.isolateStepLimit)
          setSelectedSubagents(value.subagents)
        }}
        selectedIsolateStepLimit={selectedIsolateStepLimit}
        selectedSubagents={selectedSubagents}
        selectedModel={selectedModel}
        setSelectedModel={handleModelChange}
        selectedModelOption={selectedModelOption}
        modelOptions={modelOptions}
        providerCatalogLoaded={!!providerCatalog}
        providerCatalogLoading={providerLoading}
        providerDefaultModelConfigured={providerDefaultModelConfigured}
        selectedAgentRuntime={selectedAgentRuntime}
        setSelectedAgentRuntime={setSelectedAgentRuntime}
        reasoningEffort={reasoningEffort}
        setReasoningEffort={setReasoningEffort}
        prompt={prompt}
        handlePromptChange={handlePromptChange}
        creating={creating}
        isCreatingSession={isCreatingSession}
        composerError={error}
        providerError={providerError ?? ""}
        handleSubmit={handleSubmit}
      />
    </SidebarLayout>
  )
}
