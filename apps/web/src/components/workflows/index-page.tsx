import { Badge, type BadgeVariant } from "@cloudflare/kumo/components/badge"
import { Empty } from "@cloudflare/kumo/components/empty"
import { Input } from "@cloudflare/kumo/components/input"
import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { Pagination } from "@cloudflare/kumo/components/pagination"
import { Select } from "@cloudflare/kumo/components/select"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import { BorderBeam } from "border-beam"
import { Link, useLocation } from "@tanstack/react-router"
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type Table,
  useReactTable,
} from "@tanstack/react-table"
import {
  Box,
  ChevronDown,
  ChevronsUpDown,
  FileUp,
  type LucideIcon,
  Sparkles,
  Trash2,
} from "lucide-react"
import { useMemo } from "react"
import {
  WORKFLOW_TEMPLATES,
  type ProviderSettingsResponse,
  type WorkflowTemplate,
} from "@c0-agent/shared"
import { C0Loader, TableCellState } from "@/components/c0-loader"
import {
  getRouteWorkflowId,
  WORKFLOW_PAGE_SIZE_OPTIONS,
  WORKFLOW_STATUS_ALL_FILTER,
  WORKFLOW_STATUS_FILTER_OPTIONS,
  WORKFLOW_TEMPLATE_COMPLEXITY_GROUPS,
  WorkflowCreationMode,
  WorkflowListSortBy,
  WorkflowListStatePatch,
  WorkflowListTableState,
  WorkflowRunSortBy,
  WorkflowRunTableState,
  WorkflowSummary,
} from "./types"
import { WorkflowsPage } from "./page"
import { AiBeamButton } from "./detail-chrome"
import { formatTime } from "./run-utils"

export interface WorkflowCreationPanelProps {
  mode: WorkflowCreationMode
  builderPrompt: string
  builderRunning: boolean
  onTemplateSelect: (template: WorkflowTemplate) => void
  onImportFile: (file: File) => void
  onBuilderPromptChange: (value: string) => void
  onBuildWithLlm: () => void
}

