import { Badge } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { Empty } from "@cloudflare/kumo/components/empty"
import { Input } from "@cloudflare/kumo/components/input"
import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { Select } from "@cloudflare/kumo/components/select"
import { Link, useNavigate, useRouter } from "@tanstack/react-router"
import { CalendarClock, MessageSquare, Trash2 } from "lucide-react"
import { useState, type FormEvent } from "react"
import {
  BotRoutineCadence,
  BotRoutineWatch,
  CreateBotRoutinePayload,
  OpenBotPayload,
  type BotItem,
  type BotRoutineItem,
} from "@solzero/api"
import { PageHeader } from "@/components/page-header"
import { SidebarLayout } from "@/components/sidebar-layout"
import { getErrorMessage } from "@/lib/admin-console-actions"
import { runApi } from "@/lib/api-client"
import { showErrorToast } from "@/lib/toast-manager"

function formatWhen(value: number | null): string {
  if (value === null) {
    return "none"
  }

  return new Date(value).toLocaleString()
}

function formatCadence(routine: BotRoutineItem): string {
  if (routine.cadence.kind === "cron") {
    return `cron ${routine.cadence.cron}`
  }

  return `every ${routine.cadence.intervalSeconds} seconds`
}

function formatWatch(routine: BotRoutineItem): string {
  if (routine.watch.kind !== "github_pull_request") {
    return "none"
  }

  return `${routine.watch.owner}/${routine.watch.repo}#${routine.watch.pullNumber}`
}

export function BotDetailPage({
  bot,
  routines,
}: {
  bot: BotItem
  routines: readonly BotRoutineItem[]
}) {
  const navigate = useNavigate()
  const router = useRouter()
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

  const handleOpen = async () => {
    setOpening(true)

    try {
      if (bot.sessionId) {
        await navigate({ to: "/session/$id", params: { id: bot.sessionId } })

        return
      }

      const created = await runApi(
        (client) =>
          client.sessions.create({
            payload: { agentRuntime: "isolate", sessionKind: "isolate", title: bot.name },
          }),
        { fallbackMessage: "Failed to create bot session" },
      )

      await runApi(
        (client) =>
          client.bots.open({
            params: { id: bot.id },
            payload: new OpenBotPayload({ sessionId: created.sessionId }),
          }),
        { fallbackMessage: "Failed to open bot" },
      )
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
          ? new BotRoutineWatch({
              kind: "github_pull_request",
              owner: watchOwner.trim(),
              repo: watchRepo.trim(),
              pullNumber: Number(watchPullNumber),
              completeWhen: "checks_concluded",
            })
          : new BotRoutineWatch({ kind: "none" })

      await runApi(
        (client) =>
          client.bots.createRoutine({
            params: { id: bot.id },
            payload: new CreateBotRoutinePayload({
              name,
              kind,
              cadence: new BotRoutineCadence({
                kind: "interval",
                intervalSeconds: Number(intervalSeconds),
              }),
              prompt,
              until:
                kind === "temporary" && until.trim() ? new Date(until.trim()).toISOString() : null,
              watch,
            }),
          }),
        { fallbackMessage: "Failed to create routine" },
      )
      setName("")
      setPrompt("")
      setUntil("")
      setWatchOwner("")
      setWatchRepo("")
      setWatchPullNumber("")
      await router.invalidate()
    } catch (error) {
      showErrorToast(getErrorMessage(error))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (routineId: string) => {
    try {
      await runApi((client) => client.bots.deleteRoutine({ params: { id: bot.id, routineId } }), {
        fallbackMessage: "Failed to delete routine",
      })
      await router.invalidate()
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
            <span className="font-medium text-kumo-default">{bot.name}</span>
          </div>
        </PageHeader>
        <div className="transparent-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
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
                onValueChange={(value) => setKind(value === "standing" ? "standing" : "temporary")}
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
            {routines.length === 0 ? (
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
          </div>
        </div>
      </div>
    </SidebarLayout>
  )
}
