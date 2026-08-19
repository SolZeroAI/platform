import { createFileRoute } from "@tanstack/react-router"
import { BotsPage } from "@/components/bots/page"

export const Route = createFileRoute("/_authenticated/bots")({
  component: BotsPage,
})
