"use client"

import type {
  AdminAiSearchDataSource,
  AdminAiSearchResponse,
  AdminAiSearchSource,
  AdminAiSearchSourcePayload,
} from "@solzero/api"
import { Badge } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { InputArea } from "@cloudflare/kumo/components/input"
import { Switch } from "@cloudflare/kumo/components/switch"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import { Tooltip, TooltipProvider } from "@cloudflare/kumo/components/tooltip"
import { Edit3, FileCode2, Plus, Save, Trash2, X } from "lucide-react"
import { useMemo, useState } from "react"
import { S0Loader, TableCellState } from "@/components/s0-loader"
import { CodeSurface } from "@/components/code"
import { Dialog } from "@/components/ui/dialog"
import { DocsSectionHeading, EnvLockIcon, Field } from "@/components/admin-ai-provider-panel-ui"
import { AiSearchItemsPanel } from "./ai-search-items-panel"
import { circleIconButton } from "@/components/ui/kumo-icon-button"

type SourceDraft = {
  id: string
  label: string
  description: string
  enabled: boolean
  maxResults: string
}

const EMPTY_DRAFT: SourceDraft = {
  id: "",
  label: "",
  description: "",
  enabled: true,
  maxResults: "5",
}

const SOURCE_FIELD_HELP = {
  sourceId:
    "Used as the source ID, Cloudflare AI Search instance ID, and basis for MCP tool names.",
  label: "Human-readable name shown to admins and used in agent-facing tool descriptions.",
  dataSource: "Cloudflare AI Search data source type backing this instance.",
  maxResults: "Maximum number of search results returned by the source search tool.",
} as const

