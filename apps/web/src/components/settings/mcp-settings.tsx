"use client"

import { Banner } from "@cloudflare/kumo/components/banner"
import { Button } from "@cloudflare/kumo/components/button"
import { Checkbox } from "@cloudflare/kumo/components/checkbox"
import { Empty } from "@cloudflare/kumo/components/empty"
import { Input } from "@cloudflare/kumo/components/input"
import { Pagination } from "@cloudflare/kumo/components/pagination"
import { Select } from "@cloudflare/kumo/components/select"
import { SensitiveInput } from "@cloudflare/kumo/components/sensitive-input"
import { Switch } from "@cloudflare/kumo/components/switch"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  SortingState,
  Table,
} from "@tanstack/react-table"
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { AlertCircle, CheckCircle2, ChevronDown, ChevronsUpDown, Pencil, Save } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { C0Loader, TableCellState } from "@/components/c0-loader"
import { Dialog } from "@/components/ui/dialog"

interface McpToolPreview {
  name: string
  description?: string
}

interface McpServerSettings {
  id: string
  slug: string
  label: string
  description: string
  authType: string | null
  authLabel: string | null
  gatewayAuthType?: string | null
  gatewayAuthLabel?: string | null
  upstreamAuthType?: string | null
  upstreamAuthLabel?: string | null
  gatewayAuthTokenRequired: boolean
  gatewayAuthTokenConfigured: boolean
  upstreamAuthTokenRequired: boolean
  upstreamAuthTokenConfigured: boolean
  authTokenRequired: boolean
  authTokenConfigured: boolean
  configuredForUser: boolean
  contextForgeUrl?: string
  contextForgeApiKeysUrl?: string
  toolCount: number
  defaultToolsEnabled: boolean
  disabledTools: string[]
  tools: McpToolPreview[]
}

interface DraftState {
  upstreamAuthToken: string
  clearUpstreamAuthToken: boolean
  defaultToolsEnabled: boolean
  disabledTools: string[]
}

interface McpSettingsProps {
  initialQuery?: string
  selectedServerId?: string
  selectedServerLabel?: string
}

interface McpSettingsListResponse {
  servers?: McpServerSettings[]
  total?: number
  limit?: number
  offset?: number
  error?: string
}

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const
const FILTER_ALL = "all"
const AUTH_FILTER_OPTIONS = ["oauth", "token", "other"] as const
const CONFIGURED_FILTER_OPTIONS = ["configured", "needs_config"] as const
const DEFAULT_TOOLS_FILTER_OPTIONS = ["enabled", "disabled"] as const
const contextForgeAccountSettingsPath = "/settings?category=api-access#contextforge-api-token"

function authTypeLabel(server: McpServerSettings): string {
  return (
    server.gatewayAuthLabel ??
    server.authLabel ??
    server.gatewayAuthType ??
    server.authType ??
    "Unknown"
  )
}

function gatewayAuthType(server: McpServerSettings): string {
  return (server.gatewayAuthType ?? server.authType ?? "").toLowerCase()
}

function upstreamAuthLabel(server: McpServerSettings): string {
  return server.upstreamAuthLabel ?? server.upstreamAuthType ?? "None"
}

function contextForgeAuthConfigured(server: McpServerSettings): boolean {
  if (server.gatewayAuthTokenRequired) {
    return server.gatewayAuthTokenConfigured
  }
  return server.configuredForUser
}

function configuredLabel(server: McpServerSettings): string {
  if (server.gatewayAuthTokenRequired && !server.gatewayAuthTokenConfigured) {
    return "API token needed"
  }
  if (server.upstreamAuthTokenRequired && !server.upstreamAuthTokenConfigured) {
    return "Token needed"
  }
  if (gatewayAuthType(server) === "oauth") {
    return server.configuredForUser ? "Linked" : "Not linked"
  }
  if (server.configuredForUser) {
    return "Configured"
  }
  return "Unavailable"
}

function createDraft(server: McpServerSettings): DraftState {
  return {
    upstreamAuthToken: "",
    clearUpstreamAuthToken: false,
    defaultToolsEnabled: server.defaultToolsEnabled,
    disabledTools: server.disabledTools,
  }
}

