import { Button } from "@cloudflare/kumo/components/button"
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router"
import { S0Loader } from "@/components/s0-loader"
import { SidebarLayout } from "@/components/sidebar-layout"
import { runApi, type ApiRequest } from "@/lib/api-client"
import type { AuthenticatedShellRouteData } from "@/lib/authenticated-shell.functions"

interface SignedInLoaderContext {
  readonly abortController: AbortController
  readonly parentMatchPromise: Promise<{ readonly loaderData?: unknown }>
}

/**
 * Runs the first load of a signed-in page. Returns null when nobody is signed in, because the
 * authenticated shell shows the sign-in page and reloads every route after sign-in.
 */
export async function loadWhenSignedIn<A>(
  context: SignedInLoaderContext,
  load: (signal: AbortSignal) => Promise<A>,
): Promise<A | null> {
  const parentMatch = await context.parentMatchPromise
  // SAFETY: Signed-in page routes are children of the authenticated shell, whose loader returns AuthenticatedShellRouteData.
  const shell = parentMatch.loaderData as AuthenticatedShellRouteData | undefined

  if (!shell?.authSession?.user.id) {
    return null
  }

  return load(context.abortController.signal)
}

/** Loads the first API response of a signed-in page, as `loadWhenSignedIn` does. */
export function loadSignedInRouteData<A>(
  context: SignedInLoaderContext,
  request: ApiRequest<A>,
  fallbackMessage: string,
): Promise<A | null> {
  return loadWhenSignedIn(context, (signal) => runApi(request, { signal, fallbackMessage }))
}

/** The page frame while a signed-in route loads its first data. */
export function RoutePending() {
  return (
    <SidebarLayout>
      <div className="flex h-full items-center justify-center">
        <S0Loader size={28} />
      </div>
    </SidebarLayout>
  )
}

/** The page frame when a signed-in route cannot load its first data. */
export function RouteLoadError({ error }: ErrorComponentProps) {
  const router = useRouter()

  return (
    <SidebarLayout>
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-kumo-danger">
          {error instanceof Error ? error.message : "Unable to load this page"}
        </p>
        <Button type="button" variant="secondary" onClick={() => void router.invalidate()}>
          Retry
        </Button>
      </div>
    </SidebarLayout>
  )
}
