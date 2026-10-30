import { createFileRoute } from "@tanstack/react-router"
import { BotsPage } from "@/components/bots/page"
import { loadSignedInRouteData, RouteLoadError, RoutePending } from "@/lib/route-loaders"

export const Route = createFileRoute("/_authenticated/bots/")({
  ssr: false,
  loader: (context) =>
    loadSignedInRouteData(context, (client) => client.bots.list(), "Failed to load bots"),
  pendingComponent: RoutePending,
  errorComponent: RouteLoadError,
  component: BotsRoute,
})

function BotsRoute() {
  const data = Route.useLoaderData()

  return data ? <BotsPage bots={data.bots} /> : <RoutePending />
}
