import { Banner } from "@cloudflare/kumo/components/banner"
import { Link, createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/access-denied")({
  validateSearch: (search) => ({
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: AccessDeniedPage,
})

function AccessDeniedPage() {
  const { error } = Route.useSearch()

  const message =
    error === "AccessDenied"
      ? "Your account is not authorized to use this application."
      : "An error occurred during sign in. Please try again."

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold text-kumo-default">Access Denied</h1>
      <Banner variant="error" description={message} className="max-w-md" />
      <Link to="/" className="text-kumo-brand hover:underline">
        Return to homepage
      </Link>
    </div>
  )
}
