import { type AdminSessionRecord, type AdminWorkflowRecord } from "@solzero/api"
import { formatAgentRuntimeLabel, resolveAgentRuntime } from "@solzero/shared"
import {
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type Table,
} from "@tanstack/react-table"
import { getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { Archive, Eye, GitBranch, Play, Square, Trash2, Undo2 } from "lucide-react"
import { useMemo } from "react"
import { type SessionTableState, type WorkflowTableState } from "@/lib/admin-console"
import {
  ActionGroup,
  AdminDataTable,
  IconButton,
  IdentityCell,
  SessionsToolbar,
  WorkflowsToolbar,
} from "./table-controls"
import { StatusBadge } from "./drawers"
import {
  applyUpdater,
  formatDuration,
  formatTime,
  fromSharedTablePatch,
  toTableState,
} from "./utils"

export function SessionsTable({
  sessions,
  total,
  state,
  loading,
  busy,
  onStateChange,
  onView,
  onAction,
}: {
  sessions: readonly AdminSessionRecord[]
  total: number
  state: SessionTableState
  loading: boolean
  busy: string | null
  onStateChange: (patch: Partial<SessionTableState>) => void
  onView: (id: string) => void
  onAction: (id: string, action: "stop" | "archive" | "unarchive" | "delete") => void
}) {
  const columns = useMemo<ColumnDef<AdminSessionRecord>[]>(
    () => [
      {
        id: "title",
        accessorFn: (session) => session.title ?? session.id,
        header: "Agent",
        cell: ({ row }) => (
          <IdentityCell
            title={row.original.title ?? row.original.id}
            subtitle={row.original.id}
            mono
          />
        ),
      },
      {
        id: "userEmail",
        accessorFn: (session) => session.userEmail ?? session.userId,
        header: "User",
        cell: ({ row }) => (
          <IdentityCell
            title={row.original.userName ?? row.original.userEmail ?? row.original.userId}
            subtitle={row.original.userEmail ?? row.original.userId}
          />
        ),
      },
      {
        id: "repoOwner",
        accessorFn: (session) => `${session.repoOwner}/${session.repoName}`,
        header: "Repo",
        cell: ({ row }) => (
          <span className="text-kumo-subtle">
            {row.original.repoOwner}/{row.original.repoName}
          </span>
        ),
      },
      {
        id: "agentRuntime",
        accessorKey: "agentRuntime",
        header: "Runtime",
        cell: ({ row }) => (
          <span className="text-kumo-subtle">
            {formatAgentRuntimeLabel(
              resolveAgentRuntime({
                agentRuntime: row.original.agentRuntime,
                sessionKind: row.original.sessionKind,
              }),
            )}{" "}
            · {row.original.source}
          </span>
        ),
      },
      {
        id: "model",
        accessorKey: "model",
        header: "Model",
        cell: ({ row }) => <span className="text-kumo-subtle">{row.original.model}</span>,
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "updatedAt",
        accessorKey: "updatedAt",
        header: "Updated",
        cell: ({ row }) => (
          <span className="text-kumo-subtle">{formatTime(row.original.updatedAt)}</span>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: ({ row }) => (
          <ActionGroup>
            <IconButton
              title="View details"
              onClick={() => onView(row.original.id)}
              busy={busy === `session-view-${row.original.id}`}
            >
              <Eye className="h-4 w-4" aria-hidden />
            </IconButton>
            <IconButton
              title="Stop agent"
              onClick={() => onAction(row.original.id, "stop")}
              busy={busy === `session-stop-${row.original.id}`}
            >
              <Square className="h-4 w-4" aria-hidden />
            </IconButton>
            {row.original.status === "archived" ? (
              <IconButton
                title="Unarchive agent"
                onClick={() => onAction(row.original.id, "unarchive")}
                busy={busy === `session-unarchive-${row.original.id}`}
              >
                <Undo2 className="h-4 w-4" aria-hidden />
              </IconButton>
            ) : (
              <IconButton
                title="Archive agent"
                onClick={() => onAction(row.original.id, "archive")}
                busy={busy === `session-archive-${row.original.id}`}
              >
                <Archive className="h-4 w-4" aria-hidden />
              </IconButton>
            )}
            <IconButton
              title="Delete agent index row"
              danger
              onClick={() => onAction(row.original.id, "delete")}
              busy={busy === `session-delete-${row.original.id}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </IconButton>
          </ActionGroup>
        ),
      },
    ],
    [busy, onAction, onView],
  )
  const table = useAdminTable({
    data: sessions,
    columns,
    total,
    state: toTableState(state),
    onTableStateChange: (patch) => onStateChange(fromSharedTablePatch(patch)),
  })

  return (
    <div className="space-y-3">
      <SessionsToolbar table={table} />
      <AdminDataTable table={table} loading={loading} empty="No agents found." />
    </div>
  )
}

export function WorkflowsTable({
  workflows,
  total,
  state,
  loading,
  busy,
  onStateChange,
  onViewRuns,
  onAction,
}: {
  workflows: readonly AdminWorkflowRecord[]
  total: number
  state: WorkflowTableState
  loading: boolean
  busy: string | null
  onStateChange: (patch: Partial<WorkflowTableState>) => void
  onViewRuns: (workflow: AdminWorkflowRecord) => void
  onAction: (workflow: AdminWorkflowRecord, action: "run" | "archive" | "unarchive") => void
}) {
  const columns = useMemo<ColumnDef<AdminWorkflowRecord>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Workflow",
        cell: ({ row }) => (
          <IdentityCell
            title={row.original.name}
            subtitle={`${row.original.id} · v${row.original.manifestVersion} · ${row.original.status}`}
            mono
          />
        ),
      },
      {
        id: "userEmail",
        accessorFn: (workflow) => workflow.userEmail ?? workflow.userId,
        header: "User",
        cell: ({ row }) => (
          <IdentityCell
            title={row.original.userName ?? row.original.userEmail ?? row.original.userId}
            subtitle={row.original.userEmail ?? row.original.userId}
          />
        ),
      },
      {
        id: "latestRun",
        header: "Latest run",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.latestRun ? (
            <div className="space-y-1">
              <StatusBadge status={row.original.latestRun.status} />
              <div className="text-xs text-kumo-subtle">
                {formatDuration(
                  row.original.latestRun.startedAt,
                  row.original.latestRun.completedAt ?? Date.now(),
                )}
              </div>
            </div>
          ) : (
            <span className="text-kumo-subtle">Never</span>
          ),
      },
      {
        id: "runCounts",
        header: "Runs",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-kumo-subtle">
            {row.original.runCounts.map((count) => `${count.status}:${count.count}`).join(" · ") ||
              "0"}
          </span>
        ),
      },
      {
        id: "webhookId",
        accessorKey: "webhookId",
        header: "Webhook",
        cell: ({ row }) => (
          <span className="truncate font-mono text-xs text-kumo-subtle">
            {row.original.webhookPath}
          </span>
        ),
      },
      {
        id: "updatedAt",
        accessorKey: "updatedAt",
        header: "Updated",
        cell: ({ row }) => (
          <span className="text-kumo-subtle">{formatTime(row.original.updatedAt)}</span>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: ({ row }) => (
          <ActionGroup>
            <IconButton
              title="View runs"
              onClick={() => onViewRuns(row.original)}
              busy={busy === `workflow-runs-${row.original.id}`}
            >
              <GitBranch className="h-4 w-4" aria-hidden />
            </IconButton>
            <IconButton
              title="Run workflow"
              onClick={() => onAction(row.original, "run")}
              busy={busy === `workflow-run-${row.original.id}`}
            >
              <Play className="h-4 w-4" aria-hidden />
            </IconButton>
            {row.original.status === "archived" ? (
              <IconButton
                title="Unarchive workflow"
                onClick={() => onAction(row.original, "unarchive")}
                busy={busy === `workflow-unarchive-${row.original.id}`}
              >
                <Undo2 className="h-4 w-4" aria-hidden />
              </IconButton>
            ) : (
              <IconButton
                title="Archive workflow"
                onClick={() => onAction(row.original, "archive")}
                busy={busy === `workflow-archive-${row.original.id}`}
              >
                <Archive className="h-4 w-4" aria-hidden />
              </IconButton>
            )}
          </ActionGroup>
        ),
      },
    ],
    [busy, onAction, onViewRuns],
  )
  const table = useAdminTable({
    data: workflows,
    columns,
    total,
    state: toTableState(state),
    onTableStateChange: (patch) => onStateChange(fromSharedTablePatch(patch)),
  })

  return (
    <div className="space-y-3">
      <WorkflowsToolbar table={table} />
      <AdminDataTable table={table} loading={loading} empty="No workflows found." />
    </div>
  )
}

export interface SharedTableState {
  globalFilter: string
  columnFilters: ColumnFiltersState
  sorting: SortingState
  pagination: PaginationState
}

export function useAdminTable<TData>({
  data,
  columns,
  total,
  state,
  onTableStateChange,
}: {
  data: readonly TData[]
  columns: ColumnDef<TData>[]
  total: number
  state: SharedTableState
  onTableStateChange: (patch: Partial<SharedTableState>) => void
}): Table<TData> {
  const tableData = useMemo(() => [...data], [data])
  return useReactTable({
    data: tableData,
    columns,
    rowCount: total,
    enableMultiSort: false,
    manualFiltering: true,
    manualPagination: true,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
    state,
    onGlobalFilterChange: (updater) => {
      onTableStateChange({
        globalFilter: applyUpdater(updater, state.globalFilter),
        pagination: { ...state.pagination, pageIndex: 0 },
      })
    },
    onColumnFiltersChange: (updater) => {
      onTableStateChange({
        columnFilters: applyUpdater(updater, state.columnFilters),
        pagination: { ...state.pagination, pageIndex: 0 },
      })
    },
    onSortingChange: (updater) => {
      onTableStateChange({
        sorting: applyUpdater(updater, state.sorting).slice(0, 1),
        pagination: { ...state.pagination, pageIndex: 0 },
      })
    },
    onPaginationChange: (updater) => {
      onTableStateChange({ pagination: applyUpdater(updater, state.pagination) })
    },
  })
}
