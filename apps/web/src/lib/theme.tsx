"use client"

import { ScriptOnce } from "@tanstack/react-router"
import { createContext, type ReactNode, useContext, useEffect, useSyncExternalStore } from "react"
import { useHydrated } from "@/hooks/use-hydrated"

export type Theme = "light" | "dark" | "system"

export type ResolvedTheme = "light" | "dark"

const THEME_STORAGE_KEY = "theme"

/**
 * Runs before first paint (via ScriptOnce) so the correct Kumo data-mode is on
 * <html> before anything renders. Must stay in sync with the provider logic below.
 */
const themeInitScript = `(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var theme = stored === "light" || stored === "dark" ? stored : "system";
    var dark =
      theme === "dark" ||
      (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var mode = dark ? "dark" : "light";
    document.documentElement.dataset.mode = mode;
    document.documentElement.style.colorScheme = mode;
  } catch (e) {}
})();`

interface ThemeContextValue {
  /** The user's stored preference, including "system". */
  theme: Theme
  /** The effective theme after resolving "system" against the OS preference. */
  resolvedTheme: ResolvedTheme
  isDark: boolean
  setTheme: (theme: Theme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)

  return stored === "light" || stored === "dark" ? stored : "system"
}

function applyResolvedTheme(resolved: ResolvedTheme) {
  document.documentElement.dataset.mode = resolved
  document.documentElement.style.colorScheme = resolved
}

const themeListeners = new Set<() => void>()

function subscribeToStoredTheme(listener: () => void) {
  themeListeners.add(listener)
  window.addEventListener("storage", listener)

  return () => {
    themeListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

function writeStoredTheme(next: Theme) {
  if (next === "system") {
    localStorage.removeItem(THEME_STORAGE_KEY)
  } else {
    localStorage.setItem(THEME_STORAGE_KEY, next)
  }

  themeListeners.forEach((listener) => listener())
}

const darkSchemeQuery = "(prefers-color-scheme: dark)"

function subscribeToSystemPreference(listener: () => void) {
  const media = window.matchMedia(darkSchemeQuery)
  media.addEventListener("change", listener)

  return () => media.removeEventListener("change", listener)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // SSR renders with the defaults; the stored and OS values apply after hydration. The
  // pre-hydration script above keeps <html> correct in the meantime.
  const theme = useSyncExternalStore<Theme>(subscribeToStoredTheme, readStoredTheme, () => "system")

  const systemPrefersDark = useSyncExternalStore(
    subscribeToSystemPreference,
    () => window.matchMedia(darkSchemeQuery).matches,
    () => false,
  )

  const mounted = useHydrated()

  const resolvedTheme: ResolvedTheme =
    theme === "dark" || (theme === "system" && systemPrefersDark) ? "dark" : "light"

  // Skip until mounted: the init script already applied the correct mode, and
  // pre-mount state would briefly resolve to the default.
  useEffect(() => {
    if (!mounted) {
      return
    }

    applyResolvedTheme(resolvedTheme)
  }, [mounted, resolvedTheme])

  const setTheme = (next: Theme) => {
    writeStoredTheme(next)
  }

  const toggle = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }

  return (
    <ThemeContext
      value={{ theme, resolvedTheme, isDark: resolvedTheme === "dark", setTheme, toggle }}
    >
      <ScriptOnce>{themeInitScript}</ScriptOnce>
      {children}
    </ThemeContext>
  )
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }

  return context
}
