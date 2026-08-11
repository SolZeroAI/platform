import { Badge, type BadgeVariant } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { type AdminSessionDetailResponse } from "@solzero/api"
import { RotateCcw, X } from "lucide-react"
import { CodeSurface } from "@/components/code"
import { type WorkflowRunDetail } from "@/lib/admin-console"
import { IconButton } from "./table-controls"
import { findSessionIds, formatDuration, formatTime, readNumber, readString } from "./utils"

export function SessionDetailDrawer({
  detail,
  onClose,
}: {
  detail: AdminSessionDetailResponse
  onClose: () => void
}) {
  const sandboxStatus = readString(detail.state, "sandboxStatus")
  const runtimeError = readString(detail.state, "runtimeError")
  return (
    <Drawer title="Agent details" subtitle={detail.session.id} onClose={onClose}>
      <MetadataList
        items={[
          ["Title", detail.session.title ?? detail.session.id],
          ["User", detail.session.userEmail ?? detail.session.userId],
          ["Status", detail.session.status],
          ["Sandbox", sandboxStatus ?? "unknown"],
          ["Messages", String(readNumber(detail.state, "messageCount") ?? detail.messages.length)],
          ["Repo", `${detail.session.repoOwner}/${detail.session.repoName}`],
          ["Model", detail.session.model],
          ["Updated", formatTime(detail.session.updatedAt)],
        ]}
      />
      {runtimeError ? (
        <div className="mt-3 border border-kumo-danger/30 bg-kumo-danger-tint/10 p-2 text-sm text-kumo-danger">
          {runtimeError}
        </div>
      ) : null}
      <JsonSection title="Sandbox activity" value={detail.sandboxActivity} />
      <JsonSection title="Recent messages" value={detail.messages} />
      <JsonSection title="Artifacts" value={detail.artifacts} />
    </Drawer>
  )
}

export function RunDetailDrawer({
  detail,
  busy,
  onClose,
  onSelectRun,
  onRetry,
}: {
  detail: WorkflowRunDetail
  busy: string | null
  onClose: () => void
  onSelectRun: (runId: string) => void
  onRetry: (runId: string) => void
}) {
  const selectedRun =
    detail.runs.find((run) => run.id === detail.selectedRunId) ?? detail.runs[0] ?? null
  const sessionIds = selectedRun
    ? findSessionIds([
        selectedRun.input,
        selectedRun.output,
        ...detail.events.map((event) => event.data),
      ])
    : []
  return (
    <Drawer title="Workflow runs" subtitle={detail.workflow.name} onClose={onClose}>
      <div className="mb-3 flex flex-wrap gap-2">
        {detail.runs.map((run) => (
          <Button
            key={run.id}
            type="button"
            onClick={() => onSelectRun(run.id)}
            size="xs"
            variant={run.id === selectedRun?.id ? "secondary" : "ghost"}
          >
            <span className="max-w-40 truncate font-mono">{run.id}</span>
          </Button>
        ))}
      </div>
      {selectedRun ? (
        <>
          <div className="mb-3 flex items-center justify-between gap-2">
            <StatusBadge status={selectedRun.status} />
            <IconButton
              title="Retry run"
              onClick={() => onRetry(selectedRun.id)}
              busy={busy === `workflow-retry-${selectedRun.id}`}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
            </IconButton>
          </div>
          <MetadataList
            items={[
              ["Run", selectedRun.id],
              ["Instance", selectedRun.workflowInstanceId ?? "pending"],
              ["Trigger", selectedRun.triggerKind],
              ["Version", `v${selectedRun.workflowVersion}`],
              [
                "Duration",
                formatDuration(selectedRun.startedAt, selectedRun.completedAt ?? Date.now()),
              ],
              ["Updated", formatTime(selectedRun.updatedAt)],
              ["Agents", sessionIds.join(", ") || "none"],
            ]}
          />
          {selectedRun.error ? (
            <div className="mt-3 border border-kumo-danger/30 bg-kumo-danger-tint/10 p-2 text-sm text-kumo-danger">
              {selectedRun.error}
            </div>
          ) : null}
          <JsonSection title="Input" value={selectedRun.input} />
          {selectedRun.output ? <JsonSection title="Output" value={selectedRun.output} /> : null}
          <JsonSection title="Events" value={detail.events} />
        </>
      ) : (
        <div className="text-sm text-kumo-subtle">No runs.</div>
      )}
    </Drawer>
  )
}

export function Drawer({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <aside className="fixed inset-y-3 right-3 z-30 flex w-[calc(100%-1.5rem)] max-w-xl flex-col overflow-hidden rounded-2xl border border-kumo-line bg-kumo-base shadow-xl">
      <div className="flex items-start justify-between gap-3 border-b border-kumo-hairline px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          <div className="mt-1 truncate font-mono text-xs text-kumo-subtle">{subtitle}</div>
        </div>
        <Button
          type="button"
          onClick={onClose}
          shape="circle"
          size="sm"
          variant="secondary"
          title="Close"
          aria-label="Close drawer"
          icon={<X className="h-4 w-4" aria-hidden />}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
    </aside>
  )
}

export function MetadataList({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-kumo-subtle">{label}</dt>
          <dd className="truncate text-kumo-default">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function JsonSection({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="mt-4">
      <h3 className="mb-2 text-xs font-medium uppercase text-kumo-subtle">{title}</h3>
      <CodeSurface title={title} value={JSON.stringify(value, null, 2)} language="json" />
    </section>
  )
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const normalized = status.toLowerCase()
  const variant: BadgeVariant =
    normalized === "completed" || normalized === "active" || normalized === "ready"
      ? "success"
      : normalized === "failed" || normalized === "deleted"
        ? "error"
        : normalized === "archived"
          ? "secondary"
          : "warning"
  return <Badge variant={variant}>{label ?? status}</Badge>
}
