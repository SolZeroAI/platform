import { QueryClient, useQuery } from "@tanstack/react-query"
import { runApi, type ApiRequest } from "./api-client"

export const queryClient = new QueryClient()

/** Query keys by API resource, so a write can invalidate every view of that resource. */
export const apiQueryKeys = {
  secrets: ["secrets"] as const,
}

/** Reads one typed API resource through TanStack Query. */
export function useApiQuery<A>(options: {
  readonly key: readonly unknown[]
  readonly request: ApiRequest<A>
  readonly enabled?: boolean
  readonly fallbackMessage?: string
}) {
  return useQuery({
    queryKey: options.key,
    enabled: options.enabled ?? true,
    queryFn: ({ signal }) =>
      runApi(options.request, { signal, fallbackMessage: options.fallbackMessage }),
  })
}
