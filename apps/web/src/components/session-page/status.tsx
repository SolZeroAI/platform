import { Badge, type BadgeVariant } from "@cloudflare/kumo/components/badge"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import {
  formatAgentRuntimeLabel,
  resolveAgentRuntime,
  type AgentRuntime,
  type RuntimeActivityEvent,
  type SessionKind,
  type SessionRuntimeCapabilities,
} from "@c0-agent/shared"
import { Activity, Clock, Server, Zap } from "lucide-react"
import { C0Loader } from "@/components/c0-loader"
import { AgentRuntimeIcon } from "@/components/home-page/session-kind"

export function getRuntimeStatusPresentation(
  status: string,
  runtimeLabel: string,
): { color: string; detail: string } {
  const r = runtimeLabel.toLowerCase()
  const table: Record<string, { color: string; detail: string }> = {
    pending: {
      color: "text-kumo-subtle",
      detail: `The ${r} runtime has not started yet. Send a new prompt to wake it.`,
    },
    spawning: {
      color: "text-kumo-warning",
      detail: `The ${r} runtime is being provisioned.`,
    },
    connecting: {
      color: "text-kumo-warning",
      detail: `The ${r} runtime is connecting.`,
    },
    warming: {
      color: "text-kumo-warning",
      detail: `The ${r} runtime is waking up.`,
    },
    syncing: {
      color: "text-kumo-brand",
      detail: `The ${r} runtime is syncing its configuration.`,
    },
    ready: {
      color: "text-kumo-success",
      detail: `${runtimeLabel} is ready.`,
    },
    running: {
      color: "text-kumo-brand",
      detail: `${runtimeLabel} is actively processing a task.`,
    },
    stopped: {
      color: "text-kumo-subtle",
      detail: `${runtimeLabel} is not currently running. Send a new prompt to wake it.`,
    },
    stale: {
      color: "text-kumo-subtle",
      detail: `${runtimeLabel} may be out of date after a connection loss. Send a new prompt to refresh.`,
    },
    failed: {
      color: "text-kumo-danger",
      detail: `${runtimeLabel} failed to start. Send a new prompt to retry.`,
    },
  }
  return table[status] ?? table.pending
}

export function getRuntimeStatusBadgeVariant(status: string): BadgeVariant {
  if (status === "ready") {
    return "success"
  }
  if (status === "failed") {
    return "error"
  }
  if (status === "spawning" || status === "connecting" || status === "warming") {
    return "warning"
  }
  if (status === "running" || status === "syncing") {
    return "info"
  }
  return "secondary"
}

