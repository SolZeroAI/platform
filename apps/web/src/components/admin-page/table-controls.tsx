import { Button } from "@cloudflare/kumo/components/button"
import { Empty } from "@cloudflare/kumo/components/empty"
import { Input } from "@cloudflare/kumo/components/input"
import { Pagination } from "@cloudflare/kumo/components/pagination"
import { Select } from "@cloudflare/kumo/components/select"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import { type AdminSessionRecord, type AdminWorkflowRecord } from "@c0/api"
import { type Table } from "@tanstack/react-table"
import { flexRender } from "@tanstack/react-table"
import { ChevronDown, ChevronsUpDown } from "lucide-react"
import { C0Loader, TableCellState } from "@/components/c0-loader"
import {
  PAGE_SIZE_OPTIONS,
  SESSION_RUNTIME_OPTIONS,
  SESSION_SOURCE_OPTIONS,
  SESSION_STATUS_OPTIONS,
  WORKFLOW_STATUS_OPTIONS,
} from "@/lib/admin-console"
import {
  formatAdminSessionRuntimeFilter,
  formatAdminSessionSourceFilter,
  formatAdminSessionStatusFilter,
  formatAdminWorkflowStatusFilter,
  getTableFilter,
  setTableFilter,
} from "./utils"

export const FILTER_ALL = "all"

export function SessionsToolbar({ table }: { table: Table<AdminSessionRecord> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <GlobalSearch table={table} placeholder="Search agents" />
      <FilterSelect
        table={table}
        id="status"
        label="Status"
        options={SESSION_STATUS_OPTIONS}
        formatOption={formatAdminSessionStatusFilter}
      />
      <FilterSelect
        table={table}
        id="agentRuntime"
        label="Runtime"
        options={SESSION_RUNTIME_OPTIONS}
        formatOption={formatAdminSessionRuntimeFilter}
      />
      <FilterSelect
        table={table}
        id="source"
        label="Source"
        options={SESSION_SOURCE_OPTIONS}
        formatOption={formatAdminSessionSourceFilter}
      />
      <FilterInput table={table} id="userId" placeholder="User ID" />
      <FilterInput table={table} id="repoOwner" placeholder="Repo owner" />
      <FilterInput table={table} id="repoName" placeholder="Repo name" />
    </div>
  )
}

export function WorkflowsToolbar({ table }: { table: Table<AdminWorkflowRecord> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <GlobalSearch table={table} placeholder="Search workflows" />
      <FilterSelect
        table={table}
        id="status"
        label="Status"
        options={WORKFLOW_STATUS_OPTIONS}
        formatOption={formatAdminWorkflowStatusFilter}
      />
      <FilterInput table={table} id="userId" placeholder="User ID" />
    </div>
  )
}

export function GlobalSearch<TData>({
  table,
  placeholder,
}: {
  table: Table<TData>
  placeholder: string
}) {
  return (
    <Input
      value={String(table.getState().globalFilter ?? "")}
      onChange={(event) => table.setGlobalFilter(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="min-w-[240px]"
      passwordManagerIgnore
    />
  )
}

export function FilterSelect<TData>({
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
        return formatOption ? formatOption(normalized) : normalized
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

export function FilterInput<TData>({
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

export function AdminDataTable<TData>({
  table,
  loading,
  empty,
}: {
  table: Table<TData>
  loading: boolean
  empty: string
}) {
  const rows = table.getRowModel().rows
  const leafColumnCount = table.getAllLeafColumns().length
  return (
    <div className="space-y-2">
      <div className="overflow-auto rounded-xl bg-kumo-elevated/80 [container-type:inline-size]">
        <KumoTable className="min-w-full text-left text-sm">
          <KumoTable.Header sticky className="bg-kumo-tint text-xs">
            {table.getHeaderGroups().map((headerGroup) => (
              <KumoTable.Row key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <KumoTable.Head key={header.id} className="bg-kumo-tint px-3 py-2 font-medium">
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <Button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        variant="ghost"
                        size="xs"
                        className="-mx-1 justify-start px-1 text-left font-medium"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <SortIcon direction={header.column.getIsSorted()} />
                      </Button>
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
                  colSpan={leafColumnCount}
                  className="h-48 border-b border-kumo-hairline px-3 py-3 text-sm text-kumo-subtle"
                >
                  <TableCellState className="h-full">
                    {loading ? (
                      <C0Loader size={32} />
                    ) : (
                      <Empty title={empty} description="Adjust the filters or refresh the table." />
                    )}
                  </TableCellState>
                </KumoTable.Cell>
              </KumoTable.Row>
            ) : (
              rows.map((row) => (
                <KumoTable.Row
                  key={row.id}
                  className="bg-kumo-base transition hover:bg-kumo-tint/60"
                >
                  {row.getVisibleCells().map((cell) => (
                    <KumoTable.Cell
                      key={cell.id}
                      className="border-b border-kumo-hairline px-3 py-3 align-top"
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
      <TablePagination table={table} loading={loading} />
    </div>
  )
}

export function SortIcon({ direction }: { direction: false | "asc" | "desc" }) {
  if (direction === "asc") {
    return <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden />
  }
  if (direction === "desc") {
    return <ChevronDown className="h-3.5 w-3.5" aria-hidden />
  }
  return <ChevronsUpDown className="h-3.5 w-3.5 text-kumo-subtle" aria-hidden />
}

export function TablePagination<TData>({
  table,
  loading,
}: {
  table: Table<TData>
  loading: boolean
}) {
  const { pageIndex, pageSize } = table.getState().pagination
  return (
    <Pagination
      page={pageIndex + 1}
      setPage={(page) => {
        if (!loading) {
          table.setPageIndex(page - 1)
        }
      }}
      perPage={pageSize}
      totalCount={table.getRowCount()}
      className="justify-between"
    >
      <Pagination.Info />
      <Pagination.Separator />
      <Pagination.PageSize
        value={pageSize}
        onChange={(size) => {
          if (!loading) {
            table.setPageSize(size)
          }
        }}
        options={[...PAGE_SIZE_OPTIONS]}
      />
      <Pagination.Controls controls="simple" />
    </Pagination>
  )
}

export function IdentityCell({
  title,
  subtitle,
  mono,
}: {
  title: string
  subtitle: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="max-w-[260px] truncate text-kumo-default">{title}</div>
      <div className={`max-w-[260px] truncate text-xs text-kumo-subtle ${mono ? "font-mono" : ""}`}>
        {subtitle}
      </div>
    </div>
  )
}

export function ActionGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>
}

export function IconButton({
  title,
  children,
  danger,
  busy,
  disabled,
  onClick,
}: {
  title: string
  children: React.ReactNode
  danger?: boolean
  busy?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      title={title}
      aria-label={title}
      shape="circle"
      size="sm"
      variant={danger ? "secondary-destructive" : "secondary"}
      loading={busy}
      icon={busy ? undefined : children}
    />
  )
}
