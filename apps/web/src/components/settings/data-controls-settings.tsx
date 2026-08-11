"use client"

import { summarizeSessionTools } from "@solzero/shared"
import { Link } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"
import type { SessionItem } from "@/lib/session-list"
import { formatRelativeTime } from "@/lib/time"
import { S0Loader } from "@/components/s0-loader"
import { SettingsDocsLayout, SettingsDocsSectionHeading } from "./settings-docs-layout"

const PAGE_SIZE = 20
const DATA_CONTROLS_TOC_ITEMS = [{ id: "archived-chats", label: "Archived chats" }] as const

export function DataControlsSettings() {
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)

  const fetchArchivedSessions = useCallback(async (currentOffset: number, append: boolean) => {
    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
    }
    try {
      const res = await fetch(
        `/api/sessions?status=archived&limit=${PAGE_SIZE}&offset=${currentOffset}`,
      )
      if (res.ok) {
        const data = await res.json()
        const fetched = Array.isArray(data.sessions) ? data.sessions : []
        setSessions((prev) => (append ? [...prev, ...fetched] : fetched))
        setHasMore(fetched.length === PAGE_SIZE)
        setOffset(currentOffset + fetched.length)
      }
    } catch (error) {
      console.error("Failed to fetch archived sessions:", error)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    void fetchArchivedSessions(0, false)
  }, [fetchArchivedSessions])

  const handleLoadMore = () => {
    fetchArchivedSessions(offset, true)
  }

  const handleUnarchive = async (sessionId: string) => {
    // Optimistically remove from list
    setSessions((prev) => prev.filter((s) => s.id !== sessionId))
    try {
      const res = await fetch(`/api/sessions/${sessionId}/unarchive`, {
        method: "POST",
      })
      if (!res.ok) {
        // Re-fetch on failure to restore correct state
        void fetchArchivedSessions(0, false)
      }
    } catch {
      void fetchArchivedSessions(0, false)
    }
  }

  const sessionCount = sessions.length

  return (
    <SettingsDocsLayout
      title="Data Controls"
      titleId="settings-data-controls"
      description="Manage your archived chats and data."
      tocItems={DATA_CONTROLS_TOC_ITEMS}
    >
      <section className="space-y-4">
        <SettingsDocsSectionHeading id="archived-chats" level="h2" title="Archived chats">
          <p className="text-sm text-kumo-subtle">
            {loading
              ? "Loading..."
              : sessionCount === 0
                ? "No archived agents"
                : `${sessionCount}${hasMore ? "+" : ""} archived agent${sessionCount !== 1 ? "s" : ""}`}
          </p>
        </SettingsDocsSectionHeading>

        {loading ? (
          <div className="flex min-h-32 items-center justify-center py-8">
            <S0Loader size={20} className="text-kumo-subtle" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="py-8 text-center text-sm text-kumo-subtle">
            No archived agents. Agents you archive will appear here.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-kumo-line divide-y divide-kumo-line">
            {sessions.map((session) => (
              <ArchivedSessionRow
                key={session.id}
                session={session}
                onUnarchive={handleUnarchive}
              />
            ))}
          </div>
        )}

        {hasMore && !loading && (
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="mt-4 w-full rounded-lg border border-kumo-line py-2 text-sm text-kumo-subtle transition hover:bg-kumo-tint hover:text-kumo-default disabled:opacity-50"
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        )}
      </section>
    </SettingsDocsLayout>
  )
}

function ArchivedSessionRow({
  session,
  onUnarchive,
}: {
  session: SessionItem
  onUnarchive: (id: string) => void
}) {
  const repoInfo = summarizeSessionTools(
    session.tools && session.tools.length > 0
      ? session.tools
      : session.repoOwner && session.repoName
        ? [
            {
              kind: "github_repo" as const,
              repoOwner: session.repoOwner,
              repoName: session.repoName,
            },
          ]
        : [],
    {
      emptyLabel: "No tools",
      customMcpServers: session.customMcpServers,
    },
  )
  const displayTitle = session.title || repoInfo
  const timestamp = session.updatedAt || session.createdAt
  const relativeTime = formatRelativeTime(timestamp)

  return (
    <div className="group flex items-center justify-between px-4 py-3 hover:bg-kumo-tint transition">
      <Link
        to="/session/$id"
        params={{ id: session.id }}
        search={{ boot: undefined }}
        className="flex-1 min-w-0 mr-3"
      >
        <div className="truncate text-sm font-medium text-kumo-default">{displayTitle}</div>
        <div className="flex items-center gap-1 mt-0.5 text-xs text-kumo-subtle">
          <span>{relativeTime}</span>
          <span>&middot;</span>
          <span className="truncate">{repoInfo}</span>
        </div>
      </Link>
      <button
        onClick={() => onUnarchive(session.id)}
        className="flex-shrink-0 rounded-lg border border-kumo-line px-3 py-1.5 text-xs font-medium text-kumo-subtle opacity-0 transition hover:bg-kumo-base hover:text-kumo-default group-hover:opacity-100"
      >
        Unarchive
      </button>
    </div>
  )
}
