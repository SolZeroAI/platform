import { createFileRoute, redirect } from "@tanstack/react-router"
import { AdminPage } from "@/components/admin-page/page"
import { canonicalAdminSearchForView, isCanonicalAdminSearch } from "@/lib/admin-console"

export const Route = createFileRoute("/_authenticated/admin/agents")({
  beforeLoad: ({ search }) => {
    const canonicalSearch = canonicalAdminSearchForView("sessions", search)
    if (isCanonicalAdminSearch(search, canonicalSearch)) {
      return
    }

    throw redirect({
      to: "/admin/agents",
      search: canonicalSearch,
    })
  },
  component: AdminAgentsRoutePage,
})

function AdminAgentsRoutePage() {
  const search = Route.useSearch()
  return <AdminPage search={search} view="sessions" />
}
