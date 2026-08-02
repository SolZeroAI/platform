import { createFileRoute, redirect } from "@tanstack/react-router"
import { AdminPage } from "@/components/admin-page/page"
import { canonicalAdminSearchForView, isCanonicalAdminSearch } from "@/lib/admin-console"

export const Route = createFileRoute("/_authenticated/admin/workflows")({
  beforeLoad: ({ search }) => {
    const canonicalSearch = canonicalAdminSearchForView("workflows", search)
    if (isCanonicalAdminSearch(search, canonicalSearch)) {
      return
    }

    throw redirect({
      to: "/admin/workflows",
      search: canonicalSearch,
    })
  },
  component: AdminWorkflowsRoutePage,
})

function AdminWorkflowsRoutePage() {
  const search = Route.useSearch()
  return <AdminPage search={search} view="workflows" />
}
