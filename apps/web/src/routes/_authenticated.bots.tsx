import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router"
import { BotsPage } from "@/components/bots/page"

export const Route = createFileRoute("/_authenticated/bots")({
  component: BotsRoute,
})

function BotsRoute() {
  const detail = useMatch({ from: "/_authenticated/bots/$botId", shouldThrow: false })
  return detail ? <Outlet /> : <BotsPage />
}
