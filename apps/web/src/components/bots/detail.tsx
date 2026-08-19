import { Badge } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { Empty } from "@cloudflare/kumo/components/empty"
import { Input } from "@cloudflare/kumo/components/input"
import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { Select } from "@cloudflare/kumo/components/select"
import { Link, useNavigate } from "@tanstack/react-router"
import { CalendarClock, MessageSquare, Trash2 } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import { PageHeader } from "@/components/page-header"
import { S0Loader } from "@/components/s0-loader"
import { SidebarLayout } from "@/components/sidebar-layout"
import { getErrorMessage, requestJson } from "@/lib/admin-console-actions"
import { showErrorToast } from "@/lib/toast-manager"
import type { BotRecord, BotRoutineRecord } from "./types"

function formatWhen(value: number | null): string {
  if (value === null) {
    return "none"
  }
  return new Date(value).toLocaleString()
}

function formatCadence(routine: BotRoutineRecord): string {
  if (routine.cadence.kind === "cron") {
    return `cron ${routine.cadence.cron}`
  }
  return `every ${routine.cadence.intervalSeconds} seconds`
}

function formatWatch(routine: BotRoutineRecord): string {
  if (routine.watch.kind !== "github_pull_request") {
    return "none"
  }
  return `${routine.watch.owner}/${routine.watch.repo}#${routine.watch.pullNumber}`
}

