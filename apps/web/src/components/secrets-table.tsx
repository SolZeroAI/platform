"use client"

import { Badge } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { Empty } from "@cloudflare/kumo/components/empty"
import { InputGroup } from "@cloudflare/kumo/components/input-group"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { ChevronDown, ChevronsUpDown, Pencil } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { S0Loader, TableCellState } from "@/components/s0-loader"
import { SecretsSearchFilter } from "@/components/secrets-search-filter"
import { Dialog } from "@/components/ui/dialog"
import {
  recessedInputGroupClassName,
  recessedInputGroupWithButtonClassName,
} from "@/lib/recessed-field"
import { getUtf8Size, MAX_VALUE_SIZE, validateKey } from "@/lib/secrets-validation"

export type SecretsTableRow = {
  id: string
  key: string
  value: string
  tags: string[]
  tagDraft: string
  existing: boolean
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

type SecretFieldErrors = {
  key?: string
  value?: string
}

function SecretEditDialog({
  row,
  existingKeys,
  disabled,
  deleting,
  open,
  onOpenChange,
  onCancel,
  onSave,
  onDelete,
}: {
  row: SecretsTableRow | null
  existingKeys: string[]
  disabled: boolean
  deleting: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancel: () => void
  onSave: (patch: Pick<SecretsTableRow, "key" | "value" | "tags" | "tagDraft">) => void
  onDelete: () => void
}) {
  const [key, setKey] = useState("")
  const [value, setValue] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState("")
  const [fieldErrors, setFieldErrors] = useState<SecretFieldErrors>({})

  useEffect(() => {
    if (!row || !open) {
      return
    }
    setKey(row.key)
    setValue(row.value)
    setTags(row.tags)
    setTagDraft(row.tagDraft)
    setFieldErrors({})
  }, [open, row])

  const addTag = () => {
    const nextTag = tagDraft.trim()
    if (!nextTag) {
      return
    }
    setTags((current) => Array.from(new Set([...current, nextTag])).sort())
    setTagDraft("")
  }

  const validateFields = (): SecretFieldErrors => {
    if (!row) {
      return {}
    }

    const errors: SecretFieldErrors = {}
    const trimmedKey = key.trim()
    const trimmedValue = value.trim()

    if (!row.existing) {
      const keyError = validateKey(trimmedKey)
      if (keyError) {
        errors.key = keyError
      } else if (existingKeys.includes(trimmedKey)) {
        errors.key = `Duplicate key '${trimmedKey}'`
      }

      if (!trimmedValue) {
        errors.value = "Value is required"
      }
    }

    if (trimmedValue) {
      const valueSize = getUtf8Size(trimmedValue)
      if (valueSize > MAX_VALUE_SIZE) {
        errors.value = `Value exceeds ${MAX_VALUE_SIZE} bytes`
      }
    }

    return errors
  }

  const handleSave = () => {
    const errors = validateFields()
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    onSave({ key: key.trim(), value, tags, tagDraft })
    onOpenChange(false)
  }

  if (!row) {
    return null
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog className="flex w-full max-w-lg flex-col p-0">
        <div className="border-b border-kumo-hairline px-5 py-4">
          <Dialog.Title className="text-lg font-semibold leading-6 text-kumo-default">
            {row.existing ? "Edit secret" : "Add secret"}
          </Dialog.Title>
          {row.existing ? (
            <Dialog.Description className="mt-1 break-all font-mono text-sm text-kumo-subtle">
              {row.key}
            </Dialog.Description>
          ) : (
            <Dialog.Description className="mt-1 text-sm text-kumo-subtle">
              Create a new secret with a key, value, and optional tags.
            </Dialog.Description>
          )}
        </div>

        <div className="space-y-3 px-5 py-4">
          {!row.existing ? (
            <InputGroup
              label="Key"
              size="sm"
              required
              disabled={disabled}
              className={recessedInputGroupClassName}
              error={fieldErrors.key ? { message: fieldErrors.key, match: true } : undefined}
            >
              <InputGroup.Input
                aria-label="Secret key"
                value={key}
                onChange={(event) => {
                  setKey(event.target.value)
                  if (fieldErrors.key) {
                    setFieldErrors((current) => ({ ...current, key: undefined }))
                  }
                }}
                placeholder="KEY_NAME"
                className="font-mono"
              />
            </InputGroup>
          ) : null}

          <InputGroup
            label={row.existing ? "Secret value" : "Value"}
            size="sm"
            required={!row.existing}
            disabled={disabled}
            description={
              row.existing ? "Enter a new value to overwrite the existing value" : undefined
            }
            className={recessedInputGroupClassName}
            error={fieldErrors.value ? { message: fieldErrors.value, match: true } : undefined}
          >
            <InputGroup.Input
              aria-label="Secret value"
              type="password"
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                if (fieldErrors.value) {
                  setFieldErrors((current) => ({ ...current, value: undefined }))
                }
              }}
              placeholder={row.existing ? "Value encrypted" : "value"}
            />
          </InputGroup>

          <div className="space-y-2 mt-4">
            <p className="text-sm font-medium text-kumo-default">Tags</p>
            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="rounded-full border border-kumo-hairline px-2 py-0.5 font-mono text-[11px] text-kumo-subtle hover:border-kumo-danger hover:text-kumo-danger"
                    onClick={() => setTags((current) => current.filter((item) => item !== tag))}
                  >
                    {tag} x
                  </button>
                ))}
              </div>
            ) : (
              <div />
            )}
            <InputGroup
              size="sm"
              disabled={disabled}
              className={recessedInputGroupWithButtonClassName}
            >
              <InputGroup.Input
                aria-label={`Add tag for ${row.key}`}
                value={tagDraft}
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    addTag()
                  }
                }}
                placeholder="repo:owner/name"
              />
              <InputGroup.Button type="button" variant="secondary" size="sm" onClick={addTag}>
                Add tag
              </InputGroup.Button>
            </InputGroup>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-kumo-hairline px-5 py-4">
          {row.existing ? (
            <Button
              type="button"
              variant="secondary-destructive"
              onClick={onDelete}
              disabled={disabled || deleting}
              loading={deleting}
            >
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={disabled}
              variant="primary"
              className="text-white"
            >
              Save
            </Button>
          </div>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}

export function SecretsTable({
  rows,
  loading,
  saving,
  deletingKey,
  disabled,
  error,
  success,
  allTags,
  selectedTags,
  onSelectedTagsChange,
  keySearch,
  onKeySearchChange,
  searchLoading,
  onRemoveRow,
  onAddSecret,
  onRegisterAddSecret,
  onDeleteSecret,
  onSave,
}: {
  rows: SecretsTableRow[]
  loading: boolean
  saving: boolean
  deletingKey: string | null
  disabled: boolean
  error: string
  success: string
  allTags: string[]
  selectedTags: string[]
  onSelectedTagsChange: (tags: string[]) => void
  keySearch: string
  onKeySearchChange: (value: string) => void
  searchLoading: boolean
  onRemoveRow: (rowId: string) => void
  onAddSecret: () => SecretsTableRow
  onRegisterAddSecret?: (openCreateDialog: () => void) => void
  onDeleteSecret: (row: SecretsTableRow) => void | Promise<void>
  onSave: (pendingUpdate: {
    rowId: string
    patch: Pick<SecretsTableRow, "key" | "value" | "tags" | "tagDraft">
  }) => void | Promise<void>
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "key", desc: false }])
  const [editingRow, setEditingRow] = useState<SecretsTableRow | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)

  const tableRows = useMemo(() => rows.filter((row) => row.key.trim().length > 0), [rows])

  const columns = useMemo<ColumnDef<SecretsTableRow>[]>(
    () => [
      {
        accessorKey: "key",
        header: "Key",
        cell: ({ row }) => (
          <span
            className="block truncate font-mono text-xs text-kumo-default"
            title={row.original.key}
          >
            {row.original.key}
          </span>
        ),
      },
      {
        id: "tags",
        accessorFn: (row) => row.tags.join(", "),
        header: "Tags",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.tags.length > 0 ? (
            <div className="flex max-h-12 flex-wrap gap-1 overflow-hidden">
              {row.original.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="shrink-0">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-kumo-subtle">—</span>
          ),
      },
      {
        id: "actions",
        enableSorting: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            shape="square"
            aria-label={`Edit ${row.original.key}`}
            icon={<Pencil className="h-3 w-3" aria-hidden />}
            onClick={() => {
              setEditingRow(row.original)
              setEditDialogOpen(true)
            }}
          />
        ),
      },
    ],
    [],
  )

  const table = useReactTable({
    data: tableRows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const bodyRows = table.getRowModel().rows

  const openCreateDialog = useCallback(() => {
    const row = onAddSecret()
    setEditingRow(row)
    setEditDialogOpen(true)
  }, [onAddSecret])

  const existingKeys = useMemo(
    () =>
      rows
        .filter((row) => row.id !== editingRow?.id)
        .map((row) => row.key.trim())
        .filter((key) => key.length > 0),
    [editingRow?.id, rows],
  )

  useEffect(() => {
    if (!onRegisterAddSecret) {
      return
    }
    onRegisterAddSecret(openCreateDialog)
    return () => onRegisterAddSecret(() => {})
  }, [onRegisterAddSecret, openCreateDialog])

  return (
    <>
      <div className="mt-2 space-y-3">
        <SecretsSearchFilter
          keySearch={keySearch}
          onKeySearchChange={onKeySearchChange}
          searchLoading={searchLoading}
          allTags={allTags}
          selectedTags={selectedTags}
          onSelectedTagsChange={onSelectedTagsChange}
        />

        {error ? <p className="text-xs text-kumo-danger">{error}</p> : null}
        {success ? <p className="text-xs text-kumo-success">{success}</p> : null}

        <div className="overflow-auto rounded-xl bg-kumo-elevated/80 [container-type:inline-size]">
          <KumoTable layout="fixed" className="w-max min-w-full">
            <colgroup>
              <col className="w-[300px]" />
              <col />
              <col className="w-12" />
            </colgroup>
            <KumoTable.Header variant="compact">
              {table.getHeaderGroups().map((headerGroup) => (
                <KumoTable.Row key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const isActions = header.column.id === "actions"
                    return (
                      <KumoTable.Head
                        key={header.id}
                        sticky={isActions ? "right" : undefined}
                        className={isActions ? "bg-kumo-elevated! text-right" : undefined}
                      >
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="flex items-center gap-1 text-left"
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <SortIcon direction={header.column.getIsSorted()} />
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </KumoTable.Head>
                    )
                  })}
                </KumoTable.Row>
              ))}
            </KumoTable.Header>
            <KumoTable.Body>
              {bodyRows.length === 0 ? (
                <KumoTable.Row>
                  <KumoTable.Cell
                    colSpan={columns.length}
                    className="px-3 py-10 text-sm text-kumo-subtle"
                  >
                    <TableCellState>
                      {loading ? (
                        <S0Loader size={32} />
                      ) : (
                        <Empty
                          title="No secrets found"
                          description="Adjust search or tag filters, or add a secret."
                        />
                      )}
                    </TableCellState>
                  </KumoTable.Cell>
                </KumoTable.Row>
              ) : (
                bodyRows.map((row) => (
                  <KumoTable.Row key={row.id}>
                    {row.getVisibleCells().map((cell) => {
                      const isActions = cell.column.id === "actions"
                      const isKey = cell.column.id === "key"
                      const isTags = cell.column.id === "tags"
                      return (
                        <KumoTable.Cell
                          key={cell.id}
                          sticky={isActions ? "right" : undefined}
                          className={
                            isActions
                              ? "text-right whitespace-nowrap"
                              : isKey
                                ? "max-w-[100px] whitespace-nowrap"
                                : isTags
                                  ? "whitespace-normal"
                                  : undefined
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
      </div>

      <SecretEditDialog
        row={editingRow}
        existingKeys={existingKeys}
        disabled={disabled || saving}
        deleting={Boolean(editingRow && deletingKey === editingRow.key)}
        open={editDialogOpen}
        onOpenChange={(open) => {
          setEditDialogOpen(open)
          if (!open) {
            setEditingRow(null)
          }
        }}
        onCancel={() => {
          if (editingRow && !editingRow.existing) {
            onRemoveRow(editingRow.id)
          }
          setEditDialogOpen(false)
          setEditingRow(null)
        }}
        onSave={(patch) => {
          if (!editingRow) {
            return
          }
          void onSave({ rowId: editingRow.id, patch })
        }}
        onDelete={() => {
          if (!editingRow) {
            return
          }
          void onDeleteSecret(editingRow)
          setEditDialogOpen(false)
          setEditingRow(null)
        }}
      />
    </>
  )
}
