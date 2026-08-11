import { Banner } from "@cloudflare/kumo/components/banner"
import { Button } from "@cloudflare/kumo/components/button"
import { Empty } from "@cloudflare/kumo/components/empty"
import { Input } from "@cloudflare/kumo/components/input"
import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { Pagination } from "@cloudflare/kumo/components/pagination"
import { Select } from "@cloudflare/kumo/components/select"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type Table,
  useReactTable,
} from "@tanstack/react-table"
import { S0LogoSvg } from "@/components/s0-logo-svg"
import {
  Activity,
  AlertCircle,
  ArrowRightFromLine,
  ArrowRightToLine,
  ChevronRight,
  type LucideIcon,
  Maximize2,
  PanelRightClose,
  Trash2,
} from "lucide-react"
import { useId, useMemo, useState } from "react"
import { type WorkflowManifest } from "@solzero/shared"
import { S0Loader, TableCellState } from "@/components/s0-loader"
import { CodeSurface, getCodeLanguageForValue, getCodeTextForValue } from "@/components/code"
import {
  WORKFLOW_CREATION_DIALOG_CONFIG,
  WORKFLOW_PAGE_SIZE_OPTIONS,
  WORKFLOW_RUN_STATUS_FILTER_OPTIONS,
  WORKFLOW_RUN_TRIGGER_FILTER_OPTIONS,
  WORKFLOW_STATUS_ALL_FILTER,
  WorkflowRun,
  WorkflowRunArtifactContent,
  WorkflowRunArtifactSummary,
  WorkflowRunEvent,
  WorkflowRunStatePatch,
  WorkflowRunTableState,
  WorkflowSummary,
} from "./types"
import {
  applyUpdater,
  formatWorkflowRunStatusFilterValue,
  formatWorkflowRunTriggerFilterValue,
  getTableFilter,
  isWorkflowRunSortBy,
  setTableFilter,
  WorkflowCreationModePanel,
  WorkflowCreationPanelProps,
  WorkflowSortIcon,
} from "./index-page"
import { WorkflowDialogFrame } from "./detail-chrome"
import { NodeCategoryIcon, StatusBadge } from "./session-controls"
import {
  formatTime,
  getRunDurationLabel,
  getRunEventDurationLabel,
  getWorkflowRunArtifactSummaries,
  requestJson,
  shortRunId,
} from "./run-utils"
import { formatJson } from "./header-utils"
import { RunEventDisclosure } from "./run-event-disclosure"
import {
  groupWorkflowSubagentEvents,
  WorkflowSubagentRunDisclosure,
} from "./subagent-run-disclosure"

export function WorkflowCreationDialog({
  open,
  mode,
  builderPrompt,
  builderRunning,
  onClose,
  onTemplateSelect,
  onImportFile,
  onBuilderPromptChange,
  onBuildWithLlm,
}: WorkflowCreationPanelProps & {
  open: boolean
  onClose: () => void
}) {
  const dialog = WORKFLOW_CREATION_DIALOG_CONFIG[mode]

  return (
    <WorkflowDialogFrame
      open={open}
      onClose={onClose}
      size={dialog.size}
      className={dialog.className}
      title={dialog.title}
      description={dialog.description}
      closeLabel={`Close ${dialog.title.toLowerCase()} dialog`}
    >
      <WorkflowCreationModePanel
        mode={mode}
        builderPrompt={builderPrompt}
        builderRunning={builderRunning}
        onTemplateSelect={onTemplateSelect}
        onImportFile={onImportFile}
        onBuilderPromptChange={onBuilderPromptChange}
        onBuildWithLlm={onBuildWithLlm}
      />
    </WorkflowDialogFrame>
  )
}