export function WorkflowCreationModePanel({
  mode,
  builderPrompt,
  builderRunning,
  onTemplateSelect,
  onImportFile,
  onBuilderPromptChange,
  onBuildWithLlm,
}: WorkflowCreationPanelProps) {
  if (mode === "templates") {
    return (
      <div className="space-y-5">
        {WORKFLOW_TEMPLATE_COMPLEXITY_GROUPS.map((group) => {
          const templates = WORKFLOW_TEMPLATES.filter(
            (template) => template.complexity === group.complexity,
          )
          if (templates.length === 0) {
            return null
          }
          return (
            <section key={group.complexity}>
              <h3 className="mb-2 text-xs font-semibold text-kumo-subtle">{group.label}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => onTemplateSelect(template)}
                    className="flex min-h-28 flex-col items-start justify-start rounded-lg bg-kumo-base p-4 text-left ring-1 ring-kumo-hairline transition hover:bg-kumo-tint hover:ring-kumo-brand"
                  >
                    <div className="text-sm font-medium text-kumo-default">{template.name}</div>
                    <div className="mt-1 text-sm leading-5 text-kumo-subtle">
                      {template.description}
                    </div>
                    {template.tags?.length ? (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {template.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-kumo-tint px-1.5 py-0.5 text-[10px] uppercase text-kumo-subtle ring-1 ring-kumo-hairline"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    )
  }

  if (mode === "import") {
    return (
      <label className="flex min-h-48 w-full cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-kumo-line bg-kumo-tint px-6 py-10 text-center transition hover:border-kumo-brand">
        <FileUp className="h-7 w-7 text-kumo-subtle" aria-hidden />
        <span className="mt-3 text-sm font-medium text-kumo-default">Choose YAML file</span>
        <span className="mt-1 text-sm text-kumo-subtle">
          Portable c0 workflow exports load as unsaved drafts.
        </span>
        <input
          type="file"
          accept=".yaml,.yml,text/yaml,application/yaml"
          className="sr-only"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ""
            if (file) {
              onImportFile(file)
            }
          }}
        />
      </label>
    )
  }

  return (
    <div className="space-y-3">
      <textarea
        value={builderPrompt}
        onChange={(event) => onBuilderPromptChange(event.target.value)}
        placeholder="Describe the workflow, trigger, nodes, storage, and expected output."
        className="min-h-40 w-full resize-y rounded-lg bg-kumo-base p-3 text-sm text-kumo-default outline-none ring-1 ring-kumo-line transition focus:ring-kumo-brand"
      />
      <div className="flex justify-end">
        <AiBeamButton onClick={onBuildWithLlm} disabled={builderRunning}>
          <Sparkles className="h-4 w-4" aria-hidden />
          {builderRunning ? "Building" : "Build draft"}
        </AiBeamButton>
      </div>
    </div>
  )
}

export function WorkflowIndexLanding({
  workflows,
  total,
  state,
  loading,
  deletingWorkflowId,
  onStateChange,
  onOpenCreationMode,
  onSelectWorkflow,
  onRequestDeleteWorkflow,
}: {
  workflows: WorkflowSummary[]
  total: number
  state: WorkflowListTableState
  loading: boolean
  deletingWorkflowId: string | null
  onStateChange: (patch: WorkflowListStatePatch) => void
  onOpenCreationMode: (mode: WorkflowCreationMode) => void
  onSelectWorkflow: (workflowId: string) => void
  onRequestDeleteWorkflow: (workflow: WorkflowSummary) => void
}) {
  const columns = useMemo<ColumnDef<WorkflowSummary>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Workflow",
        cell: ({ row }) => (
          <Link
            to="/workflows/$workflowId"
            params={{ workflowId: row.original.id }}
            className="block max-w-md text-left"
          >
            <div className="truncate text-sm font-medium text-kumo-default">
              {row.original.name}
            </div>
            <div className="mt-1 truncate text-xs text-kumo-subtle">{row.original.id}</div>
          </Link>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <WorkflowStatusBadge status={row.original.status} />,
      },
      {
        id: "manifestVersion",
        accessorKey: "manifestVersion",
        header: "Version",
        cell: ({ row }) => (
          <span className="text-kumo-subtle tabular-nums">v{row.original.manifestVersion}</span>
        ),
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        header: "Created",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-kumo-subtle">
            {formatTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "updatedAt",
        accessorKey: "updatedAt",
        header: "Updated",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-kumo-subtle">
            {formatTime(row.original.updatedAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onRequestDeleteWorkflow(row.original)
            }}
            disabled={deletingWorkflowId === row.original.id}
            aria-label={`Delete workflow ${row.original.name}`}
            title="Delete workflow"
            className="rounded-lg p-2 text-kumo-subtle transition hover:bg-kumo-danger-tint/10 hover:text-kumo-danger disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        ),
      },
    ],
    [deletingWorkflowId, onRequestDeleteWorkflow],
  )
  const table = useWorkflowIndexTable({
    data: workflows,
    columns,
    total,
    state,
    onStateChange,
  })

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-kumo-canvas">
      <div className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-8">
        <section>
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-kumo-default">Create a new Workflow</h2>
            <p className="mt-1 text-sm text-kumo-subtle">
              Automate tasks with AI and your organization's account.
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            <WorkflowCreationCard
              icon={Box}
              title="Template"
              description="Choose a proven workflow shape and customize the nodes."
              iconClassName="workflow-icon-amber"
              onClick={() => onOpenCreationMode("templates")}
            />
            <WorkflowCreationCard
              icon={Sparkles}
              title="Build with AI"
              description="Describe the trigger, tools, storage, and expected output."
              iconClassName="workflow-icon-violet"
              onClick={() => onOpenCreationMode("ai")}
            />
            <WorkflowCreationCard
              icon={FileUp}
              title="Import"
              description="Load a c0 workflow YAML export as an editable draft."
              iconClassName="workflow-icon-sky"
              onClick={() => onOpenCreationMode("import")}
            />
          </div>
        </section>

        <section className="mt-10">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-kumo-default">Existing workflows</h2>
              <p className="mt-1 text-sm text-kumo-subtle">
                Search, filter, sort, and open workflow versions.
              </p>
            </div>
          </div>

          <WorkflowIndexToolbar table={table} />
          <WorkflowIndexTable table={table} loading={loading} onSelectWorkflow={onSelectWorkflow} />
        </section>
      </div>
    </main>
  )
}

export function WorkflowCreationCard({
  icon: Icon,
  title,
  description,
  iconClassName,
  onClick,
}: {
  icon: LucideIcon
  title: string
  description: string
  iconClassName: string
  onClick: () => void
}) {
  const card = (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${title}. ${description}`}
      className="group h-full w-full rounded-xl text-left cursor-pointer focus:outline-none"
    >
      <LayerCard className="h-full w-full overflow-hidden rounded-xl shadow-sm transition-[box-shadow] group-hover:ring-1 group-hover:ring-kumo-brand/50 group-focus-visible:ring-2 group-focus-visible:ring-kumo-brand">
        <LayerCard.Secondary className="my-0 flex shrink-0 items-center justify-between gap-3 p-0 px-4 py-3">
          <span className="min-w-0 text-left text-sm font-medium leading-snug text-kumo-default">
            {title}
          </span>
          <Icon className={`h-4.5 w-4.5 flex-shrink-0 ${iconClassName}`} aria-hidden />
        </LayerCard.Secondary>
        <LayerCard.Primary className="flex flex-1 items-start rounded-lg px-4 py-4">
          <span className="text-sm text-kumo-default">{description}</span>
        </LayerCard.Primary>
      </LayerCard>
    </button>
  )

  return title === "Build with AI" ? (
    <BorderBeam
      size="pulse-inner"
      colorVariant="mono"
      theme="auto"
      borderRadius={12}
      strength={0.72}
      className="h-full rounded-xl"
    >
      {card}
    </BorderBeam>
  ) : (
    card
  )
}

export function useWorkflowIndexTable({
  data,
  columns,
  total,
  state,
  onStateChange,
}: {
  data: WorkflowSummary[]
  columns: ColumnDef<WorkflowSummary>[]
  total: number
  state: WorkflowListTableState
  onStateChange: (patch: WorkflowListStatePatch) => void
}): Table<WorkflowSummary> {
  const tableData = useMemo(() => data, [data])
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
      columnFilters: state.status ? [{ id: "status", value: state.status }] : [],
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
      const filters = applyUpdater(
        updater,
        state.status ? [{ id: "status", value: state.status }] : [],
      )
      onStateChange({
        status: String(filters.find((filter) => filter.id === "status")?.value ?? ""),
        pageIndex: 0,
      })
    },
    onSortingChange: (updater) => {
      const sorting = applyUpdater(updater, [
        { id: state.sortBy, desc: state.sortDir === "desc" },
      ]).slice(0, 1)
      const nextSort = sorting[0]
      onStateChange({
        sortBy: isWorkflowListSortBy(nextSort?.id) ? nextSort.id : "updatedAt",
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

export function WorkflowIndexToolbar({ table }: { table: Table<WorkflowSummary> }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input
        value={String(table.getState().globalFilter ?? "")}
        onChange={(event) => table.setGlobalFilter(event.target.value)}
        placeholder="Search workflows"
        aria-label="Search workflows"
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
        renderValue={(value) => formatWorkflowStatusFilterValue(value)}
        aria-label="Status"
      >
        <Select.Option value={WORKFLOW_STATUS_ALL_FILTER}>All statuses</Select.Option>
        {WORKFLOW_STATUS_FILTER_OPTIONS.map((status) => (
          <Select.Option key={status} value={status}>
            {status}
          </Select.Option>
        ))}
      </Select>
    </div>
  )
}

export function WorkflowIndexTable({
  table,
  loading,
  onSelectWorkflow,
}: {
  table: Table<WorkflowSummary>
  loading: boolean
  onSelectWorkflow: (workflowId: string) => void
}) {
  const rows = table.getRowModel().rows
  return (
    <div className="space-y-3">
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
                      <C0Loader size={32} />
                    ) : (
                      <Empty
                        title="No workflows found."
                        description="Create a workflow or adjust the table filters."
                      />
                    )}
                  </TableCellState>
                </KumoTable.Cell>
              </KumoTable.Row>
            ) : (
              rows.map((row) => (
                <KumoTable.Row
                  key={row.id}
                  onClick={() => onSelectWorkflow(row.original.id)}
                  className="cursor-pointer bg-kumo-base transition hover:bg-kumo-tint/60"
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

export function WorkflowStatusBadge({ status }: { status: WorkflowSummary["status"] }) {
  const variant: BadgeVariant =
    status === "active" ? "success" : status === "archived" ? "secondary" : "warning"
  return (
    <Badge variant={variant} className="uppercase">
      {status}
    </Badge>
  )
}

export function WorkflowSortIcon({ direction }: { direction: false | "asc" | "desc" }) {
  if (direction === "asc") {
    return <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden />
  }
  if (direction === "desc") {
    return <ChevronDown className="h-3.5 w-3.5" aria-hidden />
  }
  return <ChevronsUpDown className="h-3.5 w-3.5 text-kumo-subtle" aria-hidden />
}

export function getTableFilter<TData>(table: Table<TData>, id: string): string {
  return String(table.getColumn(id)?.getFilterValue() ?? "")
}

export function setTableFilter<TData>(table: Table<TData>, id: string, value: string) {
  table.getColumn(id)?.setFilterValue(value)
}

export function formatWorkflowStatusFilterValue(value: unknown): string {
  const status = String(value ?? "")
  return status === WORKFLOW_STATUS_ALL_FILTER ? "All statuses" : status
}

export function formatWorkflowRunStatusFilterValue(value: unknown): string {
  const status = String(value ?? "")
  return status === WORKFLOW_STATUS_ALL_FILTER ? "All statuses" : status
}

export function formatWorkflowRunTriggerFilterValue(value: unknown): string {
  const triggerKind = String(value ?? "")
  return triggerKind === WORKFLOW_STATUS_ALL_FILTER ? "All triggers" : triggerKind
}

export function applyUpdater<T>(updater: T | ((current: T) => T), current: T): T {
  return typeof updater === "function" ? (updater as (current: T) => T)(current) : updater
}

export function isWorkflowListSortBy(value: string | undefined): value is WorkflowListSortBy {
  return (
    value === "name" ||
    value === "status" ||
    value === "manifestVersion" ||
    value === "webhookId" ||
    value === "createdAt" ||
    value === "updatedAt"
  )
}

export function isWorkflowRunSortBy(value: string | undefined): value is WorkflowRunSortBy {
  return (
    value === "id" ||
    value === "workflowVersion" ||
    value === "triggerKind" ||
    value === "status" ||
    value === "startedAt" ||
    value === "completedAt" ||
    value === "updatedAt"
  )
}

export function workflowListQueryParams(state: WorkflowListTableState): URLSearchParams {
  const params = new URLSearchParams()
  params.set("limit", String(state.pageSize))
  params.set("offset", String(state.pageIndex * state.pageSize))
  params.set("sortBy", state.sortBy)
  params.set("sortDir", state.sortDir)
  if (state.q.trim()) {
    params.set("q", state.q.trim())
  }
  if (state.status.trim()) {
    params.set("status", state.status.trim())
  }
  return params
}

export function workflowRunQueryParams(state: WorkflowRunTableState): URLSearchParams {
  const params = new URLSearchParams()
  params.set("limit", String(state.pageSize))
  params.set("offset", String(state.pageIndex * state.pageSize))
  params.set("sortBy", state.sortBy)
  params.set("sortDir", state.sortDir)
  if (state.q.trim()) {
    params.set("q", state.q.trim())
  }
  if (state.status.trim()) {
    params.set("status", state.status.trim())
  }
  if (state.triggerKind.trim()) {
    params.set("triggerKind", state.triggerKind.trim())
  }
  return params
}

export function WorkflowsIndexPage({
  initialProviderSettings = null,
}: {
  initialProviderSettings?: ProviderSettingsResponse | null
}) {
  const { pathname } = useLocation()
  return (
    <WorkflowsPage
      pathname={pathname}
      routeWorkflowId={getRouteWorkflowId(pathname)}
      initialProviderSettings={initialProviderSettings}
    />
  )
}