function findDeepLinkedServer(input: {
  servers: McpServerSettings[]
  selectedServerId?: string
  selectedServerLabel?: string
}): McpServerSettings | undefined {
  if (input.selectedServerId) {
    const selectedServerId = input.selectedServerId.toLowerCase()
    const server = input.servers.find(
      (candidate) =>
        candidate.id.toLowerCase() === selectedServerId ||
        candidate.slug.toLowerCase() === selectedServerId,
    )
    if (server) {
      return server
    }
  }

  if (!input.selectedServerLabel) {
    return undefined
  }

  const selectedServerLabel = input.selectedServerLabel.toLowerCase()
  return input.servers.find(
    (candidate) =>
      candidate.label.toLowerCase() === selectedServerLabel ||
      candidate.slug.toLowerCase() === selectedServerLabel,
  )
}

function activeToolCount(server: McpServerSettings): number {
  if (!server.defaultToolsEnabled) {
    return 0
  }
  return Math.max(0, server.toolCount - server.disabledTools.length)
}

function formatApiError(message: string | undefined, fallback: string): string {
  if (!message) {
    return fallback
  }
  if (/^(Failed query:|SQLITE_ERROR)|no such table/i.test(message)) {
    return fallback
  }
  return message
}

function formatCaughtError(errorValue: unknown, fallback: string): string {
  const message = errorValue instanceof Error ? errorValue.message : String(errorValue)
  return formatApiError(message, fallback)
}

function applyUpdater<T>(updater: T | ((current: T) => T), current: T): T {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater
}

function getTableFilter<TData>(table: Table<TData>, id: string): string {
  const value = table.getColumn(id)?.getFilterValue()
  return typeof value === "string" ? value : ""
}

function setTableFilter<TData>(table: Table<TData>, id: string, value: string) {
  table.getColumn(id)?.setFilterValue(value)
}

function formatFilterSelectValue(allLabel: string, value: unknown): string {
  const normalized = String(value ?? "")
  return normalized === FILTER_ALL || normalized === "" ? allLabel : normalized
}

function formatAuthFilterLabel(value: string): string {
  if (value === "token") {
    return "MCPCF token"
  }
  if (value === "oauth") {
    return "OAuth"
  }
  if (value === "other") {
    return "Other"
  }
  return value
}

function formatConfiguredFilterLabel(value: string): string {
  if (value === "needs_config") {
    return "Needs config"
  }
  if (value === "configured") {
    return "Configured"
  }
  return value
}

function formatDefaultToolsFilterLabel(value: string): string {
  if (value === "enabled") {
    return "Enabled"
  }
  if (value === "disabled") {
    return "Disabled"
  }
  return value
}

function SortIcon({ direction }: { direction: false | "asc" | "desc" }) {
  if (direction === "asc") {
    return <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden />
  }
  if (direction === "desc") {
    return <ChevronDown className="h-3.5 w-3.5" aria-hidden />
  }
  return <ChevronsUpDown className="h-3.5 w-3.5 text-kumo-subtle" aria-hidden />
}

function FilterSelect<TData>({
  table,
  id,
  label,
  options,
  formatOption,
}: {
  table: Table<TData>
  id: string
  label: string
  options: readonly string[]
  formatOption?: (value: string) => string
}) {
  const allLabel = `All ${label.toLowerCase()}`
  return (
    <Select
      value={getTableFilter(table, id) || FILTER_ALL}
      onValueChange={(value) =>
        setTableFilter(table, id, value === FILTER_ALL ? "" : String(value ?? ""))
      }
      renderValue={(value) => {
        const normalized = String(value ?? "")
        if (normalized === FILTER_ALL || normalized === "") {
          return allLabel
        }
        return formatOption ? formatOption(normalized) : formatFilterSelectValue(allLabel, value)
      }}
      aria-label={label}
    >
      <Select.Option value={FILTER_ALL}>{allLabel}</Select.Option>
      {options.map((option) => (
        <Select.Option key={option} value={option}>
          {formatOption ? formatOption(option) : option}
        </Select.Option>
      ))}
    </Select>
  )
}

