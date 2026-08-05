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
import { useLayoutEffect, useMemo, useState } from "react"
import { S0Loader, TableCellState } from "@/components/s0-loader"
import { CodeSurface } from "@/components/code"
import { Dialog } from "@/components/ui/dialog"
import {
  DocsSectionHeading,
  EnvLockIcon,
  Field,
  SelectField,
} from "@/components/admin-ai-provider-panel-ui"
import { getDialogSelectPortalRoot } from "@/lib/dialog-select-portal"

type SourceDraft = {
  id: string
  label: string
  description: string
  enabled: boolean
  maxResults: string
  dataSourceType: AdminAiSearchDataSource["type"]
  r2BucketName: string
  r2Prefix: string
  r2Jurisdiction: string
  websiteDomain: string
  websiteIncludePaths: string
  websiteExcludePaths: string
  websiteSpecificSitemaps: string
  websiteUseBrowserRendering: boolean
  websiteIncludeImages: boolean
}

const EMPTY_DRAFT: SourceDraft = {
  id: "",
  label: "",
  description: "",
  enabled: true,
  maxResults: "5",
  dataSourceType: "r2",
  r2BucketName: "",
  r2Prefix: "",
  r2Jurisdiction: "",
  websiteDomain: "",
  websiteIncludePaths: "",
  websiteExcludePaths: "",
  websiteSpecificSitemaps: "",
  websiteUseBrowserRendering: false,
  websiteIncludeImages: false,
}

const DATA_SOURCE_OPTIONS = [
  { value: "built-in", label: "Built-in" },
  { value: "r2", label: "R2" },
  { value: "website", label: "Website" },
]

const SOURCE_FIELD_HELP = {
  sourceId:
    "Used as the SolZero source ID, Cloudflare AI Search instance ID, and basis for MCP tool names.",
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
  const [dialogSelectPortalContainer, setDialogSelectPortalContainer] =
    useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    setDialogSelectPortalContainer(getDialogSelectPortalRoot())
  }, [])

  const editingSource = useMemo(
    () => data?.sources.find((source) => source.id === editingSourceId) ?? null,
    [data?.sources, editingSourceId],
  )
  const sourceLocked = editingSource?.locked ?? false
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
                      </KumoTable.Cell>
                      <KumoTable.Cell className="align-middle">
                        <SourceStatus enabled={source.enabled} />
                      </KumoTable.Cell>
                      <KumoTable.Cell className="align-middle">
                        <div className="flex items-center gap-2">
                          <Tooltip content="Edit source" delay={250} render={<span />}>
                            <Button
                              type="button"
                              size="sm"
                              shape="circle"
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
                              shape="circle"
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
                shape="circle"
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
                <SelectField
                  label="Data source"
                  helpText={SOURCE_FIELD_HELP.dataSource}
                  value={draft.dataSourceType}
                  options={DATA_SOURCE_OPTIONS}
                  onChange={(value) => {
                    if (isDataSourceType(value)) {
                      updateDraft("dataSourceType", value)
                    }
                  }}
                  placeholder="Select data source"
                  disabled={editingMode === "update" || sourceLocked}
                  disabledEnvVarName={sourceLockEnvVar}
                  portalContainer={dialogSelectPortalContainer}
                />
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

              <DataSourceFields
                draft={draft}
                disabled={sourceLocked}
                envVarName={sourceLockEnvVar}
                updateDraft={updateDraft}
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