export function WorkflowOverview({
  workflow,
  runs,
  runTableTotal,
  runTotal,
  runErrorsLast24Hours,
  runTableState,
  runTableLoading,
  events,
  selectedRunId,
  runDetailsOpen,
  onRunTableStateChange,
  onSelectRun,
  onCloseRunDetails,
  onSubmitApproval,
  submittingApprovalNodeId,
  onRequestDeleteRun,
  deletingRunId,
}: {
  workflow: WorkflowSummary | null
  runs: WorkflowRun[]
  runTableTotal: number
  runTotal: number
  runErrorsLast24Hours: number
  runTableState: WorkflowRunTableState
  runTableLoading: boolean
  events: WorkflowRunEvent[]
  selectedRunId: string | null
  runDetailsOpen: boolean
  onRunTableStateChange: (patch: WorkflowRunStatePatch) => void
  onSelectRun: (runId: string) => void
  onCloseRunDetails: () => void
  onSubmitApproval: (runId: string, nodeId: string, approved: boolean) => void | Promise<void>
  submittingApprovalNodeId: string | null
  onRequestDeleteRun: (run: WorkflowRun) => void
  deletingRunId: string | null
}) {
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null
  const showRunDetails = runDetailsOpen && selectedRun !== null
  return (
    <div
      className="grid min-h-0 flex-1 transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none"
      style={{
        gridTemplateColumns: showRunDetails ? "minmax(0, 1fr) 420px" : "minmax(0, 1fr) 0px",
      }}
    >
      <main className="flex min-w-0 flex-col overflow-hidden">
        <WorkflowOverviewHeader
          workflow={workflow}
          runTotal={runTotal}
          runErrorsLast24Hours={runErrorsLast24Hours}
        />
        <RunHistoryTable
          runs={runs}
          total={runTableTotal}
          state={runTableState}
          loading={runTableLoading}
          selectedRunId={selectedRunId}
          onStateChange={onRunTableStateChange}
          onSelectRun={onSelectRun}
        />
      </main>
      <div className="min-h-0 overflow-hidden">
        {showRunDetails ? (
          <RunDetailsSidebar
            workflowManifest={workflow?.manifest ?? null}
            run={selectedRun}
            events={events}
            onClose={onCloseRunDetails}
            onSubmitApproval={onSubmitApproval}
            submittingApprovalNodeId={submittingApprovalNodeId}
            onRequestDelete={onRequestDeleteRun}
            deleting={deletingRunId === selectedRun.id}
          />
        ) : null}
      </div>
    </div>
  )
}

export function WorkflowOverviewHeader({
  workflow,
  runTotal,
  runErrorsLast24Hours,
}: {
  workflow: WorkflowSummary | null
  runTotal: number
  runErrorsLast24Hours: number
}) {
  return (
    <section className="border-b border-kumo-hairline px-5 py-4">
      <div className="mb-4 min-w-0">
        <div className="min-w-0">
          <h2 className="text-base font-medium text-kumo-default">Overview</h2>
          <p className="mt-1 text-sm text-kumo-subtle">
            Run history and recent workflow execution metadata.
          </p>
        </div>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewLayerCard
          label="Version"
          value={workflow ? `v${workflow.manifestVersion}` : "Draft"}
          detail={workflow ? `Updated ${formatTime(workflow.updatedAt)}` : "Unsaved draft"}
        />
        <OverviewLayerCard label="Total runs" value={runTotal.toLocaleString()} detail="All time" />
        <OverviewLayerCard
          label="Errors"
          value={runErrorsLast24Hours.toLocaleString()}
          detail="Failed runs in the past 24 hours"
        />
        <LayerCard className="h-full overflow-hidden rounded-xl">
          <LayerCard.Secondary className="my-0 flex items-center gap-1.5 px-3 py-2">
            <S0LogoSvg className="relative top-px h-3.5 w-3.5 shrink-0 text-kumo-brand" />
            <dt className="text-xs font-medium leading-4 text-kumo-subtle">Assist</dt>
          </LayerCard.Secondary>
          <LayerCard.Primary className="flex flex-1 items-start rounded-lg px-3 py-3">
            <dd className="text-sm leading-5 text-kumo-subtle text-pretty">
              Coming soon — prompt optimization, memory tuning, and workflow improvement
              recommendations
            </dd>
          </LayerCard.Primary>
        </LayerCard>
      </dl>
    </section>
  )
}

export function OverviewLayerCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <LayerCard className="h-full overflow-hidden rounded-xl">
      <LayerCard.Secondary className="my-0 px-3 py-2">
        <dt className="text-xs font-medium text-kumo-subtle">{label}</dt>
      </LayerCard.Secondary>
      <LayerCard.Primary className="flex flex-1 flex-col rounded-lg px-3 py-3">
        <dd className="truncate text-lg font-semibold tabular-nums text-kumo-default">{value}</dd>
        <p className="mt-1 truncate text-xs text-kumo-subtle">{detail}</p>
      </LayerCard.Primary>
    </LayerCard>
  )
}