export function McpSettings({
  initialQuery,
  selectedServerId,
  selectedServerLabel,
}: McpSettingsProps = {}) {
  const [servers, setServers] = useState<McpServerSettings[]>([])
  const [total, setTotal] = useState(0)
  const [selectedServer, setSelectedServer] = useState<McpServerSettings | null>(null)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [globalFilter, setGlobalFilter] = useState(
    initialQuery ?? selectedServerLabel ?? selectedServerId ?? "",
  )
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([{ id: "label", desc: false }])
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const fetchSequenceRef = useRef(0)
  const autoSelectedTargetRef = useRef<string | null>(null)

  const selectedServerControlsDisabled = Boolean(
    selectedServer?.gatewayAuthTokenRequired && !selectedServer.gatewayAuthTokenConfigured,
  )

  const columns = useMemo<ColumnDef<McpServerSettings>[]>(
    () => [
      {
        id: "label",
        accessorKey: "label",
        header: "Name",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-kumo-default">{row.original.label}</div>
            <div className="mt-0.5 max-w-xs truncate text-xs text-kumo-subtle">
              {row.original.description}
            </div>
          </div>
        ),
      },
      {
        id: "auth",
        accessorFn: authTypeLabel,
        header: "Auth",
        cell: ({ row }) => <span className="text-kumo-subtle">{authTypeLabel(row.original)}</span>,
      },
      {
        id: "configured",
        accessorKey: "configuredForUser",
        header: "User Config",
        cell: ({ row }) => (
          <span
            className={`inline-flex items-center gap-1.5 text-xs ${
              row.original.configuredForUser ? "text-kumo-success" : "text-kumo-warning"
            }`}
          >
            {row.original.configuredForUser ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <AlertCircle className="h-3.5 w-3.5" aria-hidden />
            )}
            {configuredLabel(row.original)}
          </span>
        ),
      },
      {
        id: "tools",
        accessorFn: activeToolCount,
        header: "Tools",
        cell: ({ row }) => (
          <span className="text-kumo-subtle tabular-nums">
            {activeToolCount(row.original)} / {row.original.toolCount}
          </span>
        ),
      },
      {
        id: "defaultTools",
        accessorKey: "defaultToolsEnabled",
        header: "Default",
        cell: ({ row }) => (
          <span className="text-kumo-subtle">
            {row.original.defaultToolsEnabled ? "Enabled" : "Disabled"}
          </span>
        ),
      },
    ],
    [],
  )

  const table = useReactTable({
    data: servers,
    columns,
    rowCount: total,
    enableMultiSort: false,
    manualFiltering: true,
    manualPagination: true,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
    state: {
      globalFilter,
      columnFilters,
      sorting,
      pagination,
    },
    onGlobalFilterChange: (updater) => {
      setGlobalFilter((current) => applyUpdater(updater, current))
      setPagination((current) => ({ ...current, pageIndex: 0 }))
    },
    onColumnFiltersChange: (updater) => {
      setColumnFilters((current) => applyUpdater(updater, current))
      setPagination((current) => ({ ...current, pageIndex: 0 }))
    },
    onSortingChange: (updater) => {
      setSorting((current) => applyUpdater(updater, current).slice(0, 1))
      setPagination((current) => ({ ...current, pageIndex: 0 }))
    },
    onPaginationChange: setPagination,
  })

  const loadServers = useCallback(
    async (signal: AbortSignal) => {
      const sequence = fetchSequenceRef.current + 1
      fetchSequenceRef.current = sequence
      setLoading(true)
      setErrorMessage(null)

      const params = new URLSearchParams({
        limit: String(pagination.pageSize),
        offset: String(pagination.pageIndex * pagination.pageSize),
      })
      const trimmedSearch = globalFilter.trim()
      if (trimmedSearch) {
        params.set("q", trimmedSearch)
      }
      for (const filter of columnFilters) {
        if (typeof filter.value === "string" && filter.value.trim()) {
          params.set(filter.id, filter.value.trim())
        }
      }
      const [sort] = sorting
      if (sort) {
        params.set("sortBy", sort.id)
        params.set("sortDir", sort.desc ? "desc" : "asc")
      }

      try {
        const response = await fetch(`/api/sessions/mcpcf/settings?${params.toString()}`, {
          signal,
        })
        const payload = (await response.json().catch(() => ({}))) as McpSettingsListResponse
        if (!response.ok) {
          throw new Error(formatApiError(payload.error, "Failed to load MCP settings."))
        }
        if (fetchSequenceRef.current !== sequence) {
          return
        }
        setServers(Array.isArray(payload.servers) ? payload.servers : [])
        setTotal(typeof payload.total === "number" ? payload.total : 0)
      } catch (errorValue) {
        if (errorValue instanceof Error && errorValue.name === "AbortError") {
          return
        }
        setErrorMessage(formatCaughtError(errorValue, "Failed to load MCP settings."))
      } finally {
        if (fetchSequenceRef.current === sequence) {
          setLoading(false)
        }
      }
    },
    [columnFilters, globalFilter, pagination.pageIndex, pagination.pageSize, sorting],
  )

  useEffect(() => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      void loadServers(controller.signal)
    }, 200)
    return () => {
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [loadServers])

  useEffect(() => {
    setGlobalFilter(initialQuery ?? selectedServerLabel ?? selectedServerId ?? "")
  }, [initialQuery, selectedServerId, selectedServerLabel])

  const openServer = useCallback((server: McpServerSettings) => {
    setSelectedServer(server)
    setDraft(createDraft(server))
    setStatusMessage(null)
    setErrorMessage(null)
  }, [])

  useEffect(() => {
    const targetKey = selectedServerId
      ? `id:${selectedServerId}`
      : selectedServerLabel
        ? `label:${selectedServerLabel}`
        : null
    if (!targetKey || autoSelectedTargetRef.current === targetKey) {
      return
    }

    const server = findDeepLinkedServer({
      servers,
      selectedServerId,
      selectedServerLabel,
    })
    if (!server) {
      return
    }

    autoSelectedTargetRef.current = targetKey
    openServer(server)
  }, [openServer, selectedServerId, selectedServerLabel, servers])

  const closePanel = () => {
    setSelectedServer(null)
    setDraft(null)
  }

  const toggleTool = (toolName: string, enabled: boolean) => {
    if (selectedServerControlsDisabled) {
      return
    }
    setDraft((current) => {
      if (!current) {
        return current
      }
      const disabled = new Set(current.disabledTools)
      if (enabled) {
        disabled.delete(toolName)
      } else {
        disabled.add(toolName)
      }
      return {
        ...current,
        disabledTools: [...disabled].sort((left, right) => left.localeCompare(right)),
      }
    })
  }

  const saveSelectedServer = async () => {
    if (!selectedServer || !draft || selectedServerControlsDisabled) {
      return
    }
    setSaving(true)
    setStatusMessage(null)
    setErrorMessage(null)
    try {
      const response = await fetch(
        `/api/sessions/mcpcf/${encodeURIComponent(selectedServer.id)}/settings`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            authToken: draft.upstreamAuthToken.trim() || undefined,
            clearAuthToken: draft.clearUpstreamAuthToken,
            defaultToolsEnabled: draft.defaultToolsEnabled,
            disabledTools: draft.defaultToolsEnabled
              ? draft.disabledTools
              : selectedServer.tools.map((tool) => tool.name),
          }),
        },
      )
      const payload = (await response.json().catch(() => ({}))) as {
        server?: McpServerSettings
        error?: string
      }
      if (!response.ok || !payload.server) {
        throw new Error(formatApiError(payload.error, "Failed to save MCP settings."))
      }
      setSelectedServer(payload.server)
      setDraft(createDraft(payload.server))
      setStatusMessage(`${payload.server.label} updated.`)
      void loadServers(new AbortController().signal)
    } catch (errorValue) {
      setErrorMessage(formatCaughtError(errorValue, "Failed to save MCP settings."))
    } finally {
      setSaving(false)
    }
  }

  const rows = table.getRowModel().rows

  return (
    <div>
      <p className="mb-6 text-sm text-kumo-subtle">
        Manage MCP credentials and default tool availability for new agent sessions.
      </p>

      {statusMessage && <Banner variant="secondary" description={statusMessage} className="mb-4" />}
      {errorMessage && <Banner variant="error" description={errorMessage} className="mb-4" />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={globalFilter}
          onChange={(event) => table.setGlobalFilter(event.target.value)}
          placeholder="Search MCPs"
          aria-label="Search MCPs"
          className="min-w-[260px]"
          passwordManagerIgnore
        />
        <FilterSelect
          table={table}
          id="auth"
          label="Auth"
          options={AUTH_FILTER_OPTIONS}
          formatOption={formatAuthFilterLabel}
        />
        <FilterSelect
          table={table}
          id="configured"
          label="Config"
          options={CONFIGURED_FILTER_OPTIONS}
          formatOption={formatConfiguredFilterLabel}
        />
        <FilterSelect
          table={table}
          id="defaultTools"
          label="Defaults"
          options={DEFAULT_TOOLS_FILTER_OPTIONS}
          formatOption={formatDefaultToolsFilterLabel}
        />
      </div>

      <div className="overflow-auto rounded-xl bg-kumo-elevated/80 [container-type:inline-size]">
        <KumoTable className="min-w-[760px] text-left text-sm">
          <KumoTable.Header sticky className="bg-kumo-tint text-xs">
            {table.getHeaderGroups().map((headerGroup) => (
              <KumoTable.Row key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <KumoTable.Head key={header.id} className="bg-kumo-tint px-3 py-2 font-medium">
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        disabled={!header.column.getCanSort()}
                        className="flex items-center gap-1 text-left disabled:cursor-default"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() ? (
                          <SortIcon direction={header.column.getIsSorted()} />
                        ) : null}
                      </button>
                    )}
                  </KumoTable.Head>
                ))}
              </KumoTable.Row>
            ))}
          </KumoTable.Header>
          <KumoTable.Body>
            {rows.length === 0 ? (
              <KumoTable.Row className="bg-kumo-base">
                <KumoTable.Cell
                  colSpan={table.getAllLeafColumns().length}
                  className="h-32 px-3 py-3 text-kumo-subtle"
                >
                  <TableCellState className="h-full">
                    {loading ? (
                      <C0Loader size={32} />
                    ) : (
                      <Empty
                        title="No MCP servers found"
                        description="Adjust search, filters, or pagination."
                      />
                    )}
                  </TableCellState>
                </KumoTable.Cell>
              </KumoTable.Row>
            ) : (
              rows.map((row) => (
                <KumoTable.Row
                  key={row.id}
                  tabIndex={0}
                  onClick={() => openServer(row.original)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      openServer(row.original)
                    }
                  }}
                  className={`cursor-pointer transition hover:bg-kumo-tint focus:bg-kumo-tint focus:outline-none ${
                    row.original.configuredForUser ? "bg-kumo-base" : "bg-kumo-tint"
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <KumoTable.Cell
                      key={cell.id}
                      className="border-b border-kumo-hairline px-3 py-2 align-middle"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </KumoTable.Cell>
                  ))}
                </KumoTable.Row>
              ))
            )}
          </KumoTable.Body>
        </KumoTable>
      </div>

      <Pagination
        page={pagination.pageIndex + 1}
        setPage={(page) => {
          if (!loading) {
            table.setPageIndex(page - 1)
          }
        }}
        perPage={pagination.pageSize}
        totalCount={total}
        className="mt-3 justify-between"
      >
        <Pagination.Info />
        <Pagination.Separator />
        <Pagination.PageSize
          value={pagination.pageSize}
          onChange={(size) => {
            if (!loading) {
              table.setPageSize(size)
            }
          }}
          options={[...PAGE_SIZE_OPTIONS]}
        />
        <Pagination.Controls controls="simple" />
      </Pagination>

      <Dialog.Root
        open={Boolean(selectedServer && draft)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !saving) {
            closePanel()
          }
        }}
      >
        {selectedServer && draft ? (
          <Dialog className="flex max-h-[85vh] w-full max-w-xl flex-col p-0">
            <div className="border-b border-kumo-hairline px-5 py-4">
              <Dialog.Title className="truncate text-base font-semibold text-kumo-default">
                {selectedServer.label}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-kumo-subtle">
                {authTypeLabel(selectedServer)} / {selectedServer.toolCount} tools
              </Dialog.Description>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <p className="mb-5 text-sm text-kumo-subtle">{selectedServer.description}</p>

              <section className="mb-6">
                <h4 className="mb-2 text-sm font-medium text-kumo-default">Authentication</h4>
                <div className="overflow-hidden rounded-xl border border-kumo-hairline text-sm">
                  <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
                    <div className="min-w-0 text-kumo-subtle">Context Forge Auth</div>
                    <a
                      href={contextForgeAccountSettingsPath}
                      className={`-mr-2 inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-right font-medium transition hover:bg-kumo-tint ${
                        contextForgeAuthConfigured(selectedServer)
                          ? "text-kumo-success hover:text-kumo-success"
                          : "text-kumo-danger hover:text-kumo-danger"
                      }`}
                      title={
                        contextForgeAuthConfigured(selectedServer)
                          ? "Edit Context Forge authentication"
                          : "Configure Context Forge authentication"
                      }
                      aria-label={
                        contextForgeAuthConfigured(selectedServer)
                          ? "Edit Context Forge authentication"
                          : "Configure Context Forge authentication"
                      }
                    >
                      <span className="truncate">
                        {contextForgeAuthConfigured(selectedServer)
                          ? "Configured"
                          : "Not configured"}
                      </span>
                      <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    </a>
                  </div>
                  <div
                    className={`grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 ${
                      selectedServer.upstreamAuthTokenRequired
                        ? ""
                        : "bg-kumo-tint text-kumo-subtle opacity-60"
                    }`}
                  >
                    <div className="min-w-0">Passthrough token auth</div>
                    <div className="text-right">
                      {selectedServer.upstreamAuthTokenRequired
                        ? upstreamAuthLabel(selectedServer)
                        : "Not supported"}
                    </div>
                  </div>
                </div>

                {selectedServer.upstreamAuthTokenRequired && (
                  <div className={selectedServer.gatewayAuthTokenRequired ? "mt-4" : ""}>
                    <div className="mb-2 text-xs text-kumo-subtle">
                      {selectedServer.upstreamAuthTokenConfigured
                        ? "An upstream user token is configured for this MCP."
                        : "An upstream user token is required before this MCP can call its target service."}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <SensitiveInput
                        value={draft.upstreamAuthToken}
                        onValueChange={(value) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  upstreamAuthToken: value,
                                  clearUpstreamAuthToken: false,
                                }
                              : current,
                          )
                        }
                        placeholder={
                          selectedServer.upstreamAuthTokenConfigured
                            ? "Leave blank to keep token"
                            : "Upstream user token"
                        }
                        aria-label="Upstream user token"
                        className="min-w-0 flex-1"
                      />
                      {selectedServer.upstreamAuthTokenConfigured && (
                        <Checkbox
                          label="Clear"
                          checked={draft.clearUpstreamAuthToken}
                          onCheckedChange={(checked) =>
                            setDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    clearUpstreamAuthToken: checked,
                                    upstreamAuthToken: checked ? "" : current.upstreamAuthToken,
                                  }
                                : current,
                            )
                          }
                        />
                      )}
                    </div>
                  </div>
                )}
              </section>

              <section
                className={`mb-6 ${selectedServerControlsDisabled ? "opacity-50" : ""}`}
                aria-disabled={selectedServerControlsDisabled}
              >
                <h4 className="mb-2 text-sm font-medium text-kumo-default">Session Defaults</h4>
                <div className="rounded-xl border border-kumo-hairline px-3 py-2">
                  <Switch
                    label="Enable tools by default"
                    checked={draft.defaultToolsEnabled}
                    disabled={selectedServerControlsDisabled}
                    controlFirst={false}
                    onCheckedChange={(checked) =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              defaultToolsEnabled: checked,
                              disabledTools: checked ? [] : current.disabledTools,
                            }
                          : current,
                      )
                    }
                  />
                </div>
              </section>

              <section
                className={selectedServerControlsDisabled ? "opacity-50" : ""}
                aria-disabled={selectedServerControlsDisabled}
              >
                <h4 className="mb-2 text-sm font-medium text-kumo-default">Tools</h4>
                <div className="overflow-hidden rounded-xl border border-kumo-hairline">
                  {selectedServer.tools.length === 0 ? (
                    <div className="px-3 py-8 text-center text-sm text-kumo-subtle">
                      No tools are registered for this MCP.
                    </div>
                  ) : (
                    selectedServer.tools.map((tool) => {
                      const enabled =
                        draft.defaultToolsEnabled && !draft.disabledTools.includes(tool.name)
                      return (
                        <label
                          key={tool.name}
                          className={`flex items-start gap-3 border-b border-kumo-hairline px-3 py-2 last:border-b-0 ${
                            selectedServerControlsDisabled ? "cursor-not-allowed" : ""
                          }`}
                        >
                          <Checkbox
                            aria-label={`Enable ${tool.name}`}
                            checked={enabled}
                            disabled={selectedServerControlsDisabled || !draft.defaultToolsEnabled}
                            onCheckedChange={(checked) => toggleTool(tool.name, checked)}
                            className="mt-1"
                          />
                          <span className="min-w-0">
                            <span className="block break-all text-sm text-kumo-default">
                              {tool.name}
                            </span>
                            {tool.description && (
                              <span className="mt-0.5 block text-xs text-kumo-subtle">
                                {tool.description}
                              </span>
                            )}
                          </span>
                        </label>
                      )
                    })
                  )}
                </div>
              </section>
            </div>

            <footer className="flex justify-end gap-2 border-t border-kumo-hairline px-5 py-4">
              <Button type="button" onClick={closePanel} disabled={saving} variant="ghost">
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void saveSelectedServer()}
                disabled={saving || selectedServerControlsDisabled}
                loading={saving}
                variant="primary"
                className="text-white"
                icon={<Save className="h-4 w-4" aria-hidden />}
              >
                {saving ? "Saving..." : "Save MCP"}
              </Button>
            </footer>
          </Dialog>
        ) : null}
      </Dialog.Root>
    </div>
  )
}
