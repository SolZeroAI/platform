import { createFileRoute } from "@tanstack/react-router"
import { BotDetailPage } from "@/components/bots/detail"

export const Route = createFileRoute("/_authenticated/bots/$botId")({
  component: BotDetailRoute,
})

function BotDetailRoute() {
  const { botId } = Route.useParams()
  return <BotDetailPage botId={botId} />
}
