import { type ColumnFiltersState, type Table, type Updater } from "@tanstack/react-table"
import { formatAgentRuntimeLabel, resolveAgentRuntime } from "@c0-agent/shared"
import { type SessionTableState, type WorkflowTableState } from "@/lib/admin-console"
import { SharedTableState } from "./tables"

export function toTableState(state: SessionTableState | WorkflowTableState): SharedTableState {
  return {
    globalFilter: state.q,
    columnFilters: toColumnFilters(state),
    sorting: state.sortBy ? [{ id: state.sortBy, desc: state.sortDir === "desc" }] : [],
    pagination: { pageIndex: state.pageIndex, pageSize: state.pageSize },
  }
}

export function toColumnFilters(state: SessionTableState | WorkflowTableState): ColumnFiltersState {
  const filters: ColumnFiltersState = []
  addColumnFilter(filters, "status", state.status)
  addColumnFilter(filters, "userId", state.userId)
  if ("kind" in state) {
    addColumnFilter(filters, "agentRuntime", state.kind)
    addColumnFilter(filters, "source", state.source)
    addColumnFilter(filters, "repoOwner", state.repoOwner)
    addColumnFilter(filters, "repoName", state.repoName)
  }
  return filters
}

export function addColumnFilter(filters: ColumnFiltersState, id: string, value: string) {
  if (value) {
    filters.push({ id, value })
  }
}

export function fromSharedTablePatch(
  patch: Partial<SharedTableState>,
): Partial<SessionTableState & WorkflowTableState> {
  const next: Partial<SessionTableState & WorkflowTableState> = {}
  if (patch.globalFilter !== undefined) {
    next.q = patch.globalFilter
  }
  if (patch.sorting) {
    const sort = patch.sorting[0]
    next.sortBy = sort?.id ?? "updatedAt"
    next.sortDir = sort?.desc === false ? "asc" : "desc"
  }
  if (patch.pagination) {
    next.pageIndex = patch.pagination.pageIndex
    next.pageSize = patch.pagination.pageSize
  }
  if (patch.columnFilters) {
    next.status = getColumnFilterValue(patch.columnFilters, "status")
    next.userId = getColumnFilterValue(patch.columnFilters, "userId")
    next.kind = getColumnFilterValue(patch.columnFilters, "agentRuntime")
    next.source = getColumnFilterValue(patch.columnFilters, "source")
    next.repoOwner = getColumnFilterValue(patch.columnFilters, "repoOwner")
    next.repoName = getColumnFilterValue(patch.columnFilters, "repoName")
  }
  return next
}

export function getTableFilter<TData>(table: Table<TData>, id: string): string {
  return getColumnFilterValue(table.getState().columnFilters, id)
}

export function setTableFilter<TData>(table: Table<TData>, id: string, value: string) {
  table.setColumnFilters((previous) => {
    const next = previous.filter((filter) => filter.id !== id)
    if (value.trim()) {
      next.push({ id, value: value.trim() })
    }
    return next
  })
}

export function getColumnFilterValue(filters: ColumnFiltersState, id: string): string {
  const value = filters.find((filter) => filter.id === id)?.value
  return typeof value === "string" ? value : ""
}

export function applyUpdater<T>(updater: Updater<T>, previous: T): T {
  return typeof updater === "function" ? (updater as (old: T) => T)(previous) : updater
}

export function formatAdminSessionStatusFilter(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function formatAdminSessionRuntimeFilter(value: string): string {
  return formatAgentRuntimeLabel(resolveAgentRuntime({ agentRuntime: value }))
}

export function formatAdminSessionSourceFilter(value: string): string {
  if (value === "api") {
    return "API"
  }
  if (value === "slack") {
    return "Slack"
  }
  return "Web"
}

export function formatAdminWorkflowStatusFilter(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function formatTime(value: number): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatDuration(start: number, end: number): string {
  const elapsed = Math.max(0, end - start)
  if (elapsed < 1_000) {
    return `${elapsed}ms`
  }
  if (elapsed < 60_000) {
    return `${(elapsed / 1_000).toFixed(1)}s`
  }
  return `${Math.floor(elapsed / 60_000)}m ${Math.floor((elapsed % 60_000) / 1_000)}s`
}

export function readString(value: Record<string, unknown> | null, key: string): string | null {
  const item = value?.[key]
  return typeof item === "string" ? item : null
}

export function readNumber(value: Record<string, unknown> | null, key: string): number | null {
  const item = value?.[key]
  return typeof item === "number" ? item : null
}

export function findSessionIds(values: unknown[]): string[] {
  const ids = new Set<string>()
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") {
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item)
      }
      return
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "sessionId" && typeof item === "string") {
        ids.add(item)
      } else {
        visit(item)
      }
    }
  }
  values.forEach(visit)
  return [...ids].sort((left, right) => left.localeCompare(right))
}
