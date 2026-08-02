import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"
import type { AppSession } from "@/lib/auth-session-state"
import type { AuthenticatedShellRouteData } from "@/lib/authenticated-shell.functions"
import { adminPathForView, compactAdminSearch, normalizeAdminSearch } from "@/lib/admin-console"

export const Route = createFileRoute("/_authenticated/admin")({
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ deps: { search }, location, parentMatchPromise }) => {
    const parentMatch = await parentMatchPromise
    const parentLoaderData = parentMatch.loaderData as AuthenticatedShellRouteData
    requireAdminSession(parentLoaderData.authSession)

    if (location.pathname !== "/admin" && location.pathname !== "/admin/") {
      return
    }

    const normalizedSearch = normalizeAdminSearch(search)
    throw redirect({
      to: adminPathForView(normalizedSearch.view),
      search: compactAdminSearch(normalizedSearch),
    })
  },
  component: Outlet,
})

export function requireAdminSession(session: AppSession | null) {
  if (!session?.isAdmin) {
    throw redirect({ to: "/access-denied", search: { error: "AccessDenied" } })
  }
}
