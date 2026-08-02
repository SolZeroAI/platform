import { createFileRoute } from "@tanstack/react-router"
import { HomePage } from "@/components/home-page/page"

export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
})