export function AdminAiSearchPanel({
  data,
  loading,
  busy,
  onExport,
  onSaveSource,
  onDeleteSource,
}: {
  data: AdminAiSearchResponse | null
  loading: boolean
  busy: string | null
  onExport: () => Promise<string | null>
  onSaveSource: (payload: AdminAiSearchSourcePayload, mode: "create" | "update") => Promise<boolean>
  onDeleteSource: (sourceId: string) => Promise<boolean>
}) {
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null)
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false)
  const [sourcePendingDelete, setSourcePendingDelete] = useState<AdminAiSearchSource | null>(null)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportDotenv, setExportDotenv] = useState<string | null>(null)
  const [draft, setDraft] = useState<SourceDraft>(EMPTY_DRAFT)
  const [fieldError, setFieldError] = useState("")

  const [documentSourceId, setDocumentSourceId] = useState<string | null>(null)

  const editingSource = useMemo(
    () => data?.sources.find((source) => source.id === editingSourceId) ?? null,
    [data?.sources, editingSourceId],
  )

  const sourceLocked = Boolean(editingSource?.locked || editingSource?.migrationRequired)
  const sourceLockEnvVar = sourceLocked ? editingSource?.envVarName : null
  const editingMode: "create" | "update" = editingSource ? "update" : "create"

  const beginCreate = () => {
    setEditingSourceId(null)
    setDraft(EMPTY_DRAFT)
    setFieldError("")
    setSourceDialogOpen(true)
  }

  const beginEdit = (source: AdminAiSearchSource) => {
    setEditingSourceId(source.id)
    setDraft(draftFromSource(source))
    setFieldError("")
    setSourceDialogOpen(true)
  }

  const closeSourceDialog = () => {
    setSourceDialogOpen(false)
    setFieldError("")
  }

  const updateDraft = <Key extends keyof SourceDraft>(key: Key, value: SourceDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const submitSource = async () => {
    const payload = payloadFromDraft(draft)

    if (typeof payload === "string") {
      setFieldError(payload)

      return
    }

    const saved = await onSaveSource(payload, editingMode)

    if (saved) {
      closeSourceDialog()

      if (editingMode === "create") {
        setEditingSourceId(null)
        setDraft(EMPTY_DRAFT)
      }
    }
  }

  const exportConfig = async () => {
    const dotenv = await onExport()

    if (dotenv === null) {
      return
    }

    setExportDotenv(dotenv)
    setExportDialogOpen(true)
  }

  const deleteSource = async () => {
    if (!sourcePendingDelete) {
      return
    }

    const deleted = await onDeleteSource(sourcePendingDelete.id)

    if (deleted && editingSourceId === sourcePendingDelete.id) {
      setEditingSourceId(null)
      setDraft(EMPTY_DRAFT)
      closeSourceDialog()
    }

    if (deleted) {
      setSourcePendingDelete(null)
    }
  }

  return (
    <TooltipProvider>
      <div className="space-y-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight text-kumo-default">AI Search</h1>
            <p className="max-w-3xl text-lg text-kumo-strong">
              Global Cloudflare AI Search sources available to all agent sessions.
            </p>
          </div>
        </div>

        <section className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DocsSectionHeading id="ai-search-sources" level="h2" title="Sources" />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                icon={<FileCode2 className="h-4 w-4" aria-hidden />}
                loading={busy === "ai-search-export"}
                disabled={busy !== null || loading}
                onClick={() => void exportConfig()}
              >
                Export config
              </Button>
              <Button
                type="button"
                variant="secondary"
                icon={<Plus className="h-4 w-4" aria-hidden />}
                disabled={busy !== null || loading}
                onClick={beginCreate}
              >
                New Source
              </Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg bg-kumo-elevated/80 [container-type:inline-size]">
            <KumoTable layout="fixed" className="w-full text-sm">
              <colgroup>
                <col className="w-[44%]" />
                <col className="w-[27%]" />
                <col className="w-[13%]" />
                <col />
              </colgroup>
              <KumoTable.Header variant="compact" className="text-kumo-subtle!">
                <KumoTable.Row>
                  <KumoTable.Head>Source</KumoTable.Head>
                  <KumoTable.Head>Data</KumoTable.Head>
                  <KumoTable.Head>Status</KumoTable.Head>
                  <KumoTable.Head>Actions</KumoTable.Head>
                </KumoTable.Row>
              </KumoTable.Header>
              <KumoTable.Body>
                {(data?.sources ?? []).length === 0 ? (
                  <KumoTable.Row>
                    <KumoTable.Cell colSpan={4} className="h-32 text-kumo-subtle">
                      <TableCellState className="h-full">
                        {loading ? <S0Loader size={32} /> : "No AI Search sources configured."}
                      </TableCellState>
                    </KumoTable.Cell>
                  </KumoTable.Row>
                ) : (
                  data!.sources.map((source) => (
                    <KumoTable.Row key={source.id}>
                      <KumoTable.Cell className="align-middle">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium text-kumo-default">
                            {source.label}
                          </span>
                          <EnvLockIcon envVarName={source.envVarName} />
                        </div>
                        <div className="truncate text-xs text-kumo-subtle">{source.id}</div>
                      </KumoTable.Cell>
                      <KumoTable.Cell className="align-middle text-kumo-subtle">
                        <div>{formatDataSource(source.dataSource)}</div>
                        {source.migrationRequired && (
                          <p>
                            Migration required. Export the source and copy its documents to a new
                            built-in source before replacing references. Existing content is
                            retained.
                          </p>
                        )}
                      </KumoTable.Cell>
                      <KumoTable.Cell className="align-middle">
                        <SourceStatus enabled={source.enabled} />
                      </KumoTable.Cell>
                      <KumoTable.Cell className="align-middle">
                        <div className="flex items-center gap-2">
                          {!source.migrationRequired && (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => setDocumentSourceId(source.id)}
                            >
                              Documents
                            </Button>
                          )}
                          <Tooltip content="Edit source" delay={250} render={<span />}>
                            <Button
                              type="button"
                              size="sm"
                              {...circleIconButton}
                              variant="secondary"
                              aria-label={`Edit ${source.label}`}
                              icon={<Edit3 className="h-4 w-4" aria-hidden />}
                              onClick={() => beginEdit(source)}
                            />
                          </Tooltip>
                          <Tooltip content="Delete source" delay={250} render={<span />}>
                            <Button
                              type="button"
                              size="sm"
                              {...circleIconButton}
                              variant="secondary-destructive"
                              aria-label={`Delete ${source.label}`}
                              icon={<Trash2 className="h-4 w-4" aria-hidden />}
                              disabled={source.locked || busy !== null}
                              loading={busy === `ai-search-source-delete-${source.id}`}
                              onClick={() => setSourcePendingDelete(source)}
                            />
                          </Tooltip>
                        </div>
                      </KumoTable.Cell>
                    </KumoTable.Row>
                  ))
                )}
              </KumoTable.Body>
            </KumoTable>
          </div>
        </section>

        {documentSourceId && (
          <AiSearchItemsPanel
            sourceId={documentSourceId}
            onClose={() => setDocumentSourceId(null)}
          />
        )}
        <Dialog.Root
          open={sourceDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              closeSourceDialog()

              return
            }

            setSourceDialogOpen(true)
          }}
        >
          <Dialog className="flex max-h-[88dvh] w-full max-w-4xl flex-col bg-kumo-canvas p-0">
            <div className="flex items-start justify-between gap-4 border-b border-kumo-hairline px-5 py-4">
              <div>
                <div className="flex items-center gap-3">
                  <Dialog.Title className="text-lg font-semibold leading-6 text-kumo-default">
                    {editingSource ? "Edit Source" : "Create Source"}
                  </Dialog.Title>
                  <EnvLockIcon envVarName={sourceLockEnvVar} />
                </div>
                <Dialog.Description className="mt-1 text-sm text-kumo-subtle">
                  Configure the Cloudflare AI Search instance exposed to agent sessions.
                </Dialog.Description>
              </div>
              <Button
                type="button"
                variant="ghost"
                {...circleIconButton}
                icon={<X className="h-4 w-4" aria-hidden />}
                aria-label="Close AI Search source dialog"
                onClick={closeSourceDialog}
              />
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {fieldError ? <p className="text-sm text-kumo-error">{fieldError}</p> : null}
              <div className="grid gap-5 md:grid-cols-2">
                <Field
                  label="ID"
                  helpText={SOURCE_FIELD_HELP.sourceId}
                  value={draft.id}
                  onChange={(value) => updateDraft("id", value)}
                  placeholder="product-docs"
                  disabled={editingMode === "update" || sourceLocked}
                  disabledEnvVarName={sourceLockEnvVar}
                  required
                />
                <Field
                  label="Label"
                  helpText={SOURCE_FIELD_HELP.label}
                  value={draft.label}
                  onChange={(value) => updateDraft("label", value)}
                  placeholder="Product docs"
                  disabled={sourceLocked}
                  disabledEnvVarName={sourceLockEnvVar}
                  required
                />
                <p className="text-sm text-kumo-subtle">Documents use built-in storage.</p>
                <Field
                  label="Max results"
                  helpText={SOURCE_FIELD_HELP.maxResults}
                  value={draft.maxResults}
                  onChange={(value) => updateDraft("maxResults", value)}
                  placeholder="5"
                  type="number"
                  disabled={sourceLocked}
                  disabledEnvVarName={sourceLockEnvVar}
                />
              </div>

              <InputArea
                label="Description"
                value={draft.description}
                onChange={(event) => updateDraft("description", event.target.value)}
                className="min-h-24 w-full"
                placeholder="Short source description shown to agents."
                disabled={sourceLocked}
                readOnly={sourceLocked}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-kumo-hairline px-5 py-4">
              <div className="flex items-center gap-2">
                <EnvLockIcon envVarName={sourceLockEnvVar} />
                <Switch
                  aria-label="Enable AI Search source"
                  checked={draft.enabled}
                  onCheckedChange={(value) => updateDraft("enabled", value)}
                  size="sm"
                  disabled={sourceLocked}
                />
                <span className="text-sm text-kumo-subtle">
                  {draft.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" onClick={closeSourceDialog}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  icon={<Save className="h-4 w-4" aria-hidden />}
                  loading={busy === `ai-search-source-${editingMode}-${draft.id}`}
                  disabled={sourceLocked || busy !== null || loading}
                  onClick={() => void submitSource()}
                >
                  {editingSource ? "Save Source" : "Create Source"}
                </Button>
              </div>
            </div>
          </Dialog>
        </Dialog.Root>

        {exportDotenv !== null ? (
          <CodeSurface
            title="AI Search registry export"
            description="Portable runtime registry data for an explicit Admin import or migration; it is not deployment environment configuration."
            value={exportDotenv}
            language="text"
            open={exportDialogOpen}
            onOpenChange={setExportDialogOpen}
            trigger={() => null}
          />
        ) : null}

        <Dialog.Root
          open={sourcePendingDelete !== null}
          role="alertdialog"
          onOpenChange={(open) => {
            if (busy?.startsWith("ai-search-source-delete-")) {
              return
            }

            if (!open) {
              setSourcePendingDelete(null)
            }
          }}
        >
          <Dialog className="flex w-full max-w-md flex-col p-0">
            <div className="border-b border-kumo-hairline px-5 py-4">
              <Dialog.Title className="text-lg font-semibold leading-6 text-kumo-default">
                Delete AI Search source?
              </Dialog.Title>
            </div>
            <Dialog.Description className="px-5 py-4 text-sm leading-5 text-kumo-subtle">
              This deletes {sourcePendingDelete?.label ?? "this source"} and its Cloudflare AI
              Search instance. This action cannot be undone.
            </Dialog.Description>
            <div className="flex justify-end gap-2 border-t border-kumo-hairline px-5 py-4">
              <Button
                type="button"
                variant="ghost"
                disabled={busy?.startsWith("ai-search-source-delete-")}
                onClick={() => setSourcePendingDelete(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="secondary-destructive"
                icon={<Trash2 className="h-4 w-4" aria-hidden />}
                loading={
                  sourcePendingDelete !== null &&
                  busy === `ai-search-source-delete-${sourcePendingDelete.id}`
                }
                disabled={sourcePendingDelete === null || busy !== null}
                onClick={() => void deleteSource()}
              >
                Delete source
              </Button>
            </div>
          </Dialog>
        </Dialog.Root>
      </div>
    </TooltipProvider>
  )
}

function SourceStatus({ enabled }: { enabled: boolean }) {
  return <Badge variant={enabled ? "secondary" : "error"}>{enabled ? "Enabled" : "Disabled"}</Badge>
}

function draftFromSource(source: AdminAiSearchSource): SourceDraft {
  return {
    id: source.id,
    label: source.label,
    description: source.description,
    enabled: source.enabled,
    maxResults: String(source.maxResults),
  }
}

function payloadFromDraft(draft: SourceDraft): AdminAiSearchSourcePayload | string {
  const id = draft.id.trim()

  if (!id) {
    return "ID is required."
  }

  const maxResults = Number(draft.maxResults)

  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 20) {
    return "Max results must be an integer between 1 and 20."
  }

  return {
    id,
    label: draft.label.trim(),
    description: draft.description.trim(),
    enabled: draft.enabled,
    maxResults,
    dataSource: { type: "built-in" },
  }
}

function formatDataSource(dataSource: AdminAiSearchDataSource): string {
  switch (dataSource.type) {
    case "built-in":
      return "Built-in"
    case "r2":
      return dataSource.prefix
        ? `R2 ${dataSource.bucketName}/${dataSource.prefix}`
        : `R2 ${dataSource.bucketName}`
    case "website":
      return `Website ${dataSource.domain}`
  }
}
