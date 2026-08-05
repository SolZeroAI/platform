"use client"

import { Badge, type BadgeVariant } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { Empty } from "@cloudflare/kumo/components/empty"
import { Input } from "@cloudflare/kumo/components/input"
import { Pagination } from "@cloudflare/kumo/components/pagination"
import { Select } from "@cloudflare/kumo/components/select"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import { useNavigate } from "@tanstack/react-router"
import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  SortingState,
  Table,
} from "@tanstack/react-table"
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { Archive, ChevronDown, ChevronsUpDown, Code2, Globe2, MessageSquare } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AGENT_RUNTIMES, formatAgentRuntimeLabel, resolveAgentRuntime } from "@solzero/shared"
import { S0Loader, TableCellState } from "@/components/s0-loader"
import {
  archiveSession,
  formatSessionLabel,
  getSessionSourceLabel,
  type ArchiveSessionFailure,
  type SessionItem,
} from "@/lib/session-list"
import { copyToClipboard } from "@/lib/format"
import { formatRelativeTime } from "@/lib/time"
import { appToastManager } from "@/lib/toast-manager"

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const
const FILTER_ALL = "all"
const SESSION_STATUS_OPTIONS = ["created", "active", "completed"] as const
const SESSION_SOURCE_OPTIONS = ["web", "api", "slack"] as const

interface SessionListResponse {
  sessions?: SessionItem[]
  total?: number
  limit?: number
  offset?: number
}

