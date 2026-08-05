import { Button } from "@cloudflare/kumo/components/button"
import { useLocation, useNavigate } from "@tanstack/react-router"
import { ArrowUp, ChevronDown, FolderGit2, KeyRound, Wrench } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  getGitHubRepoTool,
  type AgentRuntime,
  type OpenCodeMcpServers,
  type RuntimeModelCategory,
  type RuntimeProviderModelOption,
  type SessionToolSpec,
  type SubagentMode,
} from "@solzero/shared"
import { S0Loader } from "@/components/s0-loader"
import { S0AnimatedIcon } from "@/components/s0-animated-icon"
import {
  HomeToolbarIconButton,
  TOOLS_TOOLBAR_CLASS_NAME,
} from "@/components/home-toolbar-icon-button"
import {
  AiProviderLoadingButton,
  AiProviderRequiredButton,
} from "@/components/ai-provider-required"
import { getSelectedReasoningLabel, ModelThinkingDialog } from "@/components/model-thinking-dialog"
import { PreviousSessionsTable } from "@/components/home-agent-sessions"
import {
  HomeGitRepoDialog,
  HomeSecretsDialog,
  HomeSessionToolsDialog,
  type RepoQueryState,
} from "@/components/home-session-tools-dialog"
import { useHomeScrollAnimation } from "@/components/home-scroll-animation"
import { fetchSyncedSecretKeysForRepo } from "@/lib/repo-secret-selection"
import { PageHeader } from "@/components/page-header"
import { useSidebarContext } from "@/components/sidebar-layout"
import { manrope } from "@/lib/fonts"
import { getS0Brand } from "@/lib/brand"
import { isHomeNewAgentHash, isHomePreviousSessionsHash } from "@/lib/home-route-search"
import { appToastManager } from "@/lib/toast-manager"
import {
  Repo,
  RepoPagination,
  AGENT_RUNTIME_TOOLBAR_CLASS_NAME,
  REPOSITORY_TOOLBAR_CLASS_NAME,
  SECRETS_TOOLBAR_CLASS_NAME,
} from "./page"
import {
  AgentRuntimeDialog,
  AgentRuntimeIcon,
  addCopyableToast,
  formatRuntimeLabel,
} from "./session-kind"

export type HomeContentProps = {
  isAuthenticated: boolean
  isAdmin: boolean
  repos: Repo[]
  repoQuery: RepoQueryState
  repoPagination: RepoPagination | null
  loadingRepos: boolean
  repoLoadError: string
  needsGitHubLink: boolean
  githubAppInstallUrl: string | null
  updateRepoQuery: (patch: Partial<RepoQueryState>) => void
  selectedTools: SessionToolSpec[]
  selectedSecretKeys: string[]
  selectedCustomMcpServers: OpenCodeMcpServers
  selectedIsolateStepLimit: number
  selectedSubagents: SubagentMode
  setSelectedToolState: (value: {
    tools: SessionToolSpec[]
    secretKeys?: string[]
    customMcpServers: OpenCodeMcpServers
    isolateStepLimit: number
    subagents: SubagentMode
  }) => void
  selectedModel: string
  setSelectedModel: (value: string) => void
  selectedModelOption: RuntimeProviderModelOption | null
  modelOptions: RuntimeModelCategory[]
  providerCatalogLoaded: boolean
  providerCatalogLoading: boolean
  providerDefaultModelConfigured: boolean
  selectedAgentRuntime: AgentRuntime
  setSelectedAgentRuntime: (value: AgentRuntime) => void
  reasoningEffort: string | undefined
  setReasoningEffort: (value: string | undefined) => void
  prompt: string
  handlePromptChange: (value: string) => void
  creating: boolean
  isCreatingSession: boolean
  composerError: string
  providerError: string
  handleSubmit: (e: React.FormEvent) => void
}

export function HomeContentWithSidebar(props: HomeContentProps) {
  return <HomeContent {...props} />
}