export function formatActivityDuration(durationMs: number | null): string | null {
  if (durationMs == null) {
    return null
  }
  if (durationMs < 1000) {
    return "same time"
  }
  const seconds = Math.round(durationMs / 1000)
  if (seconds < 60) {
    return `${seconds}s later`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return `${remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`} later`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`} later`
}

export function getActivityPresentation(activity: RuntimeActivityEvent): {
  dot: string
  text: string
  eyebrow: string
} {
  if (activity.type === "keep_alive_changed") {
    return activity.keepAlive
      ? { dot: "bg-kumo-brand", text: "text-kumo-brand", eyebrow: "Keep alive on" }
      : { dot: "bg-kumo-fill", text: "text-kumo-subtle", eyebrow: "Keep alive off" }
  }

  if (activity.type === "keep_alive_change_failed" || activity.type === "error") {
    return { dot: "bg-kumo-danger-tint", text: "text-kumo-danger", eyebrow: "Needs attention" }
  }

  const status = activity.statusTo ?? ""
  const table: Record<string, { dot: string; text: string; eyebrow: string }> = {
    pending: { dot: "bg-kumo-fill", text: "text-kumo-subtle", eyebrow: "Pending" },
    spawning: {
      dot: "bg-kumo-warning-tint",
      text: "text-kumo-warning",
      eyebrow: "Provisioning",
    },
    connecting: {
      dot: "bg-kumo-warning-tint",
      text: "text-kumo-warning",
      eyebrow: "Connecting",
    },
    warming: {
      dot: "bg-kumo-warning-tint",
      text: "text-kumo-warning",
      eyebrow: "Warming",
    },
    syncing: { dot: "bg-kumo-brand", text: "text-kumo-brand", eyebrow: "Syncing" },
    ready: { dot: "bg-kumo-success", text: "text-kumo-success", eyebrow: "Ready" },
    running: { dot: "bg-kumo-brand", text: "text-kumo-brand", eyebrow: "Running" },
    stopped: { dot: "bg-kumo-fill", text: "text-kumo-subtle", eyebrow: "Stopped" },
    stale: { dot: "bg-kumo-fill", text: "text-kumo-subtle", eyebrow: "Stale" },
    failed: { dot: "bg-kumo-danger-tint", text: "text-kumo-danger", eyebrow: "Failed" },
  }
  return (
    table[status] ?? { dot: "bg-kumo-contrast", text: "text-kumo-default", eyebrow: activity.type }
  )
}

export function formatActivityDetail(activity: RuntimeActivityEvent): string {
  if (activity.type === "status_changed") {
    const from = activity.statusFrom ?? "unknown"
    const to = activity.statusTo ?? "unknown"
    return `${from} -> ${to}`
  }
  if (activity.keepAlive != null) {
    const state = activity.keepAlive ? "Enabled" : "Disabled"
    return activity.reason ? `${state} for ${activity.reason}` : state
  }
  if (activity.reason) {
    return activity.reason
  }
  if (activity.sandboxId) {
    return activity.sandboxId
  }
  return "Runtime lifecycle event"
}

export function RuntimeActivityTimeline({
  activity,
  loading,
  error,
}: {
  activity: RuntimeActivityEvent[]
  loading: boolean
  error: string | null
}) {
  if (loading && activity.length === 0) {
    return (
      <div className="px-4 py-8 text-sm text-kumo-subtle">
        <C0Loader size={16} />
      </div>
    )
  }

  if (error && activity.length === 0) {
    return <div className="px-4 py-5 text-sm text-kumo-danger">{error}</div>
  }

  if (activity.length === 0) {
    return (
      <div className="px-4 py-8 text-sm text-kumo-subtle">No runtime activity recorded yet.</div>
    )
  }

  return (
    <div className="px-4 py-3">
      <div className="space-y-0">
        {activity.map((item, index) => (
          <RuntimeActivityTimelineItem
            key={item.id}
            activity={item}
            isLast={index === activity.length - 1}
          />
        ))}
      </div>
      {error && <p className="pt-3 text-xs text-kumo-danger">{error}</p>}
    </div>
  )
}

export function RuntimeActivityTimelineItem({
  activity,
  isLast,
}: {
  activity: RuntimeActivityEvent
  isLast: boolean
}) {
  const presentation = getActivityPresentation(activity)
  const duration = formatActivityDuration(activity.durationSincePreviousMs)
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(activity.createdAt))

  return (
    <div className="relative grid grid-cols-[1rem_1fr] gap-3 pb-4">
      {!isLast && (
        <div className="absolute left-2 top-4 h-full w-px bg-kumo-hairline" aria-hidden />
      )}
      <div
        className={`relative z-10 mt-1 h-4 w-4 rounded-full border-2 border-kumo-line ${presentation.dot}`}
      />
      <div className="min-w-0">
        {duration && (
          <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-kumo-tint px-2 py-0.5 text-[11px] text-kumo-subtle">
            <Clock className="h-3 w-3" aria-hidden />
            {duration}
          </div>
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={`text-xs font-medium uppercase ${presentation.text}`}>
              {presentation.eyebrow}
            </p>
            <p className="text-sm font-medium text-kumo-default">{activity.summary}</p>
          </div>
          <span className="shrink-0 text-[11px] text-kumo-subtle">{time}</span>
        </div>
        <p className="mt-1 break-words text-xs text-kumo-subtle">
          {formatActivityDetail(activity)}
        </p>
      </div>
    </div>
  )
}

export function SessionStatusSidebar(input: {
  connected: boolean
  connecting: boolean
  runtimeStatus?: string
  sessionKind?: SessionKind
  agentRuntime?: AgentRuntime
  capabilities?: SessionRuntimeCapabilities
  createdAt?: number
  activity: RuntimeActivityEvent[]
  loadingActivity: boolean
  activityError: string | null
}) {
  const {
    connected,
    connecting,
    runtimeStatus,
    sessionKind,
    agentRuntime,
    capabilities,
    createdAt,
    activity,
    loadingActivity,
    activityError,
  } = input
  const status = runtimeStatus ?? "pending"
  const resolvedRuntime = resolveAgentRuntime({
    agentRuntime: capabilities?.agentRuntime ?? agentRuntime,
    sessionKind,
  })
  const runtimeLabel = formatAgentRuntimeLabel(resolvedRuntime)
  const runtime = getRuntimeStatusPresentation(status, runtimeLabel)

  const connectionColor = connecting
    ? "text-kumo-warning"
    : connected
      ? "text-kumo-success"
      : "text-kumo-subtle"
  const connectionHeadline = connecting
    ? "WS connecting"
    : connected
      ? "WS connected"
      : "WS disconnected"

  const created =
    createdAt != null
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(createdAt),
        )
      : "Unknown"

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l border-kumo-hairline bg-kumo-elevated lg:flex">
      <div className="border-b border-kumo-hairline p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-kumo-base ring-1 ring-kumo-hairline">
              <Server className="h-4 w-4 text-kumo-subtle" aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-kumo-default">{runtimeLabel}</h2>
              <p className={`text-xs font-medium ${runtime.color}`}>{status}</p>
            </div>
          </div>
          <span
            className={`mt-1 h-2.5 w-2.5 rounded-full bg-current ${runtime.color} ${
              connecting || status === "running" || status === "spawning" || status === "connecting"
                ? "animate-pulse"
                : ""
            }`}
            aria-hidden
          />
        </div>

        <p className="text-sm leading-snug text-kumo-subtle">{runtime.detail}</p>

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-kumo-base p-3 ring-1 ring-kumo-hairline">
            <div className="mb-1 flex items-center gap-1.5 text-kumo-subtle">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              Created
            </div>
            <p className="font-medium text-kumo-default">{created}</p>
          </div>
          <div className="rounded-lg bg-kumo-base p-3 ring-1 ring-kumo-hairline">
            <div className="mb-1 flex items-center gap-1.5 text-kumo-subtle">
              <Zap className="h-3.5 w-3.5" aria-hidden />
              Socket
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full bg-current ${connecting ? "animate-pulse" : ""} ${connectionColor}`}
                aria-hidden
              />
              <p className={`font-medium ${connectionColor}`}>{connectionHeadline}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-kumo-hairline px-4 py-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-kumo-subtle" aria-hidden />
            <h3 className="text-sm font-semibold text-kumo-default">Activity</h3>
          </div>
          <span className="text-xs text-kumo-subtle">{activity.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <RuntimeActivityTimeline
            activity={activity}
            loading={loadingActivity}
            error={activityError}
          />
        </div>
      </div>
    </aside>
  )
}