export function PreviousSessionsTable() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [archiveFailures, setArchiveFailures] = useState<ArchiveSessionFailure[]>([])
  const [archivingSessionIds, setArchivingSessionIds] = useState<Set<string>>(() => new Set())
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => new Set())
  const [globalFilter, setGlobalFilter] = useState("")
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([{ id: "updatedAt", desc: true }])
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const fetchSequenceRef = useRef(0)
  const lastLoadErrorToastRef = useRef("")
  const lastArchiveFailureToastRef = useRef("")

  const handleOpenSession = useCallback(
    (sessionId: string) => {
      void navigate({
        to: "/session/$id",
        params: { id: sessionId },
        search: { boot: undefined },
      })
    },
    [navigate],
  )

  const handleArchiveOne = useCallback(async (sessionId: string) => {
    setArchivingSessionIds((current) => new Set(current).add(sessionId))
    setArchiveFailures([])
    try {
      const failure = await archiveSession(sessionId)
      if (failure) {
        setArchiveFailures([failure])
        return
      }
      setSessions((current) => current.filter((session) => session.id !== sessionId))
      setTotal((current) => Math.max(0, current - 1))
      setSelectedSessionIds((current) => {
        const next = new Set(current)
        next.delete(sessionId)
        return next
      })
    } finally {
      setArchivingSessionIds((current) => {
        const next = new Set(current)
        next.delete(sessionId)
        return next
      })
    }
  }, [])

  const columns = useMemo<ColumnDef<SessionItem>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        header: () => {
          const pageIds = sessions.map((session) => session.id)
          const selectedVisibleCount = pageIds.filter((id) => selectedSessionIds.has(id)).length
          const checked = pageIds.length > 0 && selectedVisibleCount === pageIds.length
          return (
            <input
              type="checkbox"
              checked={checked}
              aria-label="Select all visible agents"
              onChange={(event) => {
                const nextChecked = event.target.checked
                setSelectedSessionIds((current) => {
                  const next = new Set(current)
                  for (const id of pageIds) {
                    if (nextChecked) {
                      next.add(id)
                    } else {
                      next.delete(id)
                    }
                  }
                  return next
                })
              }}
              className="h-4 w-4 rounded border-kumo-line text-kumo-brand"
            />
          )
        },
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selectedSessionIds.has(row.original.id)}
            aria-label={`Select ${getSessionTitle(row.original)}`}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              const nextChecked = event.target.checked
              setSelectedSessionIds((current) => {
                const next = new Set(current)
                if (nextChecked) {
                  next.add(row.original.id)
                } else {
                  next.delete(row.original.id)
                }
                return next
              })
            }}
            className="h-4 w-4 rounded border-kumo-line text-kumo-brand"
          />
        ),
      },
      {
        id: "title",
        accessorFn: getSessionTitle,
        header: "Agent",
        cell: ({ row }) => (
          <div className="max-w-md text-left">
            <div className="truncate text-sm font-medium text-kumo-default">
              {getSessionTitle(row.original)}
            </div>
            <div className="mt-1 truncate text-xs text-kumo-subtle">
              {formatSessionLabel(row.original)}
            </div>
            <UnavailableToolsBadge unavailableTools={row.original.unavailableTools} />
          </div>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "agentRuntime",
        accessorKey: "agentRuntime",
        header: "Runtime",
        cell: ({ row }) => formatSessionRuntime(row.original),
      },
      {
        id: "source",
        accessorKey: "source",
        header: "Source",
        cell: ({ row }) => <SourceLabel source={row.original.source} />,
      },
      {
        id: "repoOwner",
        accessorKey: "repoOwner",
        header: "Owner",
        cell: ({ row }) => row.original.repoOwner || "No repo",
      },
      {
        id: "repoName",
        accessorKey: "repoName",
        header: "Repo",
        cell: ({ row }) => row.original.repoName || "No repo",
      },
      {
        id: "model",
        accessorKey: "model",
        header: "Model",
        cell: ({ row }) => row.original.model ?? "Default",
      },
      {
        id: "updatedAt",
        accessorKey: "updatedAt",
        header: "Updated",
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatRelativeTime(row.original.updatedAt || row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        header: "",
        cell: ({ row }) => (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Archive ${getSessionTitle(row.original)}`}
            title="Archive agent"
            disabled={archivingSessionIds.has(row.original.id)}
            onClick={(event) => {
              event.stopPropagation()
              void handleArchiveOne(row.original.id)
            }}
            icon={
              archivingSessionIds.has(row.original.id) ? (
                <S0Loader size={16} />
              ) : (
                <Archive className="h-4 w-4" aria-hidden />
              )
            }
          />
        ),
      },
    ],
    [archivingSessionIds, handleArchiveOne, selectedSessionIds, sessions],
  )

  const table = useReactTable({
    data: sessions,
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

  const loadSessions = useCallback(
    async (signal: AbortSignal) => {
      const sequence = fetchSequenceRef.current + 1
      fetchSequenceRef.current = sequence
      setLoading(true)
      setError("")
      setArchiveFailures([])

      const params = new URLSearchParams({
        excludeStatus: "archived",
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
        const response = await fetch(`/api/sessions?${params.toString()}`, { signal })
        const data = (await response.json().catch(() => ({}))) as SessionListResponse & {
          error?: string
        }
        if (!response.ok) {
          throw new Error(data.error ?? `Request failed with status ${response.status}`)
        }
        if (fetchSequenceRef.current !== sequence) {
          return
        }
        setSessions(Array.isArray(data.sessions) ? data.sessions : [])
        setTotal(typeof data.total === "number" ? data.total : 0)
      } catch (errorValue) {
        if (errorValue instanceof Error && errorValue.name === "AbortError") {
          return
        }
        setError(errorValue instanceof Error ? errorValue.message : "Failed to load agents")
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
      void loadSessions(controller.signal)
    }, 200)
    return () => {
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [loadSessions])

  useEffect(() => {
    if (!error || lastLoadErrorToastRef.current === error) {
      return
    }
    lastLoadErrorToastRef.current = error
    addSessionErrorToast("Could not load previous sessions", error)
  }, [error])

  useEffect(() => {
    if (archiveFailures.length === 0) {
      return
    }
    const key = archiveFailures
      .map((failure) => `${failure.sessionId}:${failure.status ?? "network"}:${failure.message}`)
      .join("|")
    if (lastArchiveFailureToastRef.current === key) {
      return
    }
    lastArchiveFailureToastRef.current = key
    const firstFailure = archiveFailures[0]
    addSessionErrorToast(
      `${archiveFailures.length} archive ${
        archiveFailures.length === 1 ? "request" : "requests"
      } failed`,
      archiveFailures.length === 1 && firstFailure
        ? firstFailure.message
        : firstFailure
          ? `First failure: ${firstFailure.message}`
          : undefined,
    )
  }, [archiveFailures])

  useEffect(() => {
    setSelectedSessionIds((current) => {
      const available = new Set(sessions.map((session) => session.id))
      const next = new Set([...current].filter((id) => available.has(id)))
      return next.size === current.size ? current : next
    })
  }, [sessions])

  const handleArchiveSelected = useCallback(async () => {
    const sessionIds = [...selectedSessionIds]
    if (sessionIds.length === 0) {
      return
    }
    setArchiveFailures([])
    setArchivingSessionIds((current) => {
      const next = new Set(current)
      for (const id of sessionIds) {
        next.add(id)
      }
      return next
    })

    try {
      const results = await Promise.all(
        sessionIds.map(async (sessionId) => {
          const failure = await archiveSession(sessionId)
          return failure ?? { sessionId, archived: true as const }
        }),
      )
      const archivedSessionIds = new Set(
        results
          .filter((result): result is { sessionId: string; archived: true } => "archived" in result)
          .map((result) => result.sessionId),
      )
      const failures = results.filter(
        (result): result is ArchiveSessionFailure => !("archived" in result),
      )

      if (archivedSessionIds.size > 0) {
        setSessions((current) => current.filter((session) => !archivedSessionIds.has(session.id)))
        setTotal((current) => Math.max(0, current - archivedSessionIds.size))
        setSelectedSessionIds((current) => {
          const next = new Set(current)
          for (const id of archivedSessionIds) {
            next.delete(id)
          }
          return next
        })
      }
      setArchiveFailures(failures)
    } finally {
      setArchivingSessionIds((current) => {
        const next = new Set(current)
        for (const id of sessionIds) {
          next.delete(id)
        }
        return next
      })
    }
  }, [selectedSessionIds])

  const rows = table.getRowModel().rows
  const selectedCount = selectedSessionIds.size
  const isBulkArchiving = [...selectedSessionIds].some((id) => archivingSessionIds.has(id))

  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-14 sm:px-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-kumo-default">Previous sessions</h2>
          <p className="mt-1 text-sm text-kumo-subtle">
            Search, filter, sort, and reopen prior agent sessions.
          </p>
        </div>
        {selectedCount > 0 ? (
          <Button
            type="button"
            variant="secondary-destructive"
            disabled={isBulkArchiving}
            onClick={() => void handleArchiveSelected()}
            icon={
              isBulkArchiving ? <S0Loader size={16} /> : <Archive className="h-4 w-4" aria-hidden />
            }
          >
            Archive {selectedCount}
          </Button>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={globalFilter}
          onChange={(event) => table.setGlobalFilter(event.target.value)}
          placeholder="Search agents"
          aria-label="Search agents"
          className="min-w-[260px]"
          passwordManagerIgnore
        />
        <FilterSelect table={table} id="status" label="Status" options={SESSION_STATUS_OPTIONS} />
        <FilterSelect table={table} id="agentRuntime" label="Runtime" options={AGENT_RUNTIMES} />
        <FilterSelect table={table} id="source" label="Source" options={SESSION_SOURCE_OPTIONS} />
        <FilterInput table={table} id="repoOwner" placeholder="Repo owner" />
        <FilterInput table={table} id="repoName" placeholder="Repo name" />
      </div>

      <div className="overflow-auto rounded-xl bg-kumo-elevated/80 [container-type:inline-size]">
        <KumoTable className="min-w-[960px] text-left text-sm">
          <KumoTable.Header sticky className="bg-kumo-tint text-xs">
            {table.getHeaderGroups().map((headerGroup) => (
              <KumoTable.Row key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isActions = header.column.id === "actions"
                  return (
                    <KumoTable.Head
                      key={header.id}
                      sticky={isActions ? "right" : undefined}
                      className={
                        isActions
                          ? "bg-kumo-tint! px-3 py-2 text-right font-medium"
                          : "bg-kumo-tint px-3 py-2 font-medium"
                      }
                    >
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
                  )
                })}
              </KumoTable.Row>
            ))}
          </KumoTable.Header>
          <KumoTable.Body>
            {rows.length === 0 ? (
              <KumoTable.Row className="bg-kumo-base">
                <KumoTable.Cell
                  colSpan={table.getAllLeafColumns().length}
                  className="h-56 border-b border-kumo-hairline px-3 py-3 text-sm text-kumo-subtle"
                >
                  <TableCellState className="h-full">
                    {loading ? (
                      <S0Loader size={32} />
                    ) : (
                      <Empty
                        title="No agents found."
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
                  className="session-table-row bg-kumo-base transition"
                  onClick={() => handleOpenSession(row.original.id)}
                >
                  {row.getVisibleCells().map((cell) => {
                    const isActions = cell.column.id === "actions"
                    return (
                      <KumoTable.Cell
                        key={cell.id}
                        sticky={isActions ? "right" : undefined}
                        className={
                          isActions
                            ? "border-b border-kumo-hairline bg-kumo-base! px-3 py-3 text-right align-middle"
                            : "border-b border-kumo-hairline px-3 py-3 align-middle"
                        }
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </KumoTable.Cell>
                    )
                  })}
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
    </section>
  )
}

function FilterSelect<TData>({
  table,
  id,
  label,
  options,
}: {
  table: Table<TData>
  id: string
  label: string
  options: readonly string[]
}) {
  const allLabel = `All ${label.toLowerCase()}`
  return (
    <Select
      value={getTableFilter(table, id) || FILTER_ALL}
      onValueChange={(value) =>
        setTableFilter(table, id, value === FILTER_ALL ? "" : String(value ?? ""))
      }
      renderValue={(value) => formatFilterSelectValue(allLabel, value)}
      aria-label={label}
    >
      <Select.Option value={FILTER_ALL}>{allLabel}</Select.Option>
      {options.map((option) => (
        <Select.Option key={option} value={option}>
          {option}
        </Select.Option>
      ))}
    </Select>
  )
}

function formatFilterSelectValue(allLabel: string, value: unknown): string {
  const normalized = String(value ?? "")
  return normalized === FILTER_ALL || normalized === "" ? allLabel : normalized
}

function FilterInput<TData>({
  table,
  id,
  placeholder,
}: {
  table: Table<TData>
  id: string
  placeholder: string
}) {
  return (
    <Input
      value={getTableFilter(table, id)}
      onChange={(event) => setTableFilter(table, id, event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="min-w-[150px]"
      passwordManagerIgnore
    />
  )
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

function SourceLabel({ source }: { source: SessionItem["source"] }) {
  const Icon = source === "api" ? Code2 : source === "slack" ? MessageSquare : Globe2
  return (
    <span className="inline-flex items-center gap-1.5 text-kumo-subtle">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {getSessionSourceLabel(source).replace("Started from ", "")}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase()
  const variant: BadgeVariant =
    normalized === "completed" || normalized === "active"
      ? "success"
      : normalized === "archived"
        ? "secondary"
        : "warning"
  return (
    <Badge variant={variant} className="uppercase">
      {status}
    </Badge>
  )
}

function UnavailableToolsBadge({ unavailableTools }: Pick<SessionItem, "unavailableTools">) {
  if (!unavailableTools || unavailableTools.length === 0) {
    return null
  }

  const details = unavailableTools
    .map((tool) => {
      const label = tool.toolId ?? tool.kind ?? "stored tool"
      return `${label}: ${tool.reason.replaceAll("_", " ")}`
    })
    .join("\n")

  return (
    <span title={details}>
      <Badge variant="warning" className="mt-1">
        {unavailableTools.length} unavailable {unavailableTools.length === 1 ? "tool" : "tools"}
      </Badge>
    </span>
  )
}

function getSessionTitle(session: SessionItem): string {
  return session.title || formatSessionLabel(session)
}

function formatSessionRuntime(session: SessionItem): string {
  return formatAgentRuntimeLabel(
    resolveAgentRuntime({
      agentRuntime: session.agentRuntime,
      sessionKind: session.sessionKind,
    }),
  )
}

function getTableFilter<TData>(table: Table<TData>, id: string): string {
  const value = table.getColumn(id)?.getFilterValue()
  return typeof value === "string" ? value : ""
}

function setTableFilter<TData>(table: Table<TData>, id: string, value: string) {
  table.getColumn(id)?.setFilterValue(value)
}

function applyUpdater<T>(updater: T | ((current: T) => T), current: T): T {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater
}

function addSessionErrorToast(title: string, description?: string) {
  const copyText = description ? `${title}\n${description}` : title
  appToastManager.add({
    title,
    description,
    variant: "error",
    timeout: 8000,
    actions: [
      {
        children: "Copy",
        size: "sm",
        variant: "ghost",
        onClick: () => void copyToClipboard(copyText),
      },
    ],
  })
}
