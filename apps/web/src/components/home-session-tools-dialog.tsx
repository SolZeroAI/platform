"use client"

import {
  DEFAULT_SUBAGENT_MODE,
  DEFAULT_ISOLATE_STEP_LIMIT,
  MAX_ISOLATE_STEP_LIMIT,
  AI_SEARCH_SESSION_TOOL_KIND,
  MCPCF_SESSION_TOOL_KIND,
  MIN_ISOLATE_STEP_LIMIT,
  normalizeIsolateStepLimit,
  normalizeSessionTools,
  normalizeOpenCodeMcpServers,
  summarizeSessionTools,
  type OpenCodeMcpServers,
  type SessionToolSpec,
  type SubagentMode,
} from "@solzero/shared"
import { Badge } from "@cloudflare/kumo/components/badge"
import { Banner } from "@cloudflare/kumo/components/banner"
import { Button } from "@cloudflare/kumo/components/button"
import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { Empty } from "@cloudflare/kumo/components/empty"
import { Input } from "@cloudflare/kumo/components/input"
import { Pagination } from "@cloudflare/kumo/components/pagination"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import { Tooltip, TooltipProvider } from "@cloudflare/kumo/components/tooltip"
import { Check, ChevronRight, ExternalLink, Plus } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { DialogPaginationPageSize } from "@/components/dialog-pagination-page-size"
import { S0Loader, TableCellState } from "@/components/s0-loader"
import { CodeSurface } from "@/components/code"
import { Dialog } from "@/components/ui/dialog"
import { IsolateAgentControls } from "@/components/isolate-agent-controls"

const MCPCF_PAGE_SIZE_OPTIONS = [10, 20, 50] as const
const DEFAULT_MCPCF_PER_PAGE = 10

export { HomeGitRepoDialog, type RepoQueryState } from "./home-git-repo-dialog"
export { HomeSecretsDialog } from "./home-secrets-dialog"

interface HomeSessionToolsDialogProps {
  open: boolean
  onClose: () => void
  selectedTools: SessionToolSpec[]
  customMcpServers?: OpenCodeMcpServers
  isolateStepLimit?: number
  subagents?: SubagentMode
  showSubagents?: boolean
  focusStepLimit?: boolean
  onSave: (value: {
    tools: SessionToolSpec[]
    customMcpServers: OpenCodeMcpServers
    isolateStepLimit: number
    subagents: SubagentMode
  }) => Promise<void> | void
  saveLabel?: string
  saving?: boolean
  error?: string
}

type McpcfToolPreview = {
  name: string
  description?: string
}

type McpcfServerId = string

interface AiSearchSessionSource {
  id: string
  label: string
  description: string
  kind: "ai_search"
}

interface McpcfServer {
  id: McpcfServerId
  slug: string
  label: string
  description: string
  authType: string | null
  authLabel?: string | null
  gatewayAuthType?: string | null
  gatewayAuthLabel?: string | null
  upstreamAuthType?: string | null
  upstreamAuthLabel?: string | null
  gatewayAuthTokenRequired?: boolean
  gatewayAuthTokenConfigured?: boolean
  upstreamAuthTokenRequired?: boolean
  upstreamAuthTokenConfigured?: boolean
  configuredForUser?: boolean
  contextForgeUrl?: string
  contextForgeApiKeysUrl?: string
  toolCount: number
}

type McpcfToolPreviewState =
  | { status: "idle"; tools: McpcfToolPreview[]; error: "" }
  | { status: "loading"; tools: McpcfToolPreview[]; error: "" }
  | { status: "loaded"; tools: McpcfToolPreview[]; error: "" }
  | { status: "error"; tools: McpcfToolPreview[]; error: string }

function toggleDocSource(tools: SessionToolSpec[], sourceId: string): SessionToolSpec[] {
  const alreadySelected = tools.some(
    (tool) => tool.kind === AI_SEARCH_SESSION_TOOL_KIND && tool.sourceId === sourceId,
  )

  if (alreadySelected) {
    return normalizeSessionTools(
      tools.filter(
        (tool) => !(tool.kind === AI_SEARCH_SESSION_TOOL_KIND && tool.sourceId === sourceId),
      ),
    )
  }

  return normalizeSessionTools([
    ...tools,
    {
      kind: AI_SEARCH_SESSION_TOOL_KIND,
      sourceId,
    },
  ])
}

