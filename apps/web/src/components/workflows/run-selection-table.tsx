import { Checkbox } from "@cloudflare/kumo/components/checkbox"
import { Empty } from "@cloudflare/kumo/components/empty"
import { Pagination } from "@cloudflare/kumo/components/pagination"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import { type ColumnDef, flexRender } from "@tanstack/react-table"
import { useMemo } from "react"
import { S0Loader, TableCellState } from "@/components/s0-loader"
import { WORKFLOW_PAGE_SIZE_OPTIONS } from "./types"
import { type WorkflowRun, type WorkflowRunStatePatch, type WorkflowRunTableState } from "./types"
import { WorkflowSortIcon } from "./index-page"
import { RunHistoryToolbar, useWorkflowRunTable, WORKFLOW_RUN_COLUMNS } from "./overview"

export function WorkflowRunSelectionTable({
  runs,
  total,
  state,
  loading,
  selectedRunIds,
  onStateChange,
  onToggleRun,
  onToggleVisibleRuns,
}: {
  runs: WorkflowRun[]
  total: number
  state: WorkflowRunTableState
  loading: boolean
  selectedRunIds: ReadonlySet<string>
  onStateChange: (patch: WorkflowRunStatePatch) => void
  onToggleRun: (run: WorkflowRun, selected: boolean) => void
  onToggleVisibleRuns: (runs: WorkflowRun[], selected: boolean) => void
}) {
  const visibleRunIds = runs.map((run) => run.id)
  const visibleSelectedCount = visibleRunIds.filter((id) => selectedRunIds.has(id)).length
  const allVisibleSelected = runs.length > 0 && visibleSelectedCount === runs.length
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected
  const selectionColumn = useMemo<ColumnDef<WorkflowRun>>(
    () => ({
      id: "selection",
      header: () => (
        <div onClick={(event) => event.stopPropagation()}>
          <Checkbox
            aria-label="Select all visible workflow runs"
            checked={allVisibleSelected}
            indeterminate={someVisibleSelected}
            onCheckedChange={(checked) => onToggleVisibleRuns(runs, checked)}
          />
        </div>
      ),
      enableSorting: false,
      cell: ({ row }) => (
        <div onClick={(event) => event.stopPropagation()}>
          <Checkbox
            aria-label={`Select workflow run ${row.original.id}`}
            checked={selectedRunIds.has(row.original.id)}
            onCheckedChange={(checked) => onToggleRun(row.original, checked)}
          />
        </div>
      ),
    }),
    [
      allVisibleSelected,
      onToggleRun,
      onToggleVisibleRuns,
      runs,
      selectedRunIds,
      someVisibleSelected,
    ],
  )
  const columns = useMemo(() => [selectionColumn, ...WORKFLOW_RUN_COLUMNS], [selectionColumn])
  const table = useWorkflowRunTable({ data: runs, columns, total, state, onStateChange })
  const rows = table.getRowModel().rows

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-5 py-4">
      <RunHistoryToolbar table={table} />
      <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-kumo-elevated/80 [container-type:inline-size]">
        <KumoTable className="min-w-[960px] text-left text-sm">
          <KumoTable.Header sticky className="bg-kumo-tint text-xs">
            {table.getHeaderGroups().map((headerGroup) => (
              <KumoTable.Row key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <KumoTable.Head key={header.id} className="bg-kumo-tint px-3 py-2 font-medium">
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="flex items-center gap-1 text-left"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <WorkflowSortIcon direction={header.column.getIsSorted()} />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
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
              rows.map((row) => {
                const selected = selectedRunIds.has(row.original.id)
                return (
                  <KumoTable.Row
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    onClick={() => onToggleRun(row.original, !selected)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        onToggleRun(row.original, !selected)
                      }
                    }}
                    className={`cursor-pointer bg-kumo-base outline-none transition hover:bg-kumo-tint/60 focus:bg-kumo-tint ${selected ? "bg-kumo-tint" : ""}`}
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
                )
              })
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