export const WORKFLOW_RUN_COLUMNS: ColumnDef<WorkflowRun>[] = [
  {
    id: "id",
    accessorKey: "id",
    header: "Run",
    cell: ({ row }) => (
      <span className="font-mono text-xs text-kumo-default">{shortRunId(row.original.id)}</span>
    ),
  },
  {
    id: "workflowVersion",
    accessorKey: "workflowVersion",
    header: "Version",
    cell: ({ row }) => (
      <span className="tabular-nums text-kumo-subtle">v{row.original.workflowVersion}</span>
    ),
  },
  {
    id: "startedAt",
    accessorKey: "startedAt",
    header: "Started",
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular-nums text-kumo-subtle">
        {formatTime(row.original.startedAt)}
      </span>
    ),
  },
  {
    id: "duration",
    header: "Duration",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular-nums text-kumo-subtle">
        {getRunDurationLabel(row.original)}
      </span>
    ),
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    id: "triggerKind",
    accessorKey: "triggerKind",
    header: "Trigger",
    cell: ({ row }) => (
      <span className="font-mono text-xs text-kumo-subtle">
        {row.original.triggerNodeId ?? row.original.triggerKind}
      </span>
    ),
  },
  {
    id: "updatedAt",
    accessorKey: "updatedAt",
    header: "Updated",
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular-nums text-kumo-subtle">
        {formatTime(row.original.updatedAt)}
      </span>
    ),
  },
]

