"use client"

import { useCallback, useEffect, useState } from "react"

const SIDEBAR_STORAGE_KEY = "c0-agent-sidebar-open"
// Matches Tailwind `max-md` (width < 48rem).
const MOBILE_SIDEBAR_MEDIA_QUERY = "(max-width: 767px)"

function readStoredSidebarOpen(): boolean | null {
  if (typeof window === "undefined") {
    return null
  }
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
    return stored === null ? null : stored === "true"
  } catch {
    return null
  }
}

export function useSidebar() {
  // Read the persisted value during the initial render so the sidebar paints at the
  // correct width immediately. The sidebar only mounts client-side (after auth resolves),
  // so this never runs during SSR/hydration and avoids the open->closed animation flash.
  const [isOpen, setIsOpen] = useState(() => readStoredSidebarOpen() ?? true)
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  // Persist state to localStorage
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isOpen))
    }
  }, [isOpen, isHydrated])

  // Desktop sidebar is inline; below md it overlays content. Auto-close when entering
  // the narrow viewport so main content keeps priority (including stale open state on load).
  useEffect(() => {
    if (!isHydrated) {
      return
    }

    const mediaQuery = window.matchMedia(MOBILE_SIDEBAR_MEDIA_QUERY)
    let wasNarrow = mediaQuery.matches

    if (wasNarrow) {
      setIsOpen((open) => (open ? false : open))
    }

    const handleViewportChange = () => {
      const isNarrow = mediaQuery.matches
      if (isNarrow && !wasNarrow) {
        setIsOpen(false)
      }
      wasNarrow = isNarrow
    }

    mediaQuery.addEventListener("change", handleViewportChange)
    return () => mediaQuery.removeEventListener("change", handleViewportChange)
  }, [isHydrated])

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  const open = useCallback(() => {
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
  }, [])

  return {
    isOpen,
    isHydrated,
    toggle,
    open,
    close,
  }
}