export function SessionHeaderRuntimeStatus({
  connected,
  connecting,
  runtimeStatus,
  sessionKind,
  agentRuntime,
  capabilities,
}: {
  connected: boolean
  connecting: boolean
  runtimeStatus?: string
  sessionKind?: SessionKind
  agentRuntime?: AgentRuntime
  capabilities?: SessionRuntimeCapabilities
}) {
  const status = runtimeStatus ?? "pending"
  const resolvedRuntime = resolveAgentRuntime({
    agentRuntime: capabilities?.agentRuntime ?? agentRuntime,
    sessionKind,
  })
  const runtimeLabel = formatAgentRuntimeLabel(resolvedRuntime)
  const meta = getRuntimeStatusPresentation(status, runtimeLabel)
  const badgeVariant = getRuntimeStatusBadgeVariant(status)
  const connectionStatus = connecting ? "connecting" : connected ? "connected" : "disconnected"

  return (
    <Tooltip content={`${meta.detail} WebSocket is ${connectionStatus}.`} delay={250} side="bottom">
      <span className="inline-flex">
        <Badge variant={badgeVariant} className="gap-1.5 px-2 py-1 text-xs">
          <AgentRuntimeIcon runtime={resolvedRuntime} className={`h-3.5 w-3.5 ${meta.color}`} />
          <span>{runtimeLabel}</span>
        </Badge>
      </span>
    </Tooltip>
  )
}

export function CombinedStatusDot({
  connected,
  connecting,
  sessionKind,
  agentRuntime,
  runtimeStatus,
  capabilities,
}: {
  connected: boolean
  connecting: boolean
  sessionKind?: SessionKind
  agentRuntime?: AgentRuntime
  runtimeStatus?: string
  capabilities?: SessionRuntimeCapabilities
}) {
  const status = runtimeStatus ?? "pending"
  const runtimeLabel = formatAgentRuntimeLabel(
    resolveAgentRuntime({
      agentRuntime: capabilities?.agentRuntime ?? agentRuntime,
      sessionKind,
    }),
  )
  const meta = getRuntimeStatusPresentation(status, runtimeLabel)

  return (
    <span
      className={`inline-flex items-center justify-center p-1.5 -ml-1.5 ${meta.color}`}
      title={`${runtimeLabel} ${status}${connecting ? " - connecting" : connected ? " - connected" : " - disconnected"}`}
    >
      <span
        className={`w-2.5 h-2.5 rounded-full bg-current ${
          connecting || status === "running" || status === "spawning" || status === "connecting"
            ? "animate-pulse opacity-90"
            : "opacity-90"
        }`}
        aria-hidden
      />
    </span>
  )
}

export function ParticipantsList({
  participants,
}: {
  participants: { userId: string; name: string; status: string }[]
}) {
  if (participants.length === 0) {
    return null
  }

  const uniqueParticipants = Array.from(new Map(participants.map((p) => [p.userId, p])).values())

  return (
    <div className="flex -space-x-2">
      {uniqueParticipants.slice(0, 3).map((p) => (
        <div
          key={p.userId}
          className="w-8 h-8 rounded-full bg-kumo-base flex items-center justify-center text-xs font-medium text-kumo-default border-2 border-kumo-base"
          title={p.name}
        >
          {p.name.charAt(0).toUpperCase()}
        </div>
      ))}
      {uniqueParticipants.length > 3 && (
        <div className="w-8 h-8 rounded-full bg-kumo-tint flex items-center justify-center text-xs font-medium text-kumo-default border-2 border-kumo-base">
          +{uniqueParticipants.length - 3}
        </div>
      )}
    </div>
  )
}