export function RunHistoryTable({
  runs,
  total,
  state,
  loading,
  selectedRunId,
  onStateChange,
  onSelectRun,
}: {
  runs: WorkflowRun[]
  total: number
  state: WorkflowRunTableState
  loading: boolean
  selectedRunId: string | null
  onStateChange: (patch: WorkflowRunStatePatch) => void
  onSelectRun: (runId: string) => void
}) {
  const table = useWorkflowRunTable({
    data: runs,
    columns: WORKFLOW_RUN_COLUMNS,
    total,
    state,
    onStateChange,
  })
  const rows = table.getRowModel().rows

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-auto px-5 py-4">
      <RunHistoryToolbar table={table} />
      <div className="overflow-auto rounded-xl bg-kumo-elevated/80 [container-type:inline-size]">
        <KumoTable className="min-w-[920px] text-left text-sm">
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
                          <WorkflowSortIcon direction={header.column.getIsSorted()} />
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
                  className="h-56 border-b border-kumo-hairline px-3 py-3 text-sm text-kumo-subtle"
                >
                  <TableCellState className="h-full">
                    {loading ? (
                      <S0Loader size={32} />
                    ) : (
                      <Empty
                        title="No workflow runs found."
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
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectRun(row.original.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      onSelectRun(row.original.id)
                    }
                  }}
                  className={`cursor-pointer bg-kumo-base outline-none transition hover:bg-kumo-tint/60 focus:bg-kumo-tint ${
                    row.original.id === selectedRunId ? "bg-kumo-tint" : ""
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <KumoTable.Cell
                      key={cell.id}
                      className="border-b border-kumo-hairline px-3 py-3 align-middle"
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
        page={table.getState().pagination.pageIndex + 1}
        setPage={(page) => {
          if (!loading) {
            table.setPageIndex(page - 1)
          }
        }}
        perPage={table.getState().pagination.pageSize}
        totalCount={table.getRowCount()}
        className="justify-between"
      >
        <Pagination.Info />
        <Pagination.Separator />
        <Pagination.PageSize
          value={table.getState().pagination.pageSize}
          onChange={(size) => {
            if (!loading) {
              table.setPageSize(size)
            }
          }}
          options={[...WORKFLOW_PAGE_SIZE_OPTIONS]}
        />
        <Pagination.Controls controls="simple" />
      </Pagination>
    </div>
  )
}

export function useWorkflowRunTable({
  data,
  columns,
  total,
  state,
  onStateChange,
}: {
  data: WorkflowRun[]
  columns: ColumnDef<WorkflowRun>[]
  total: number
  state: WorkflowRunTableState
  onStateChange: (patch: WorkflowRunStatePatch) => void
}): Table<WorkflowRun> {
  const tableData = useMemo(() => data, [data])
  const columnFilters = [
    ...(state.status ? [{ id: "status", value: state.status }] : []),
    ...(state.triggerKind ? [{ id: "triggerKind", value: state.triggerKind }] : []),
  ]
  return useReactTable({
    data: tableData,
    columns,
    rowCount: total,
    enableMultiSort: false,
    manualFiltering: true,
    manualPagination: true,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
    state: {
      globalFilter: state.q,
      columnFilters,
      sorting: [{ id: state.sortBy, desc: state.sortDir === "desc" }],
      pagination: { pageIndex: state.pageIndex, pageSize: state.pageSize },
    },
    onGlobalFilterChange: (updater) => {
      onStateChange({
        q: applyUpdater(updater, state.q),
        pageIndex: 0,
      })
    },
    onColumnFiltersChange: (updater) => {
      const filters = applyUpdater(updater, columnFilters)
      onStateChange({
        status: String(filters.find((filter) => filter.id === "status")?.value ?? ""),
        triggerKind: String(filters.find((filter) => filter.id === "triggerKind")?.value ?? ""),
        pageIndex: 0,
      })
    },
    onSortingChange: (updater) => {
      const sorting = applyUpdater(updater, [
        { id: state.sortBy, desc: state.sortDir === "desc" },
      ]).slice(0, 1)
      const nextSort = sorting[0]
      onStateChange({
        sortBy: isWorkflowRunSortBy(nextSort?.id) ? nextSort.id : "updatedAt",
        sortDir: nextSort?.desc === false ? "asc" : "desc",
        pageIndex: 0,
      })
    },
    onPaginationChange: (updater) => {
      const pagination = applyUpdater(updater, {
        pageIndex: state.pageIndex,
        pageSize: state.pageSize,
      })
      onStateChange({
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
      })
    },
  })
}

export function RunHistoryToolbar({ table }: { table: Table<WorkflowRun> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={String(table.getState().globalFilter ?? "")}
        onChange={(event) => table.setGlobalFilter(event.target.value)}
        placeholder="Search runs"
        aria-label="Search workflow runs"
        className="min-w-[260px]"
        passwordManagerIgnore
      />
      <Select
        value={getTableFilter(table, "status") || WORKFLOW_STATUS_ALL_FILTER}
        onValueChange={(value) =>
          setTableFilter(
            table,
            "status",
            value === WORKFLOW_STATUS_ALL_FILTER ? "" : String(value ?? ""),
          )
        }
        renderValue={(value) => formatWorkflowRunStatusFilterValue(value)}
        aria-label="Run status"
      >
        <Select.Option value={WORKFLOW_STATUS_ALL_FILTER}>All statuses</Select.Option>
        {WORKFLOW_RUN_STATUS_FILTER_OPTIONS.map((status) => (
          <Select.Option key={status} value={status}>
            {status}
          </Select.Option>
        ))}
      </Select>
      <Select
        value={getTableFilter(table, "triggerKind") || WORKFLOW_STATUS_ALL_FILTER}
        onValueChange={(value) =>
          setTableFilter(
            table,
            "triggerKind",
            value === WORKFLOW_STATUS_ALL_FILTER ? "" : String(value ?? ""),
          )
        }
        renderValue={(value) => formatWorkflowRunTriggerFilterValue(value)}
        aria-label="Run trigger"
      >
        <Select.Option value={WORKFLOW_STATUS_ALL_FILTER}>All triggers</Select.Option>
        {WORKFLOW_RUN_TRIGGER_FILTER_OPTIONS.map((triggerKind) => (
          <Select.Option key={triggerKind} value={triggerKind}>
            {triggerKind}
          </Select.Option>
        ))}
      </Select>
    </div>
  )
}

export function RunDetailsSidebar({
  workflowManifest,
  run,
  events,
  onClose,
  onSubmitApproval,
  submittingApprovalNodeId,
  onRequestDelete,
  deleting,
}: {
  workflowManifest: WorkflowManifest | null
  run: WorkflowRun
  events: WorkflowRunEvent[]
  onClose: () => void
  onSubmitApproval: (runId: string, nodeId: string, approved: boolean) => void | Promise<void>
  submittingApprovalNodeId: string | null
  onRequestDelete: (run: WorkflowRun) => void
  deleting: boolean
}) {
  const submittedApprovalNodeIds = new Set(
    events
      .filter((event) => event.eventType === "approval_submitted" && event.nodeId)
      .map((event) => event.nodeId),
  )
  const artifacts = useMemo(
    () => getWorkflowRunArtifactSummaries(run, events, workflowManifest),
    [events, run, workflowManifest],
  )

  return (
    <aside className="flex h-full min-h-0 w-[420px] flex-col border-l border-kumo-hairline bg-kumo-canvas">
      <div className="flex items-start justify-between gap-3 border-b border-kumo-hairline px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-kumo-subtle" aria-hidden />
            <h2 className="text-sm font-medium text-kumo-default">Run details</h2>
          </div>
          <div className="mt-1 truncate font-mono text-xs text-kumo-subtle">{run.id}</div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Button
            type="button"
            onClick={() => onRequestDelete(run)}
            disabled={deleting}
            loading={deleting}
            size="lg"
            shape="square"
            variant="ghost"
            className="bg-transparent! text-kumo-danger! shadow-none! ring-0! hover:bg-kumo-danger-tint/20! focus:ring-0! focus-visible:ring-0!"
            aria-label={`Delete run ${run.id}`}
            title="Delete run"
            icon={<Trash2 className="h-4 w-4" aria-hidden />}
          />
          <Button
            type="button"
            onClick={onClose}
            size="lg"
            shape="square"
            variant="secondary"
            aria-label="Close run details"
            title="Close run details"
            icon={<PanelRightClose className="h-4 w-4" aria-hidden />}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-kumo-hairline px-4 py-3 text-xs">
          <div className="mb-3">
            <span className="font-medium text-kumo-default">Metadata</span>
          </div>
          <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-2 gap-y-1 text-kumo-subtle">
            <dt>ID</dt>
            <dd className="truncate font-mono text-kumo-default">{run.id}</dd>
            <dt>Instance</dt>
            <dd className="truncate font-mono text-kumo-default">
              {run.workflowInstanceId ?? "pending"}
            </dd>
            <dt>Version</dt>
            <dd className="text-kumo-default">v{run.workflowVersion}</dd>
            <dt>Trigger</dt>
            <dd className="text-kumo-default">{run.triggerKind}</dd>
            <dt>Trigger node</dt>
            <dd className="truncate text-kumo-default">{run.triggerNodeId ?? "manual"}</dd>
            <dt>Started</dt>
            <dd className="text-kumo-default">{formatTime(run.startedAt)}</dd>
            <dt>Updated</dt>
            <dd className="text-kumo-default">{formatTime(run.updatedAt)}</dd>
            <dt>Completed</dt>
            <dd className="text-kumo-default">
              {run.completedAt ? formatTime(run.completedAt) : "Not complete"}
            </dd>
            <dt>Duration</dt>
            <dd className="text-kumo-default">{getRunDurationLabel(run)}</dd>
          </dl>
          {run.error ? (
            <Banner
              variant="error"
              className="mt-3 text-sm"
              icon={<AlertCircle className="h-4 w-4 shrink-0" aria-hidden />}
              description={<span className="whitespace-pre-wrap">{run.error}</span>}
            />
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-kumo-hairline pt-3">
            <RunJsonViewerButton
              label="View input"
              title="Run input"
              value={run.input}
              icon={ArrowRightToLine}
            />
            <RunJsonViewerButton
              label="View output"
              title="Run output"
              value={run.output}
              icon={ArrowRightFromLine}
              disabled={run.output === null}
            />
          </div>
        </div>
        <RunArtifactsSection artifacts={artifacts} />
        <div className="py-3">
          <h3 className="mb-2 px-4 text-xs font-medium uppercase text-kumo-subtle">Events</h3>
          <div className="border-t border-kumo-hairline">
            {groupWorkflowSubagentEvents(events).map((row) =>
              row.type === "subagent" ? (
                <WorkflowSubagentRunDisclosure
                  key={`subagent:${row.childRunId}`}
                  childRunId={row.childRunId}
                  events={row.events}
                />
              ) : (
                <RunEventDisclosure
                  key={row.event.id}
                  event={row.event}
                  run={run}
                  durationLabel={getRunEventDurationLabel(row.event, events, run)}
                  approvalSubmitted={Boolean(
                    row.event.nodeId && submittedApprovalNodeIds.has(row.event.nodeId),
                  )}
                  submittingApproval={row.event.nodeId === submittingApprovalNodeId}
                  onSubmitApproval={onSubmitApproval}
                />
              ),
            )}
            {events.length === 0 ? (
              <div className="py-6 text-center text-sm text-kumo-subtle">Waiting for events</div>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  )
}

export function RunJsonViewerButton({
  label,
  title,
  value,
  icon: Icon,
  disabled = false,
}: {
  label: string
  title: string
  value: unknown
  icon: LucideIcon
  disabled?: boolean
}) {
  const icon = <Icon className="h-4 w-4" aria-hidden />

  if (disabled) {
    return (
      <Button
        type="button"
        disabled
        size="lg"
        variant="secondary"
        className="w-full text-sm"
        icon={icon}
      >
        {label}
      </Button>
    )
  }

  return (
    <CodeSurface
      title={title}
      value={formatJson(value)}
      language="json"
      trigger={({ ariaLabel, expanded, open }) => (
        <Button
          type="button"
          onClick={open}
          aria-haspopup="dialog"
          aria-expanded={expanded}
          aria-label={ariaLabel}
          size="lg"
          variant="secondary"
          className="w-full text-sm"
          icon={icon}
        >
          {label}
        </Button>
      )}
    />
  )
}

export function RunArtifactsSection({ artifacts }: { artifacts: WorkflowRunArtifactSummary[] }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const artifactsId = useId()

  return (
    <section className="border-b border-kumo-hairline">
      <button
        type="button"
        onClick={() => setIsExpanded((expanded) => !expanded)}
        aria-expanded={isExpanded}
        aria-controls={artifactsId}
        className="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left outline-none transition-[background-color] hover:bg-kumo-tint focus:bg-kumo-tint"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-kumo-subtle transition-transform duration-200 ${
            isExpanded ? "rotate-90" : ""
          }`}
          aria-hidden
        />
        <span className="min-w-0 flex-1 text-xs font-medium uppercase text-kumo-subtle">
          Artifacts
        </span>
        <span className="shrink-0 rounded-full border border-kumo-line bg-kumo-tint px-1.5 py-0.5 font-mono text-[11px] leading-none text-kumo-subtle">
          {artifacts.length}
        </span>
      </button>
      <div
        id={artifactsId}
        aria-hidden={!isExpanded}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-w-0 overflow-hidden">
          {artifacts.length > 0 ? (
            <ul className="divide-y divide-kumo-hairline px-4 pb-3">
              {artifacts.map((artifact) => (
                <RunArtifactRow key={artifact.id} artifact={artifact} />
              ))}
            </ul>
          ) : (
            <div className="px-4 pb-3 pt-3 text-sm text-kumo-subtle">No saved artifacts.</div>
          )}
        </div>
      </div>
    </section>
  )
}

