import { useSyncExternalStore } from "react"

function subscribe() {
  return () => {}
}

/** Returns false during server render and hydration, then true once the client renders. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}