function toggleMcpcfServer(tools: SessionToolSpec[], serverId: McpcfServerId): SessionToolSpec[] {
  const alreadySelected = tools.some(
    (tool) => tool.kind === MCPCF_SESSION_TOOL_KIND && tool.serverId === serverId,
  )

  if (alreadySelected) {
    return normalizeSessionTools(
      tools.filter(
        (tool) => !(tool.kind === MCPCF_SESSION_TOOL_KIND && tool.serverId === serverId),
      ),
    )
  }

  return normalizeSessionTools([
    ...tools,
    {
      kind: MCPCF_SESSION_TOOL_KIND,
      serverId,
    },
  ])
}

function formatCustomMcpServers(customMcpServers: OpenCodeMcpServers | null | undefined): string {
  return JSON.stringify(normalizeOpenCodeMcpServers(customMcpServers), null, 2)
}

function parseCustomMcpServers(text: string): OpenCodeMcpServers {
  const trimmed = text.trim()
  if (!trimmed) {
    return {}
  }
  return normalizeOpenCodeMcpServers(JSON.parse(trimmed))
}

function parseCustomMcpDraft(
  text: string,
): { servers: OpenCodeMcpServers; error: null } | { servers: null; error: string } {
  try {
    return { servers: parseCustomMcpServers(text), error: null }
  } catch (errorValue) {
    return {
      servers: null,
      error: errorValue instanceof Error ? errorValue.message : "Invalid custom MCP configuration",
    }
  }
}

function parseStepLimitDraft(
  text: string,
): { stepLimit: number; error: null } | { stepLimit: null; error: string } {
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) {
    return { stepLimit: null, error: "Step call limit must be a number" }
  }
  if (parsed < MIN_ISOLATE_STEP_LIMIT || parsed > MAX_ISOLATE_STEP_LIMIT) {
    return {
      stepLimit: null,
      error: `Step call limit must be between ${MIN_ISOLATE_STEP_LIMIT} and ${MAX_ISOLATE_STEP_LIMIT}`,
    }
  }
  return { stepLimit: normalizeIsolateStepLimit(parsed), error: null }
}