export function HomeContent({
  isAuthenticated,
  isAdmin,
  repos,
  repoQuery,
  repoPagination,
  loadingRepos,
  repoLoadError,
  needsGitHubLink,
  githubAppInstallUrl,
  updateRepoQuery,
  selectedTools,
  selectedSecretKeys,
  selectedCustomMcpServers,
  selectedIsolateStepLimit,
  selectedSubagents,
  setSelectedToolState,
  selectedModel,
  setSelectedModel,
  selectedModelOption,
  modelOptions,
  providerCatalogLoaded,
  providerCatalogLoading,
  providerDefaultModelConfigured,
  selectedAgentRuntime,
  setSelectedAgentRuntime,
  reasoningEffort,
  setReasoningEffort,
  prompt,
  handlePromptChange,
  creating,
  isCreatingSession,
  composerError,
  providerError,
  handleSubmit,
}: HomeContentProps) {
  const brand = getS0Brand()
  const [repoDialogOpen, setRepoDialogOpen] = useState(false)
  const [secretsDialogOpen, setSecretsDialogOpen] = useState(false)
  const [toolsDialogOpen, setToolsDialogOpen] = useState(false)
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false)
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastComposerErrorToastRef = useRef("")
  const lastProviderErrorToastRef = useRef("")
  const lastRepoErrorToastRef = useRef("")
  const lastModelNoticeToastRef = useRef("")

  const addErrorToast = useCallback((title: string, description?: string) => {
    addCopyableToast({
      title,
      description,
      variant: "error",
    })
  }, [])

  useEffect(() => {
    if (!composerError || lastComposerErrorToastRef.current === composerError) {
      return
    }
    lastComposerErrorToastRef.current = composerError
    addErrorToast("Agent setup failed", composerError)
  }, [addErrorToast, composerError])

  useEffect(() => {
    if (!providerError || lastProviderErrorToastRef.current === providerError) {
      return
    }
    lastProviderErrorToastRef.current = providerError
    addErrorToast(providerError)
  }, [addErrorToast, providerError])

  useEffect(() => {
    if (!repoLoadError || lastRepoErrorToastRef.current === repoLoadError) {
      return
    }
    lastRepoErrorToastRef.current = repoLoadError
    addErrorToast("Could not load repositories", repoLoadError)
  }, [addErrorToast, repoLoadError])

  useEffect(() => {
    if (!providerCatalogLoaded || providerError || modelOptions.length > 0) {
      return
    }
    const message = "An admin needs to set up an AI Provider before agents can run."
    if (lastModelNoticeToastRef.current === message) {
      return
    }
    lastModelNoticeToastRef.current = message
    appToastManager.add({
      title: "No models configured",
      description: message,
      variant: "warning",
      timeout: 8000,
    })
  }, [modelOptions.length, providerCatalogLoaded, providerError])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const selectedRepoTool = getGitHubRepoTool(selectedTools)
  const selectedRepoFullName = selectedRepoTool
    ? `${selectedRepoTool.repoOwner}/${selectedRepoTool.repoName}`
    : ""
  const selectedRepoAccessibleLabel = selectedRepoFullName
    ? `Repository: ${selectedRepoFullName}`
    : "Repository: No repository"
  const selectedToolsCount =
    selectedTools.filter((tool) => tool.kind !== "github_repo").length +
    Object.keys(selectedCustomMcpServers).length
  const selectedToolsButtonLabel =
    selectedToolsCount === 0 ? "Tools" : `tool${selectedToolsCount === 1 ? "" : "s"}`
  const selectedToolsAccessibleLabel =
    selectedToolsCount === 0 ? "Tools" : `Tools: ${selectedToolsCount} ${selectedToolsButtonLabel}`
  const selectedSecretsAccessibleLabel =
    selectedSecretKeys.length === 0
      ? "Secrets: none attached"
      : `Secrets: ${selectedSecretKeys.length} attached`
  const selectedAgentRuntimeLabel = formatRuntimeLabel(selectedAgentRuntime)
  const selectedModelLabel = selectedModelOption?.name || "select model"
  const selectedReasoningLabel = getSelectedReasoningLabel(selectedModelOption, reasoningEffort)
  const modelControlLoading =
    providerCatalogLoading || Boolean(selectedModel && !selectedModelOption)
  const toolbarTooltipHidden =
    sessionDialogOpen || repoDialogOpen || secretsDialogOpen || toolsDialogOpen || modelDialogOpen
  const { isOpen: sidebarOpen } = useSidebarContext()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const floatingHeaderRef = useRef<HTMLButtonElement>(null)
  const scrollCueRef = useRef<HTMLButtonElement>(null)

  const hash = useLocation({ select: (location) => location.hash })
  const navigate = useNavigate({ from: "/" })
  const { scrollToPreviousSessions, scrollToNewAgent } = useHomeScrollAnimation({
    enabled: isAuthenticated,
    containerRef: scrollContainerRef,
    heroRef,
    tableRef,
    floatingHeaderRef,
    scrollCueRef,
    inputRef,
  })

  useLayoutEffect(() => {
    if (!isAuthenticated) {
      return
    }

    if (isHomePreviousSessionsHash(hash)) {
      scrollToPreviousSessions()
      return
    }

    if (isHomeNewAgentHash(hash)) {
      scrollToNewAgent()
    }
  }, [hash, isAuthenticated, scrollToPreviousSessions, scrollToNewAgent])

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }

    if (!isHomePreviousSessionsHash(hash) && !isHomeNewAgentHash(hash)) {
      return
    }

    const clearHashTimer = window.setTimeout(
      () => {
        void navigate({
          hash: undefined,
          replace: true,
        })
      },
      isHomePreviousSessionsHash(hash) ? 700 : 100,
    )

    return () => {
      window.clearTimeout(clearHashTimer)
    }
  }, [hash, isAuthenticated, navigate])

  return (
    <div
      ref={scrollContainerRef}
      className="relative isolate h-full overflow-y-auto bg-kumo-canvas"
    >
      <PageHeader border={false} heightClassName="h-0" />

      <div
        className={`pointer-events-none fixed top-0 z-30 flex h-[53px] items-center justify-center ${
          sidebarOpen ? "max-md:inset-x-0 md:left-72 md:right-0" : "inset-x-0"
        }`}
      >
        <button
          ref={floatingHeaderRef}
          type="button"
          onClick={scrollToNewAgent}
          className="pointer-events-auto invisible flex -translate-y-2 items-center gap-2 rounded-full bg-kumo-elevated px-4 py-2 text-sm text-kumo-subtle opacity-0 shadow-lg ring-1 ring-kumo-hairline transition hover:bg-kumo-tint hover:text-kumo-default focus:outline-none focus:ring-2 focus:ring-kumo-brand"
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
          Start a new Agent
        </button>
      </div>

      <section ref={heroRef} className="relative min-h-screen">
        <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-6 pt-20 pb-32 sm:px-8">
          <div className="mx-auto w-full max-w-2xl">
            <div className="text-center mb-8">
              <S0AnimatedIcon size={96} className="mx-auto mb-4" />
              <h1
                className={`${manrope.className} mb-2 text-3xl font-normal leading-9 text-kumo-default`}
              >
                Welcome to {brand.name}
              </h1>
              {!isAuthenticated ? (
                <p className="text-kumo-subtle">Sign in to start a new agent</p>
              ) : null}
            </div>

            {isAuthenticated && (
              <form onSubmit={handleSubmit}>
                <HomeGitRepoDialog
                  open={repoDialogOpen}
                  onClose={() => setRepoDialogOpen(false)}
                  repos={repos}
                  repoQuery={repoQuery}
                  repoPagination={repoPagination}
                  loadingRepos={loadingRepos}
                  githubAppInstallUrl={githubAppInstallUrl}
                  needsGitHubLink={needsGitHubLink}
                  selectedTools={selectedTools}
                  onRepoQueryChange={updateRepoQuery}
                  onSave={async (tools) => {
                    const repoTool = getGitHubRepoTool(tools)
                    const repoFullName = repoTool
                      ? `${repoTool.repoOwner}/${repoTool.repoName}`
                      : null
                    const secretKeys = await fetchSyncedSecretKeysForRepo(
                      selectedSecretKeys,
                      repoFullName,
                    )
                    setSelectedToolState({
                      tools,
                      secretKeys,
                      customMcpServers: selectedCustomMcpServers,
                      isolateStepLimit: selectedIsolateStepLimit,
                      subagents: selectedSubagents,
                    })
                  }}
                />
                <HomeSecretsDialog
                  open={secretsDialogOpen}
                  onClose={() => setSecretsDialogOpen(false)}
                  selectedSecretKeys={selectedSecretKeys}
                  onSave={(secretKeys) =>
                    setSelectedToolState({
                      tools: selectedTools,
                      secretKeys,
                      customMcpServers: selectedCustomMcpServers,
                      isolateStepLimit: selectedIsolateStepLimit,
                      subagents: selectedSubagents,
                    })
                  }
                />
                <HomeSessionToolsDialog
                  open={toolsDialogOpen}
                  onClose={() => setToolsDialogOpen(false)}
                  selectedTools={selectedTools}
                  customMcpServers={selectedCustomMcpServers}
                  isolateStepLimit={selectedIsolateStepLimit}
                  subagents={selectedSubagents}
                  showSubagents={selectedAgentRuntime === "isolate"}
                  onSave={setSelectedToolState}
                />
                {sessionDialogOpen && (
                  <AgentRuntimeDialog
                    selectedAgentRuntime={selectedAgentRuntime}
                    onSelect={setSelectedAgentRuntime}
                    onClose={() => setSessionDialogOpen(false)}
                  />
                )}
                {modelDialogOpen && (
                  <ModelThinkingDialog
                    modelOptions={modelOptions}
                    selectedModel={selectedModel}
                    selectedModelOption={selectedModelOption}
                    reasoningEffort={reasoningEffort}
                    showDefaultModelHint={
                      !providerDefaultModelConfigured && modelOptions.length > 0
                    }
                    isAdmin={isAdmin}
                    onModelSelect={setSelectedModel}
                    onReasoningSelect={setReasoningEffort}
                    onClose={() => setModelDialogOpen(false)}
                  />
                )}

                <div className="overflow-hidden rounded-xl bg-kumo-elevated">
                  <textarea
                    ref={inputRef}
                    value={prompt}
                    onChange={(e) => handlePromptChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Chat, build, and automate with project context"
                    disabled={creating}
                    className="session-composer-textarea session-composer-textarea--ringed min-h-28 w-full resize-none bg-transparent px-4 py-4 text-kumo-default placeholder:text-kumo-placeholder focus:outline-none disabled:opacity-50"
                    rows={3}
                  />

                  <div className="flex items-center justify-between px-4 pt-1 pb-2">
                    <div className="flex items-center gap-2">
                      <HomeToolbarIconButton
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.blur()
                          if (!creating) {
                            setSessionDialogOpen(true)
                          }
                        }}
                        disabled={creating}
                        ariaLabel={`Agent runtime: ${selectedAgentRuntimeLabel}`}
                        tooltip={`Agent runtime: ${selectedAgentRuntimeLabel}`}
                        tooltipHidden={toolbarTooltipHidden}
                        className={AGENT_RUNTIME_TOOLBAR_CLASS_NAME}
                      >
                        <AgentRuntimeIcon
                          runtime={selectedAgentRuntime}
                          className="h-4 w-4 shrink-0"
                        />
                      </HomeToolbarIconButton>

                      <HomeToolbarIconButton
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.blur()
                          if (!creating) {
                            setSecretsDialogOpen(true)
                          }
                        }}
                        disabled={creating}
                        ariaLabel={selectedSecretsAccessibleLabel}
                        tooltip={selectedSecretsAccessibleLabel}
                        tooltipHidden={toolbarTooltipHidden}
                        className={
                          selectedSecretKeys.length > 0 ? SECRETS_TOOLBAR_CLASS_NAME : undefined
                        }
                      >
                        <KeyRound className="h-4 w-4 shrink-0" aria-hidden />
                        {selectedSecretKeys.length > 0 && (
                          <span
                            aria-hidden
                            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-medium leading-none text-white tabular-nums"
                          >
                            {selectedSecretKeys.length}
                          </span>
                        )}
                      </HomeToolbarIconButton>

                      <HomeToolbarIconButton
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.blur()
                          if (!creating) {
                            setRepoDialogOpen(true)
                          }
                        }}
                        disabled={creating}
                        ariaLabel={selectedRepoAccessibleLabel}
                        tooltip={selectedRepoAccessibleLabel}
                        tooltipHidden={toolbarTooltipHidden}
                        className={selectedRepoFullName ? REPOSITORY_TOOLBAR_CLASS_NAME : undefined}
                      >
                        <FolderGit2 className="h-4 w-4 shrink-0" aria-hidden />
                        {selectedRepoFullName && (
                          <span
                            aria-hidden
                            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500"
                          />
                        )}
                      </HomeToolbarIconButton>

                      <HomeToolbarIconButton
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.blur()
                          if (!creating) {
                            setToolsDialogOpen(true)
                          }
                        }}
                        disabled={creating}
                        ariaLabel={selectedToolsAccessibleLabel}
                        tooltip={selectedToolsAccessibleLabel}
                        tooltipHidden={toolbarTooltipHidden}
                        className={selectedToolsCount > 0 ? TOOLS_TOOLBAR_CLASS_NAME : undefined}
                      >
                        <Wrench className="h-4 w-4 shrink-0" aria-hidden />
                        {selectedToolsCount > 0 && (
                          <span
                            aria-hidden
                            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-medium leading-none text-white tabular-nums"
                          >
                            {selectedToolsCount}
                          </span>
                        )}
                      </HomeToolbarIconButton>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isCreatingSession && (
                        <span className="text-xs text-kumo-brand whitespace-nowrap">
                          Preparing {selectedAgentRuntimeLabel} agent...
                        </span>
                      )}
                      {modelControlLoading ? (
                        <AiProviderLoadingButton />
                      ) : modelOptions.length === 0 ? (
                        <AiProviderRequiredButton isAdmin={isAdmin} disabled={creating} />
                      ) : (
                        <button
                          type="button"
                          onClick={() => !creating && setModelDialogOpen(true)}
                          disabled={creating}
                          aria-label={`Model: ${selectedModelLabel}; thinking: ${selectedReasoningLabel}`}
                          className="home-model-control group flex min-h-9 items-center rounded-lg px-2.5 py-1 text-right transition-[background-color,color,opacity,transform] active:scale-[0.96] disabled:opacity-50"
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className="max-w-40 truncate text-xs font-medium text-kumo-default leading-tight">
                              {selectedModelLabel}
                            </span>
                            <span className="max-w-40 truncate text-xs text-kumo-subtle leading-tight">
                              {selectedReasoningLabel}
                            </span>
                          </span>
                        </button>
                      )}
                      <Button
                        type="submit"
                        disabled={
                          !prompt.trim() || creating || !selectedModel || modelOptions.length === 0
                        }
                        shape="circle"
                        variant="secondary"
                        aria-label="Send"
                        title="Send"
                        icon={
                          creating ? (
                            <S0Loader size={32} />
                          ) : (
                            <ArrowUp className="h-5 w-5" aria-hidden />
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>

        {isAuthenticated ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-8 z-10 flex justify-center px-6">
            <button
              ref={scrollCueRef}
              type="button"
              aria-label="Previous sessions"
              onClick={scrollToPreviousSessions}
              className="pointer-events-auto flex flex-col items-center gap-1 rounded-full px-4 py-2 text-sm text-kumo-subtle transition hover:text-kumo-default focus:outline-none focus:ring-2 focus:ring-kumo-brand"
            >
              <span>Previous sessions</span>
              <ChevronDown className="h-5 w-5" aria-hidden />
            </button>
          </div>
        ) : null}
      </section>

      {isAuthenticated ? (
        <div ref={tableRef} className="scroll-mt-20">
          <PreviousSessionsTable />
        </div>
      ) : null}
    </div>
  )
}