export function RunArtifactRow({ artifact }: { artifact: WorkflowRunArtifactSummary }) {
  return (
    <li className="flex min-w-0 items-center gap-3 py-2">
      <NodeCategoryIcon type={artifact.nodeType} category="storage" className="h-7 w-7" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-kumo-default">{artifact.title}</div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-kumo-subtle">
          {artifact.subtitle}
        </div>
      </div>
      <RunArtifactViewerButton artifact={artifact} />
    </li>
  )
}

export function RunArtifactViewerButton({ artifact }: { artifact: WorkflowRunArtifactSummary }) {
  const [artifactContent, setArtifactContent] = useState<WorkflowRunArtifactContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const viewerValue = artifactContent
    ? getCodeTextForValue(artifactContent.content)
    : formatJson({ error: loadError ?? "Artifact content has not loaded." })
  const viewerLanguage = artifactContent ? getCodeLanguageForValue(artifactContent.content) : "json"

  const openArtifact = async (open: () => void) => {
    if (artifactContent) {
      open()
      return
    }
    if (loading) {
      return
    }

    setLoading(true)
    setLoadError(null)
    try {
      const data = await requestJson<{ artifact: WorkflowRunArtifactContent }>(
        `/api/workflows/${encodeURIComponent(artifact.workflowId)}/runs/${encodeURIComponent(
          artifact.runId,
        )}/artifacts/${encodeURIComponent(artifact.nodeId)}`,
      )
      setArtifactContent(data.artifact)
    } catch (errorValue) {
      setLoadError(errorValue instanceof Error ? errorValue.message : "Failed to load artifact")
    } finally {
      setLoading(false)
      open()
    }
  }

  return (
    <CodeSurface
      title={`${artifact.title} artifact`}
      value={viewerValue}
      language={viewerLanguage}
      trigger={({ ariaLabel, expanded, open }) => (
        <button
          type="button"
          onClick={() => void openArtifact(open)}
          disabled={loading}
          aria-haspopup="dialog"
          aria-expanded={expanded}
          aria-label={ariaLabel}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-kumo-line px-2.5 py-1.5 text-xs font-medium text-kumo-subtle transition-[background-color,color,transform] hover:bg-kumo-tint hover:text-kumo-default active:scale-[0.96] disabled:cursor-wait disabled:opacity-60 disabled:active:scale-100"
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          {loading ? "Loading" : "View"}
        </button>
      )}
    />
  )
}