function DataSourceFields({
  draft,
  disabled,
  envVarName,
  updateDraft,
}: {
  draft: SourceDraft
  disabled: boolean
  envVarName: string | null | undefined
  updateDraft: <Key extends keyof SourceDraft>(key: Key, value: SourceDraft[Key]) => void
}) {
  if (draft.dataSourceType === "built-in") {
    return (
      <p className="rounded-md bg-kumo-elevated px-3 py-2 text-sm text-kumo-subtle">
        Built-in sources do not require additional data source fields.
      </p>
    )
  }

  if (draft.dataSourceType === "r2") {
    return (
      <div className="grid gap-5 md:grid-cols-3">
        <Field
          label="R2 bucket"
          value={draft.r2BucketName}
          onChange={(value) => updateDraft("r2BucketName", value)}
          placeholder="s0-ai-search-content-prod"
          disabled={disabled}
          disabledEnvVarName={envVarName}
          required
        />
        <Field
          label="R2 prefix"
          value={draft.r2Prefix}
          onChange={(value) => updateDraft("r2Prefix", value)}
          placeholder="docs/"
          disabled={disabled}
          disabledEnvVarName={envVarName}
        />
        <Field
          label="R2 jurisdiction"
          value={draft.r2Jurisdiction}
          onChange={(value) => updateDraft("r2Jurisdiction", value)}
          placeholder="Optional"
          disabled={disabled}
          disabledEnvVarName={envVarName}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Field
        label="Website domain"
        value={draft.websiteDomain}
        onChange={(value) => updateDraft("websiteDomain", value)}
        placeholder="docs.example.com"
        disabled={disabled}
        disabledEnvVarName={envVarName}
        required
      />
      <div className="grid gap-5 md:grid-cols-3">
        <InputArea
          label="Include paths"
          value={draft.websiteIncludePaths}
          onChange={(event) => updateDraft("websiteIncludePaths", event.target.value)}
          className="min-h-28 w-full"
          placeholder="/docs/*"
          disabled={disabled}
          readOnly={disabled}
        />
        <InputArea
          label="Exclude paths"
          value={draft.websiteExcludePaths}
          onChange={(event) => updateDraft("websiteExcludePaths", event.target.value)}
          className="min-h-28 w-full"
          placeholder="/blog/*"
          disabled={disabled}
          readOnly={disabled}
        />
        <InputArea
          label="Specific sitemaps"
          value={draft.websiteSpecificSitemaps}
          onChange={(event) => updateDraft("websiteSpecificSitemaps", event.target.value)}
          className="min-h-28 w-full"
          placeholder="https://docs.example.com/sitemap.xml"
          disabled={disabled}
          readOnly={disabled}
        />
      </div>
      <div className="flex flex-wrap items-center gap-6 text-sm text-kumo-subtle">
        <ToggleField
          label="Browser rendering"
          checked={draft.websiteUseBrowserRendering}
          disabled={disabled}
          onChange={(value) => updateDraft("websiteUseBrowserRendering", value)}
        />
        <ToggleField
          label="Include images"
          checked={draft.websiteIncludeImages}
          disabled={disabled}
          onChange={(value) => updateDraft("websiteIncludeImages", value)}
        />
      </div>
    </div>
  )
}

function ToggleField({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  disabled: boolean
  label: string
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2">
      <Switch checked={checked} onCheckedChange={onChange} size="sm" disabled={disabled} />
      <span>{label}</span>
    </label>
  )
}

function SourceStatus({ enabled }: { enabled: boolean }) {
  return <Badge variant={enabled ? "secondary" : "error"}>{enabled ? "Enabled" : "Disabled"}</Badge>
}

function draftFromSource(source: AdminAiSearchSource): SourceDraft {
  const base = {
    ...EMPTY_DRAFT,
    id: source.id,
    label: source.label,
    description: source.description,
    enabled: source.enabled,
    maxResults: String(source.maxResults),
    dataSourceType: source.dataSource.type,
  }

  if (source.dataSource.type === "r2") {
    return {
      ...base,
      r2BucketName: source.dataSource.bucketName,
      r2Prefix: source.dataSource.prefix ?? "",
      r2Jurisdiction: source.dataSource.r2Jurisdiction ?? "",
    }
  }
  if (source.dataSource.type === "website") {
    return {
      ...base,
      websiteDomain: source.dataSource.domain,
      websiteIncludePaths: source.dataSource.includePaths.join("\n"),
      websiteExcludePaths: source.dataSource.excludePaths.join("\n"),
      websiteSpecificSitemaps: source.dataSource.specificSitemaps.join("\n"),
      websiteUseBrowserRendering: source.dataSource.useBrowserRendering,
      websiteIncludeImages: source.dataSource.includeImages,
    }
  }
  return base
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

  const dataSource = dataSourceFromDraft(draft)
  if (typeof dataSource === "string") {
    return dataSource
  }

  return {
    id,
    label: draft.label.trim(),
    description: draft.description.trim(),
    enabled: draft.enabled,
    maxResults,
    dataSource,
  }
}

function dataSourceFromDraft(draft: SourceDraft): AdminAiSearchDataSource | string {
  switch (draft.dataSourceType) {
    case "built-in":
      return { type: "built-in" }
    case "r2": {
      const bucketName = draft.r2BucketName.trim()
      if (!bucketName) {
        return "R2 bucket is required."
      }
      return {
        type: "r2",
        bucketName,
        prefix: draft.r2Prefix.trim() || null,
        r2Jurisdiction: draft.r2Jurisdiction.trim() || null,
      }
    }
    case "website": {
      const domain = draft.websiteDomain.trim()
      if (!domain) {
        return "Website domain is required."
      }
      return {
        type: "website",
        domain,
        includePaths: parseList(draft.websiteIncludePaths),
        excludePaths: parseList(draft.websiteExcludePaths),
        specificSitemaps: parseList(draft.websiteSpecificSitemaps),
        useBrowserRendering: draft.websiteUseBrowserRendering,
        includeImages: draft.websiteIncludeImages,
      }
    }
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

function parseList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

function isDataSourceType(value: string): value is AdminAiSearchDataSource["type"] {
  return value === "built-in" || value === "r2" || value === "website"
}
