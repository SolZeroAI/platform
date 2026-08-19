import { Button } from "@cloudflare/kumo/components/button"
import { Empty } from "@cloudflare/kumo/components/empty"
import { Input } from "@cloudflare/kumo/components/input"
import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { Link, useNavigate } from "@tanstack/react-router"
import { Bot as BotIcon, Plus } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import { PageHeader } from "@/components/page-header"
import { S0Loader } from "@/components/s0-loader"
import { SidebarLayout } from "@/components/sidebar-layout"
import { getErrorMessage, requestJson } from "@/lib/admin-console-actions"
import { showErrorToast } from "@/lib/toast-manager"
import type { BotRecord } from "./types"

export function BotsPage() {
  const navigate = useNavigate()
  const [bots, setBots] = useState<BotRecord[] | null>(null)
  const [name, setName] = useState("")
  const [instructions, setInstructions] = useState("")
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    requestJson<{ bots: BotRecord[] }>("/api/bots", { signal: controller.signal })
      .then((data) => setBots(data.bots))
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        showErrorToast(getErrorMessage(error))
        setBots([])
      })
    return () => controller.abort()
  }, [])

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreating(true)
    try {
      const data = await requestJson<{ bot: BotRecord }>("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, instructions }),
      })
      setName("")
      setInstructions("")
      await navigate({ to: "/bots/$botId", params: { botId: data.bot.id } })
    } catch (error) {
      showErrorToast(getErrorMessage(error))
    } finally {
      setCreating(false)
    }
  }

  return (
    <SidebarLayout>
      <div className="flex h-full flex-col">
        <PageHeader>
          <span className="text-sm font-medium text-kumo-default">Bots</span>
        </PageHeader>
        <div className="transparent-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <form className="space-y-3" onSubmit={handleCreate}>
              <h1 className="text-lg font-medium text-kumo-default">Always-on bots</h1>
              <p className="text-sm text-kumo-subtle">
                Each bot owns standing routines and temporary watches. A temporary routine is
                deleted when the watched work is done or the deadline passes.
              </p>
              <Input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Bot name"
                aria-label="Bot name"
              />
              <textarea
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder="Instructions for this bot"
                aria-label="Bot instructions"
                className="min-h-24 w-full rounded-xl border border-kumo-hairline bg-kumo-canvas px-3 py-2 text-sm text-kumo-default"
              />
              <Button type="submit" disabled={creating || name.trim().length === 0}>
                <Plus className="h-4 w-4" aria-hidden />
                {creating ? "Creating" : "Create bot"}
              </Button>
            </form>
            {bots === null ? (
              <div className="flex justify-center py-12">
                <S0Loader size={28} />
              </div>
            ) : bots.length === 0 ? (
              <Empty
                title="No bots yet"
                description="Create a bot, then let it add standing or temporary routines."
              />
            ) : (
              <div className="space-y-3">
                {bots.map((bot) => (
                  <LayerCard key={bot.id}>
                    <Link
                      to="/bots/$botId"
                      params={{ botId: bot.id }}
                      className="block space-y-1 px-4 py-3"
                    >
                      <div className="flex items-center gap-2 text-sm font-medium text-kumo-default">
                        <BotIcon className="h-4 w-4" aria-hidden />
                        {bot.name}
                      </div>
                      <p className="text-sm text-kumo-subtle">
                        {bot.instructions || "No instructions yet"}
                      </p>
                    </Link>
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