export function BotDetailPage({ botId }: { botId: string }) {
  const navigate = useNavigate()
  const [bot, setBot] = useState<BotRecord | null>(null)
  const [routines, setRoutines] = useState<BotRoutineRecord[] | null>(null)
  const [opening, setOpening] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [kind, setKind] = useState<"standing" | "temporary">("temporary")
  const [intervalSeconds, setIntervalSeconds] = useState("300")
  const [prompt, setPrompt] = useState("")
  const [until, setUntil] = useState("")
  const [watchOwner, setWatchOwner] = useState("")
  const [watchRepo, setWatchRepo] = useState("")
  const [watchPullNumber, setWatchPullNumber] = useState("")

  const load = async (signal?: AbortSignal) => {
    const [botData, routineData] = await Promise.all([
      requestJson<{ bot: BotRecord }>(`/api/bots/${encodeURIComponent(botId)}`, { signal }),
      requestJson<{ routines: BotRoutineRecord[] }>(
        `/api/bots/${encodeURIComponent(botId)}/routines`,
        { signal },
      ),
    ])
    setBot(botData.bot)
    setRoutines(routineData.routines)
  }

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted) {
        return
      }
      showErrorToast(getErrorMessage(error))
    })
    return () => controller.abort()
  }, [botId])

  const handleOpen = async () => {
    if (!bot) {
      return
    }
    setOpening(true)
    try {
      if (bot.sessionId) {
        await navigate({ to: "/session/$id", params: { id: bot.sessionId } })
        return
      }
      const created = await requestJson<{ sessionId: string }>("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentRuntime: "isolate",
          sessionKind: "isolate",
          title: bot.name,
        }),
      })
      await requestJson(`/api/bots/${encodeURIComponent(bot.id)}/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: created.sessionId }),
      })
      await navigate({ to: "/session/$id", params: { id: created.sessionId } })
    } catch (error) {
      showErrorToast(getErrorMessage(error))
    } finally {
      setOpening(false)
    }
  }

  const handleCreateRoutine = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreating(true)
    try {
      const watch =
        watchOwner.trim() && watchRepo.trim() && watchPullNumber.trim()
          ? {
              kind: "github_pull_request" as const,
              owner: watchOwner.trim(),
              repo: watchRepo.trim(),
              pullNumber: Number(watchPullNumber),
              completeWhen: "checks_concluded" as const,
            }
          : { kind: "none" as const }
      await requestJson(`/api/bots/${encodeURIComponent(botId)}/routines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          kind,
          cadence: { kind: "interval", intervalSeconds: Number(intervalSeconds) },
          prompt,
          until: kind === "temporary" && until.trim() ? new Date(until.trim()).toISOString() : null,
          watch,
        }),
      })
      setName("")
      setPrompt("")
      setUntil("")
      setWatchOwner("")
      setWatchRepo("")
      setWatchPullNumber("")
      await load()
    } catch (error) {
      showErrorToast(getErrorMessage(error))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (routineId: string) => {
    try {
      await requestJson(
        `/api/bots/${encodeURIComponent(botId)}/routines/${encodeURIComponent(routineId)}`,
        { method: "DELETE" },
      )
      await load()
    } catch (error) {
      showErrorToast(getErrorMessage(error))
    }
  }

  return (
    <SidebarLayout>
      <div className="flex h-full flex-col">
        <PageHeader>
          <div className="flex items-center gap-3 text-sm">
            <Link to="/bots" className="text-kumo-subtle hover:text-kumo-default">
              Bots
            </Link>
            <span className="text-kumo-subtle">/</span>
            <span className="font-medium text-kumo-default">{bot?.name ?? "Bot"}</span>
          </div>
        </PageHeader>
        <div className="transparent-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            {bot === null ? (
              <div className="flex justify-center py-12">
                <S0Loader size={28} />
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    <h1 className="text-lg font-medium text-kumo-default">{bot.name}</h1>
                    <p className="text-sm text-kumo-subtle">
                      {bot.instructions || "No instructions yet"}
                    </p>
                  </div>
                  <Button type="button" onClick={handleOpen} disabled={opening}>
                    <MessageSquare className="h-4 w-4" aria-hidden />
                    {opening ? "Opening" : "Open chat"}
                  </Button>
                </div>
                <form className="space-y-3" onSubmit={handleCreateRoutine}>
                  <h2 className="text-sm font-medium text-kumo-default">Create a routine</h2>
                  <Input
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Routine name"
                    aria-label="Routine name"
                  />
                  <Select
                    value={kind}
                    onValueChange={(value) =>
                      setKind(value === "standing" ? "standing" : "temporary")
                    }
                    aria-label="Routine kind"
                  >
                    <Select.Option value="temporary">Temporary</Select.Option>
                    <Select.Option value="standing">Standing</Select.Option>
                  </Select>
                  <Input
                    required
                    type="number"
                    min={60}
                    value={intervalSeconds}
                    onChange={(event) => setIntervalSeconds(event.target.value)}
                    aria-label="Interval seconds"
                  />
                  <textarea
                    required
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="What the bot should do when this routine fires"
                    aria-label="Routine prompt"
                    className="min-h-24 w-full rounded-xl border border-kumo-hairline bg-kumo-canvas px-3 py-2 text-sm text-kumo-default"
                  />
                  {kind === "temporary" ? (
                    <>
                      <Input
                        type="datetime-local"
                        value={until}
                        onChange={(event) => setUntil(event.target.value)}
                        aria-label="Deadline"
                      />
                      <div className="grid gap-2 md:grid-cols-3">
                        <Input
                          value={watchOwner}
                          onChange={(event) => setWatchOwner(event.target.value)}
                          placeholder="Repo owner"
                          aria-label="Watch owner"
                        />
                        <Input
                          value={watchRepo}
                          onChange={(event) => setWatchRepo(event.target.value)}
                          placeholder="Repo name"
                          aria-label="Watch repo"
                        />
                        <Input
                          value={watchPullNumber}
                          onChange={(event) => setWatchPullNumber(event.target.value)}
                          placeholder="PR number"
                          aria-label="Watch pull request number"
                        />
                      </div>
                    </>
                  ) : null}
                  <Button type="submit" disabled={creating}>
                    <CalendarClock className="h-4 w-4" aria-hidden />
                    {creating ? "Creating" : "Create routine"}
                  </Button>
                </form>
                {routines === null ? (
                  <div className="flex justify-center py-8">
                    <S0Loader size={24} />
                  </div>
                ) : routines.length === 0 ? (
                  <Empty
                    title="No routines"
                    description="Create a standing check-in or a temporary pull request watch."
                  />
                ) : (
                  <div className="space-y-3">
                    {routines.map((routine) => (
                      <LayerCard key={routine.id}>
                        <div className="flex items-start justify-between gap-3 px-4 py-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-kumo-default">
                                {routine.name}
                              </span>
                              <Badge>{routine.kind}</Badge>
                            </div>
                            <p className="text-sm text-kumo-subtle">{routine.prompt}</p>
                            <p className="text-xs text-kumo-subtle">
                              {formatCadence(routine)} · watch {formatWatch(routine)} · deadline{" "}
                              {formatWhen(routine.until)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            aria-label={`Delete ${routine.name}`}
                            onClick={() => handleDelete(routine.id)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      </LayerCard>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </SidebarLayout>
  )
}