function formatMcpcfAuthBadgeLabel(
  server: Pick<McpcfServer, "authLabel" | "authType" | "gatewayAuthLabel" | "gatewayAuthType">,
): string | null {
  if (server.gatewayAuthLabel ?? server.authLabel) {
    return server.gatewayAuthLabel ?? server.authLabel ?? null
  }

  const authType = (server.gatewayAuthType ?? server.authType)?.trim().toLowerCase()
  if (!authType) {
    return null
  }
  if (authType === "oauth") {
    return "OAuth"
  }
  if (authType === "api_key" || authType === "apikey") {
    return "MCPCF API key"
  }
  if (authType === "token") {
    return "MCPCF API token"
  }

  return authType
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function isMcpcfServerConfigured(server: McpcfServer): boolean {
  return server.configuredForUser !== false
}

function getMcpcfSetupMessage(server: McpcfServer): string | null {
  if (server.gatewayAuthTokenRequired && !server.gatewayAuthTokenConfigured) {
    return "Set up your ContextForge API token before using this MCP."
  }
  if (server.upstreamAuthTokenRequired && !server.upstreamAuthTokenConfigured) {
    return "Set up your user token before using this MCP."
  }
  if (server.configuredForUser === false) {
    return "Set up credentials before using this MCP."
  }
  return null
}

function getMcpcfSetupUrl(server: McpcfServer): string {
  const usesSharedContextForgeToken =
    server.gatewayAuthTokenRequired && !server.gatewayAuthTokenConfigured

  return usesSharedContextForgeToken
    ? "/settings?category=api-access#contextforge-api-token"
    : `/settings?category=agents&tab=mcps&mcpServerId=${encodeURIComponent(server.id)}`
}

export function HomeSessionToolsDialog({
  open,
  onClose,
  selectedTools,
  customMcpServers,
  isolateStepLimit = DEFAULT_ISOLATE_STEP_LIMIT,
  subagents = DEFAULT_SUBAGENT_MODE,
  showSubagents = false,
  focusStepLimit = false,
  onSave,
  saveLabel = "Save",
  saving = false,
  error,
}: HomeSessionToolsDialogProps) {
  const stepLimitInputRef = useRef<HTMLInputElement>(null)
  const selectedToolsRef = useRef(selectedTools)
  const customMcpServersRef = useRef(customMcpServers)
  const isolateStepLimitRef = useRef(isolateStepLimit)
  const subagentsRef = useRef(subagents)
  selectedToolsRef.current = selectedTools
  customMcpServersRef.current = customMcpServers
  isolateStepLimitRef.current = isolateStepLimit
  subagentsRef.current = subagents
  const [draftTools, setDraftTools] = useState<SessionToolSpec[]>(selectedTools)
  const [draftIsolateStepLimit, setDraftIsolateStepLimit] = useState(() =>
    String(normalizeIsolateStepLimit(isolateStepLimit)),
  )
  const [draftSubagents, setDraftSubagents] = useState<SubagentMode>(subagents)
  const [draftCustomMcpText, setDraftCustomMcpText] = useState(() =>
    formatCustomMcpServers(customMcpServers),
  )
  const [customMcpError, setCustomMcpError] = useState("")
  const [stepLimitError, setStepLimitError] = useState("")
  const [mcpcfServers, setMcpcfServers] = useState<McpcfServer[]>([])
  const [mcpcfServersLoading, setMcpcfServersLoading] = useState(false)
  const [mcpcfServersError, setMcpcfServersError] = useState("")
  const [aiSearchSources, setAiSearchSources] = useState<AiSearchSessionSource[]>([])
  const [aiSearchSourcesLoading, setAiSearchSourcesLoading] = useState(false)
  const [aiSearchSourcesError, setAiSearchSourcesError] = useState("")
  const [expandedMcpcfServerIds, setExpandedMcpcfServerIds] = useState<Set<McpcfServerId>>(
    () => new Set(),
  )
  const [mcpcfToolPreviews, setMcpcfToolPreviews] = useState<Record<string, McpcfToolPreviewState>>(
    {},
  )
  const [mcpcfSearch, setMcpcfSearch] = useState("")
  const [mcpcfPage, setMcpcfPage] = useState(1)
  const [mcpcfPerPage, setMcpcfPerPage] = useState(DEFAULT_MCPCF_PER_PAGE)
  const [customMcpEditorOpen, setCustomMcpEditorOpen] = useState(false)
  const selectedDocIds = useMemo(
    () =>
      new Set(
        draftTools
          .filter((tool) => tool.kind === AI_SEARCH_SESSION_TOOL_KIND)
          .map((tool) => tool.sourceId),
      ),
    [draftTools],
  )
  const selectedMcpcfServerIds = useMemo(
    () =>
      new Set(
        draftTools
          .filter((tool) => tool.kind === MCPCF_SESSION_TOOL_KIND)
          .map((tool) => tool.serverId),
      ),
    [draftTools],
  )
  const customMcpDraft = useMemo(
    () => parseCustomMcpDraft(draftCustomMcpText),
    [draftCustomMcpText],
  )
  const parsedCustomMcpServers = customMcpDraft.servers
  const customMcpServerNames = useMemo(
    () => Object.keys(parsedCustomMcpServers ?? {}),
    [parsedCustomMcpServers],
  )
  const toolsSummary = summarizeSessionTools(
    draftTools.filter((tool) => tool.kind !== "github_repo"),
    {
      emptyLabel: "No tools selected",
      customMcpServers: parsedCustomMcpServers ?? {},
    },
  )
  const filteredMcpcfServers = useMemo(() => {
    const query = mcpcfSearch.trim().toLowerCase()
    if (!query) {
      return mcpcfServers
    }

    return mcpcfServers.filter((server) => {
      const haystack = [server.label, server.description, server.slug].join(" ").toLowerCase()
      return haystack.includes(query)
    })
  }, [mcpcfSearch, mcpcfServers])
  const mcpcfPageCount = Math.max(1, Math.ceil(filteredMcpcfServers.length / mcpcfPerPage))
  const paginatedMcpcfServers = useMemo(() => {
    const start = (mcpcfPage - 1) * mcpcfPerPage
    return filteredMcpcfServers.slice(start, start + mcpcfPerPage)
  }, [filteredMcpcfServers, mcpcfPage, mcpcfPerPage])

  useEffect(() => {
    if (!open) {
      return
    }

    setDraftTools(selectedToolsRef.current)
    setDraftIsolateStepLimit(String(normalizeIsolateStepLimit(isolateStepLimitRef.current)))
    setDraftSubagents(subagentsRef.current)
    setDraftCustomMcpText(formatCustomMcpServers(customMcpServersRef.current))
    setCustomMcpError("")
    setStepLimitError("")
    setMcpcfServersError("")
    setMcpcfSearch("")
    setMcpcfPage(1)
    setMcpcfPerPage(DEFAULT_MCPCF_PER_PAGE)
    setCustomMcpEditorOpen(false)

    if (focusStepLimit) {
      window.setTimeout(() => {
        stepLimitInputRef.current?.focus()
        stepLimitInputRef.current?.select()
      }, 0)
    }
  }, [focusStepLimit, open])

  useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose, open])

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    setMcpcfServersLoading(true)
    fetch("/api/sessions/mcpcf/servers")
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          servers?: McpcfServer[]
          error?: string
        }
        if (!response.ok) {
          throw new Error(
            data.error || `Failed to load MCP Context Forge servers: ${response.status}`,
          )
        }
        if (!cancelled) {
          setMcpcfServers(data.servers ?? [])
          setMcpcfServersError("")
        }
      })
      .catch((errorValue) => {
        if (!cancelled) {
          setMcpcfServers([])
          setMcpcfServersError(
            errorValue instanceof Error
              ? errorValue.message
              : "Failed to load MCP Context Forge servers",
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMcpcfServersLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    setAiSearchSourcesLoading(true)
    fetch("/api/sessions/ai-search/sources")
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          sources?: AiSearchSessionSource[]
          error?: string
        }
        if (!response.ok) {
          throw new Error(data.error || `Failed to load AI Search sources: ${response.status}`)
        }
        if (!cancelled) {
          setAiSearchSources(data.sources ?? [])
          setAiSearchSourcesError("")
        }
      })
      .catch((errorValue) => {
        if (!cancelled) {
          setAiSearchSources([])
          setAiSearchSourcesError(
            errorValue instanceof Error ? errorValue.message : "Failed to load AI Search sources",
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAiSearchSourcesLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    setMcpcfPage(1)
  }, [mcpcfSearch, mcpcfPerPage])

  useEffect(() => {
    if (mcpcfPage > mcpcfPageCount) {
      setMcpcfPage(mcpcfPageCount)
    }
  }, [mcpcfPage, mcpcfPageCount])

  const loadMcpcfTools = async (serverId: McpcfServerId) => {
    const currentPreview = mcpcfToolPreviews[serverId]
    if (currentPreview?.status === "loading" || currentPreview?.status === "loaded") {
      return
    }

    setMcpcfToolPreviews((previews) => ({
      ...previews,
      [serverId]: { status: "loading", tools: previews[serverId]?.tools ?? [], error: "" },
    }))

    try {
      const response = await fetch(`/api/sessions/mcpcf/${encodeURIComponent(serverId)}/tools`)
      const data = (await response.json().catch(() => ({}))) as {
        tools?: McpcfToolPreview[]
        error?: string
      }
      if (!response.ok) {
        throw new Error(data.error || `Failed to load tools: ${response.status}`)
      }

      setMcpcfToolPreviews((previews) => ({
        ...previews,
        [serverId]: { status: "loaded", tools: data.tools ?? [], error: "" },
      }))
    } catch (errorValue) {
      setMcpcfToolPreviews((previews) => ({
        ...previews,
        [serverId]: {
          status: "error",
          tools: previews[serverId]?.tools ?? [],
          error: errorValue instanceof Error ? errorValue.message : "Failed to load tools",
        },
      }))
    }
  }

  const toggleMcpcfServerExpanded = (serverId: McpcfServerId) => {
    const isOpening = !expandedMcpcfServerIds.has(serverId)
    setExpandedMcpcfServerIds((serverIds) => {
      const nextServerIds = new Set(serverIds)
      if (nextServerIds.has(serverId)) {
        nextServerIds.delete(serverId)
      } else {
        nextServerIds.add(serverId)
      }
      return nextServerIds
    })

    if (isOpening) {
      void loadMcpcfTools(serverId)
    }
  }

  if (!open) {
    return null
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose()
        }
      }}
    >
      <Dialog size="xl" className="flex max-h-[85vh] w-full max-w-4xl flex-col p-0">
        <div className="border-b border-kumo-hairline px-5 py-4">
          <Dialog.Title>Agent tools</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm leading-5 text-kumo-subtle">
            Choose knowledge sources and custom MCP servers to add to this agent.
          </Dialog.Description>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <div className="space-y-6">
            <IsolateAgentControls
              stepLimitInputRef={stepLimitInputRef}
              stepLimit={draftIsolateStepLimit}
              onStepLimitChange={(value) => {
                setDraftIsolateStepLimit(value)
                setStepLimitError("")
              }}
              showSubagents={showSubagents}
              subagents={draftSubagents}
              onSubagentsChange={setDraftSubagents}
            />

            <section>
              <div className="mb-3">
                <h3 className="text-sm font-medium text-kumo-default">MCP Context Forge</h3>
                <p className="mt-1 text-sm text-kumo-subtle">
                  Enable your agent to access configured virtual servers through your linked account
                  permissions.
                </p>
              </div>

              {mcpcfServersError ? (
                <Banner variant="error" description={mcpcfServersError} className="mb-3" />
              ) : null}

              <div className="mb-3 w-full">
                <Input
                  value={mcpcfSearch}
                  onChange={(event) => setMcpcfSearch(event.target.value)}
                  placeholder="Search MCP servers"
                  aria-label="Search MCP servers"
                  className="w-full"
                  passwordManagerIgnore
                />
              </div>

              <div className="overflow-hidden rounded-xl bg-kumo-elevated/80 [container-type:inline-size]">
                <TooltipProvider>
                  <KumoTable className="w-full text-left text-sm">
                    <KumoTable.Header className="bg-kumo-tint text-xs">
                      <KumoTable.Row>
                        <KumoTable.Head className="bg-kumo-tint px-3 py-2 font-medium">
                          Server
                        </KumoTable.Head>
                        <KumoTable.Head className="bg-kumo-tint px-3 py-2 font-medium">
                          Auth
                        </KumoTable.Head>
                        <KumoTable.Head className="bg-kumo-tint px-3 py-2 font-medium">
                          Tools
                        </KumoTable.Head>
                        <KumoTable.Head className="bg-kumo-tint px-3 py-2 font-medium">
                          Setup
                        </KumoTable.Head>
                        <KumoTable.Head className="w-10 bg-kumo-tint px-3 py-2">
                          <span className="sr-only">Selected</span>
                        </KumoTable.Head>
                      </KumoTable.Row>
                    </KumoTable.Header>
                    <KumoTable.Body>
                      {mcpcfServersLoading ? (
                        <KumoTable.Row className="bg-kumo-base">
                          <KumoTable.Cell
                            colSpan={5}
                            className="border-b border-kumo-hairline px-3 py-8 text-sm text-kumo-subtle"
                          >
                            <TableCellState>
                              <S0Loader size={32} />
                            </TableCellState>
                          </KumoTable.Cell>
                        </KumoTable.Row>
                      ) : filteredMcpcfServers.length === 0 ? (
                        <KumoTable.Row className="bg-kumo-base">
                          <KumoTable.Cell
                            colSpan={5}
                            className="border-b border-kumo-hairline px-3 py-8 text-sm text-kumo-subtle"
                          >
                            <TableCellState>
                              <Empty
                                title={
                                  mcpcfServers.length === 0
                                    ? "No MCP Context Forge servers are configured"
                                    : "No MCP servers found"
                                }
                                description={
                                  mcpcfServers.length === 0
                                    ? "Configured virtual servers will appear here."
                                    : "Try a different search."
                                }
                              />
                            </TableCellState>
                          </KumoTable.Cell>
                        </KumoTable.Row>
                      ) : (
                        paginatedMcpcfServers.flatMap((server) => {
                          const isSelected = selectedMcpcfServerIds.has(server.id)
                          const isServerExpanded = expandedMcpcfServerIds.has(server.id)
                          const preview = mcpcfToolPreviews[server.id] ?? {
                            status: "idle",
                            tools: [],
                            error: "",
                          }
                          const authBadgeLabel = formatMcpcfAuthBadgeLabel(server)
                          const toolPanelId = `mcpcf-${server.slug}-tools`
                          const isConfigured = isMcpcfServerConfigured(server)
                          const setupMessage = getMcpcfSetupMessage(server)
                          const canToggle = isSelected || isConfigured
                          const setupUrl = getMcpcfSetupUrl(server)

                          return [
                            <KumoTable.Row
                              key={server.id}
                              className={`bg-kumo-base transition hover:bg-kumo-tint ${
                                isSelected ? "bg-kumo-tint/60" : ""
                              } ${isConfigured ? "cursor-pointer" : "opacity-70"}`}
                              onClick={() => {
                                if (canToggle) {
                                  setDraftTools(toggleMcpcfServer(draftTools, server.id))
                                }
                              }}
                            >
                              <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2.5 align-middle">
                                <div className="flex min-w-0 items-center gap-2">
                                  <button
                                    type="button"
                                    aria-expanded={isServerExpanded}
                                    aria-controls={toolPanelId}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      toggleMcpcfServerExpanded(server.id)
                                    }}
                                    className="flex-shrink-0 rounded p-0.5 text-kumo-subtle transition hover:text-kumo-default"
                                    aria-label={`${isServerExpanded ? "Collapse" : "Expand"} tools for ${server.label}`}
                                  >
                                    <ChevronRight
                                      className={`h-4 w-4 transition-transform duration-200 ease-out ${
                                        isServerExpanded ? "rotate-90" : ""
                                      }`}
                                      aria-hidden
                                    />
                                  </button>
                                  <div className="min-w-0 font-medium text-kumo-default">
                                    {server.label}
                                  </div>
                                </div>
                              </KumoTable.Cell>
                              <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2.5 align-middle">
                                {authBadgeLabel ? (
                                  <Badge variant="secondary">{authBadgeLabel}</Badge>
                                ) : (
                                  <span className="text-kumo-subtle">—</span>
                                )}
                              </KumoTable.Cell>
                              <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2.5 align-middle tabular-nums text-kumo-subtle">
                                {server.toolCount}
                              </KumoTable.Cell>
                              <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2.5 align-middle">
                                {setupMessage ? (
                                  <Tooltip content={setupMessage}>
                                    <a
                                      href={setupUrl}
                                      onClick={(event) => event.stopPropagation()}
                                      className="inline-flex no-underline"
                                    >
                                      <Badge variant="warning" className="gap-1">
                                        Needs setup
                                        <ExternalLink className="h-3 w-3" aria-hidden />
                                      </Badge>
                                    </a>
                                  </Tooltip>
                                ) : (
                                  <Badge variant="success">Ready</Badge>
                                )}
                              </KumoTable.Cell>
                              <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2.5 text-center align-middle">
                                {isSelected ? (
                                  <Check className="mx-auto h-4 w-4 text-kumo-brand" aria-hidden />
                                ) : null}
                              </KumoTable.Cell>
                            </KumoTable.Row>,
                            isServerExpanded ? (
                              <KumoTable.Row key={`${server.id}-tools`} className="bg-kumo-base">
                                <KumoTable.Cell
                                  id={toolPanelId}
                                  colSpan={5}
                                  className="border-b border-kumo-hairline px-3 py-3 align-top"
                                >
                                  {(preview.status === "idle" || preview.status === "loading") && (
                                    <p className="text-xs text-kumo-subtle">Loading tools...</p>
                                  )}
                                  {preview.status === "error" && (
                                    <p className="text-xs text-kumo-danger">{preview.error}</p>
                                  )}
                                  {preview.status === "loaded" && preview.tools.length === 0 && (
                                    <p className="text-xs text-kumo-subtle">
                                      No tools returned by this server.
                                    </p>
                                  )}
                                  {preview.tools.length > 0 ? (
                                    <div className="overflow-hidden rounded-lg ring-1 ring-kumo-line">
                                      <KumoTable className="w-full text-left text-xs">
                                        <KumoTable.Header className="bg-kumo-tint">
                                          <KumoTable.Row>
                                            <KumoTable.Head className="bg-kumo-tint px-3 py-1.5 font-medium">
                                              Tool
                                            </KumoTable.Head>
                                            <KumoTable.Head className="bg-kumo-tint px-3 py-1.5 font-medium">
                                              Description
                                            </KumoTable.Head>
                                          </KumoTable.Row>
                                        </KumoTable.Header>
                                        <KumoTable.Body>
                                          {preview.tools.map((tool) => (
                                            <KumoTable.Row key={tool.name} className="bg-kumo-base">
                                              <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2 align-middle font-mono text-kumo-default">
                                                {tool.name}
                                              </KumoTable.Cell>
                                              <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2 align-middle text-kumo-subtle">
                                                {tool.description || "—"}
                                              </KumoTable.Cell>
                                            </KumoTable.Row>
                                          ))}
                                        </KumoTable.Body>
                                      </KumoTable>
                                    </div>
                                  ) : null}
                                </KumoTable.Cell>
                              </KumoTable.Row>
                            ) : null,
                          ].filter(Boolean)
                        })
                      )}
                    </KumoTable.Body>
                  </KumoTable>
                </TooltipProvider>
              </div>

              {!mcpcfServersLoading && filteredMcpcfServers.length > 0 ? (
                <Pagination
                  page={mcpcfPage}
                  setPage={setMcpcfPage}
                  perPage={mcpcfPerPage}
                  totalCount={filteredMcpcfServers.length}
                  className="mt-3 justify-between text-xs"
                >
                  <Pagination.Info />
                  <Pagination.Separator />
                  <DialogPaginationPageSize
                    value={mcpcfPerPage}
                    onChange={(size) => setMcpcfPerPage(size)}
                    options={MCPCF_PAGE_SIZE_OPTIONS}
                  />
                  <Pagination.Controls controls="simple" />
                </Pagination>
              ) : null}
            </section>

            <section>
              <div className="mb-3">
                <h3 className="text-sm font-medium text-kumo-default">Custom MCPs</h3>
                <p className="mt-1 text-sm text-kumo-subtle">
                  Provide an MCP server object. This JSON is sent in the request body and merged
                  with any predefined internal MCPs used for selected knowledge sources.
                </p>
              </div>

              <LayerCard className="overflow-hidden rounded-xl">
                <LayerCard.Secondary className="my-0 flex items-center justify-between gap-3 px-3 py-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    {customMcpServerNames.length > 0 ? (
                      customMcpServerNames.map((serverName) => (
                        <Badge key={serverName} variant="secondary">
                          {serverName}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-kumo-subtle">No custom MCP servers</span>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setCustomMcpEditorOpen(true)}
                  >
                    Edit
                  </Button>
                </LayerCard.Secondary>
                <LayerCard.Primary className="gap-2 overflow-hidden rounded-lg p-0">
                  <CodeSurface
                    title="Custom MCP JSON"
                    value={draftCustomMcpText}
                    language="json"
                    mode="editable"
                    previewInteractive={false}
                    open={customMcpEditorOpen}
                    onOpenChange={setCustomMcpEditorOpen}
                    previewMinHeightClassName="min-h-0"
                    previewMaxHeightClassName="max-h-[calc(1.55*10*0.75rem+1.25rem)]"
                    onSave={(value) => {
                      setDraftCustomMcpText(value)
                      setCustomMcpError("")
                    }}
                  />
                  <p className="px-3 pb-3 text-xs text-kumo-subtle">
                    Supports `remote` and `local` MCP server definitions.
                  </p>
                </LayerCard.Primary>
              </LayerCard>
            </section>

            <section>
              <div className="mb-3">
                <h3 className="text-sm font-medium text-kumo-default">AI Search Content</h3>
                <p className="mt-1 text-sm text-kumo-subtle">
                  Add one or more internal MCP-backed sources to the session.
                </p>
              </div>

              <div className="space-y-1 rounded-xl bg-kumo-base p-1 ring-1 ring-kumo-line">
                {aiSearchSourcesError ? (
                  <Banner variant="error" description={aiSearchSourcesError} className="m-2" />
                ) : null}
                {aiSearchSourcesLoading ? (
                  <div className="flex h-24 items-center justify-center">
                    <S0Loader size={32} />
                  </div>
                ) : null}
                {!aiSearchSourcesLoading &&
                aiSearchSources.length === 0 &&
                !aiSearchSourcesError ? (
                  <div className="px-4 py-6 text-center text-sm text-kumo-subtle">
                    No AI Search sources are available.
                  </div>
                ) : null}
                {aiSearchSources.map((source) => {
                  const isSelected = selectedDocIds.has(source.id)

                  return (
                    <div
                      key={source.id}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left text-sm transition hover:bg-kumo-tint ${
                        isSelected ? "bg-kumo-tint/70" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-kumo-default">{source.label}</div>
                        <div className="mt-1 text-xs text-kumo-subtle">{source.description}</div>
                      </div>
                      <Button
                        type="button"
                        onClick={() => setDraftTools(toggleDocSource(draftTools, source.id))}
                        shape="circle"
                        variant={isSelected ? "primary" : "secondary"}
                        aria-label={`${isSelected ? "Remove" : "Add"} ${source.label}`}
                        icon={
                          isSelected ? (
                            <Check className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <Plus className="h-3.5 w-3.5" aria-hidden />
                          )
                        }
                      />
                    </div>
                  )
                })}
              </div>
            </section>
          </div>
        </div>

        <div className="border-t border-kumo-hairline px-5 py-4">
          {(stepLimitError || customMcpError || customMcpDraft.error || error) && (
            <Banner
              variant="error"
              description={stepLimitError || customMcpError || customMcpDraft.error || error}
              className="mb-3"
            />
          )}

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-kumo-subtle">{toolsSummary}</span>
            <div className="flex items-center gap-2">
              <Button type="button" onClick={onClose} variant="ghost">
                Cancel
              </Button>
              <Button
                type="button"
                disabled={saving}
                loading={saving}
                variant="primary"
                className="text-white"
                onClick={async () => {
                  if (!parsedCustomMcpServers) {
                    setCustomMcpError(customMcpDraft.error)
                    return
                  }
                  const stepLimitDraft = parseStepLimitDraft(draftIsolateStepLimit)
                  if (stepLimitDraft.stepLimit == null) {
                    setStepLimitError(stepLimitDraft.error ?? "Invalid step call limit")
                    return
                  }

                  try {
                    setCustomMcpError("")
                    setStepLimitError("")
                    await onSave({
                      tools: draftTools,
                      customMcpServers: parsedCustomMcpServers,
                      isolateStepLimit: stepLimitDraft.stepLimit,
                      subagents: draftSubagents,
                    })
                    onClose()
                  } catch (saveError) {
                    setCustomMcpError(
                      saveError instanceof Error
                        ? saveError.message
                        : "Invalid custom MCP configuration",
                    )
                  }
                }}
              >
                {saving ? "Saving..." : saveLabel}
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
