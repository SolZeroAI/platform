import { createFileRoute } from "@tanstack/react-router"
import { parseOktaReconnectStatus } from "@/components/settings/okta-reconnect"
import { SessionPage } from "@/components/session-page/page"

export const Route = createFileRoute("/_authenticated/session/$id")({
  validateSearch: (search) => {
    const oktaReconnect = parseOktaReconnectStatus(search.oktaReconnect)
    return {
      ...(search.boot === "1" ? { boot: "1" as const } : {}),
      ...(search.tools === "step-limit" ? { tools: "step-limit" as const } : {}),
      ...(oktaReconnect ? { oktaReconnect } : {}),
      ...(typeof search.resumeMessageId === "string"
        ? { resumeMessageId: search.resumeMessageId }
        : {}),
      ...(typeof search.error === "string" ? { error: search.error } : {}),
      ...(typeof search.error_description === "string"
        ? { error_description: search.error_description }
        : {}),
    }
  },
  component: SessionRoutePage,
})

function SessionRoutePage() {
  const { id: sessionId } = Route.useParams()
  const search = Route.useSearch()
  return <SessionPage search={search} sessionId={sessionId} />
}
