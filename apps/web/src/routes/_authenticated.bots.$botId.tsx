import { createFileRoute } from "@tanstack/react-router"
import * as Effect from "effect/Effect"
import { BotDetailPage } from "@/components/bots/detail"
import { loadSignedInRouteData, RouteLoadError, RoutePending } from "@/lib/route-loaders"

export const Route = createFileRoute("/_authenticated/bots/$botId")({
  ssr: false,
  loader: (context) =>
    loadSignedInRouteData(
      context,
      (client) =>
        Effect.all(
          {
            bot: client.bots.get({ params: { id: context.params.botId } }),
            routines: client.bots.listRoutines({ params: { id: context.params.botId } }),
          },
          { concurrency: "unbounded" },
        ),
      "Failed to load bot",
    ),
  pendingComponent: RoutePending,
  errorComponent: RouteLoadError,
  component: BotDetailRoute,
})

function BotDetailRoute() {
  const data = Route.useLoaderData()

  return data ? (
    <BotDetailPage bot={data.bot.bot} routines={data.routines.routines} />
  ) : (
    <RoutePending />
  )
}
