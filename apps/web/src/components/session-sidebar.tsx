"use client"

import { Button } from "@cloudflare/kumo/components/button"
import { Popover } from "@cloudflare/kumo/components/popover"
import { Link, useLocation } from "@tanstack/react-router"
import {
  ChevronDown,
  GitBranch,
  History,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Moon,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
} from "lucide-react"
import { useEffect, useState } from "react"
import { S0LogoSvg } from "@/components/s0-logo-svg"
import {
  ADMIN_SIDEBAR_ITEMS,
  getAdminViewFromLocation,
} from "@/components/session-sidebar-admin-nav"
import {
  getSettingsCategoryFromSearch,
  SETTINGS_NAV_ITEMS,
} from "@/components/settings/settings-nav"
import { signOut, useAuthSession } from "@/lib/auth-client"
import {
  HOME_NEW_AGENT_HASH,
  HOME_PREVIOUS_SESSIONS_HASH,
  isHomePreviousSessionsHash,
} from "@/lib/home-route-search"
import { getAppVersion } from "@/lib/runtime-config"
import { getS0Brand } from "@/lib/brand"
import { useTheme } from "@/lib/theme"

interface SessionSidebarProps {
  content?: React.ReactNode
  isOpen: boolean
}

export function SessionSidebar({ content, isOpen }: SessionSidebarProps) {
  const brand = getS0Brand()
  const { data: authSession } = useAuthSession()
  const isAdmin = authSession?.isAdmin === true
  const pathname = useLocation({ select: (location) => location.pathname })
  const locationHash = useLocation({ select: (location) => location.hash })
  const locationSearch = useLocation({
    select: (location) => location.search as Record<string, unknown>,
  })
  const { isDark, toggle: toggleTheme } = useTheme()

  const activeNav =
    pathname === "/" || pathname?.startsWith("/session/")
      ? "sessions"
      : pathname?.startsWith("/workflows")
        ? "workflows"
        : pathname?.startsWith("/admin")
          ? "admin"
          : pathname?.startsWith("/settings")
            ? "settings"
            : null
  const activeSettingsCategory = getSettingsCategoryFromSearch(locationSearch)
  const activeAdminView = getAdminViewFromLocation(pathname, locationSearch)
  const isPreviousSessionsActive = pathname === "/" && isHomePreviousSessionsHash(locationHash)
  const [agentsOpen, setAgentsOpen] = useState(activeNav === "sessions")
  const [adminOpen, setAdminOpen] = useState(activeNav === "admin")
  const [settingsOpen, setSettingsOpen] = useState(activeNav === "settings")

  useEffect(() => {
    if (activeNav === "sessions") {
      setAgentsOpen(true)
    }
  }, [activeNav])

  useEffect(() => {
    if (activeNav === "settings") {
      setSettingsOpen(true)
    }
  }, [activeNav])

  useEffect(() => {
    if (activeNav === "admin") {
      setAdminOpen(true)
    }
  }, [activeNav])

  const navLinkClass = (isActive: boolean) =>
    `flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${
      isActive
        ? "bg-kumo-tint text-kumo-default shadow-sm ring-1 ring-kumo-hairline"
        : "text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
    }`
  const settingsSubLinkClass = (isActive: boolean) =>
    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
      isActive
        ? "bg-kumo-tint text-kumo-default shadow-sm ring-1 ring-kumo-hairline"
        : "text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
    }`

  return (
    <aside className="flex h-screen w-72 flex-col overflow-hidden border-r border-kumo-hairline bg-kumo-canvas">
      <div className="flex h-[53px] shrink-0 items-center justify-end border-b border-kumo-hairline px-4">
        <Link to="/" className="flex h-10 w-10 items-center justify-center" aria-label={brand.name}>
          <S0LogoSvg className="shrink-0 text-kumo-default" height={34} width={34} />
        </Link>
      </div>

      {isOpen ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <nav className="transparent-scrollbar min-h-0 shrink overflow-y-auto space-y-1 px-4 py-4">
            <div className="space-y-1">
              <div
                className={`flex items-center rounded-xl transition ${
                  activeNav === "sessions" && !isPreviousSessionsActive
                    ? "bg-kumo-tint shadow-sm ring-1 ring-kumo-hairline"
                    : ""
                }`}
              >
                <Link
                  to="/"
                  hash={HOME_NEW_AGENT_HASH}
                  resetScroll={false}
                  hashScrollIntoView={false}
                  aria-current={
                    activeNav === "sessions" && !isPreviousSessionsActive ? "page" : undefined
                  }
                  className={`flex flex-1 items-center gap-2 px-3 py-2 text-sm transition ${
                    activeNav === "sessions" && !isPreviousSessionsActive
                      ? "text-kumo-default"
                      : "text-kumo-subtle hover:text-kumo-default"
                  }`}
                >
                  <MessageSquare className="h-4 w-4 flex-shrink-0" aria-hidden />
                  Agents
                </Link>
                <button
                  type="button"
                  aria-expanded={agentsOpen}
                  aria-controls="agents-sidebar-menu"
                  aria-label={agentsOpen ? "Collapse agents menu" : "Expand agents menu"}
                  onClick={() => setAgentsOpen((open) => !open)}
                  className="rounded-lg px-2 py-2 text-kumo-subtle transition hover:text-kumo-default"
                >
                  <ChevronDown
                    className={`h-4 w-4 flex-shrink-0 transition-transform ${
                      agentsOpen ? "rotate-180" : ""
                    }`}
                    aria-hidden
                  />
                </button>
              </div>
              {agentsOpen ? (
                <div
                  id="agents-sidebar-menu"
                  className="ml-4 space-y-1 border-l border-kumo-hairline pl-2"
                >
                  <Link
                    to="/"
                    hash={HOME_PREVIOUS_SESSIONS_HASH}
                    resetScroll={false}
                    hashScrollIntoView={false}
                    aria-current={isPreviousSessionsActive ? "page" : undefined}
                    className={settingsSubLinkClass(isPreviousSessionsActive)}
                  >
                    <History className="h-4 w-4 flex-shrink-0" aria-hidden />
                    Previous sessions
                  </Link>
                </div>
              ) : null}
            </div>
            <Link
              to="/workflows"
              aria-current={activeNav === "workflows" ? "page" : undefined}
              className={navLinkClass(activeNav === "workflows")}
            >
              <GitBranch className="h-4 w-4 flex-shrink-0" aria-hidden />
              Workflows
            </Link>
            <span
              aria-disabled="true"
              className="flex cursor-not-allowed items-center gap-2 rounded-xl px-3 py-2 text-sm text-kumo-subtle opacity-60"
            >
              <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
              Mini Apps (coming soon)
            </span>
            {isAdmin ? (
              <div className="space-y-1">
                <button
                  type="button"
                  aria-expanded={adminOpen}
                  aria-controls="admin-sidebar-menu"
                  onClick={() => setAdminOpen((open) => !open)}
                  className={`${navLinkClass(activeNav === "admin")} w-full justify-between`}
                >
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 flex-shrink-0" aria-hidden />
                    Admin
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 flex-shrink-0 transition-transform ${
                      adminOpen ? "rotate-180" : ""
                    }`}
                    aria-hidden
                  />
                </button>
                {adminOpen ? (
                  <div
                    id="admin-sidebar-menu"
                    className="ml-4 space-y-1 border-l border-kumo-hairline pl-2"
                  >
                    {ADMIN_SIDEBAR_ITEMS.map((item) => {
                      const Icon = getAdminSidebarIcon(item.id)
                      const isActive = activeNav === "admin" && activeAdminView === item.id
                      return (
                        <Link
                          key={item.id}
                          to={item.to}
                          aria-current={isActive ? "page" : undefined}
                          className={settingsSubLinkClass(isActive)}
                        >
                          <Icon className="h-4 w-4 flex-shrink-0" aria-hidden />
                          {item.label}
                        </Link>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="space-y-1">
              <button
                type="button"
                aria-expanded={settingsOpen}
                aria-controls="settings-sidebar-menu"
                onClick={() => setSettingsOpen((open) => !open)}
                className={`${navLinkClass(activeNav === "settings")} w-full justify-between`}
              >
                <span className="flex items-center gap-2">
                  <SettingsIcon className="h-4 w-4 flex-shrink-0" aria-hidden />
                  Settings
                </span>
                <ChevronDown
                  className={`h-4 w-4 flex-shrink-0 transition-transform ${
                    settingsOpen ? "rotate-180" : ""
                  }`}
                  aria-hidden
                />
              </button>
              {settingsOpen ? (
                <div
                  id="settings-sidebar-menu"
                  className="ml-4 space-y-1 border-l border-kumo-hairline pl-2"
                >
                  {SETTINGS_NAV_ITEMS.map((item) => {
                    const Icon = item.icon
                    const isActive = activeNav === "settings" && activeSettingsCategory === item.id
                    return (
                      <Link
                        key={item.id}
                        to="/settings"
                        search={{ category: item.id }}
                        aria-current={isActive ? "page" : undefined}
                        className={settingsSubLinkClass(isActive)}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" aria-hidden />
                        {item.label}
                      </Link>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </nav>

          <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
        </div>
      ) : null}

      {isOpen ? (
        <div className="flex items-center justify-between border-t border-kumo-hairline px-4 py-3">
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-xl p-2 text-kumo-subtle transition hover:bg-kumo-tint hover:text-kumo-default"
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? (
              <Sun className="h-4 w-4" aria-hidden />
            ) : (
              <Moon className="h-4 w-4" aria-hidden />
            )}
          </button>
          <AccountPopover
            email={authSession?.user.email ?? "Unknown account"}
            image={authSession?.user.image}
            name={authSession?.user.name}
          />
        </div>
      ) : null}
    </aside>
  )
}

function getAdminSidebarIcon(view: (typeof ADMIN_SIDEBAR_ITEMS)[number]["id"]) {
  switch (view) {
    case "sessions":
      return MessageSquare
    case "workflows":
      return GitBranch
    case "ai-search":
      return Search
    case "integrations":
      return LayoutGrid
  }
}

function AccountPopover({
  email,
  image,
  name,
}: {
  email: string
  image?: string | null
  name?: string | null
}) {
  const displayName = name || email
  const initial = (name || email).charAt(0).toUpperCase() || "?"
  const appVersion = getAppVersion()

  return (
    <Popover>
      <Popover.Trigger
        render={
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-kumo-base text-xs font-medium text-kumo-default ring-2 ring-transparent transition-[box-shadow,transform] hover:ring-kumo-line active:scale-[0.96]"
            title={`Signed in as ${displayName}`}
            aria-label="Account menu"
          />
        }
      >
        {image ? (
          <img src={image} alt={displayName} className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </Popover.Trigger>
      <Popover.Content side="top" align="end" sideOffset={10} className="w-64">
        <div className="mb-2 flex justify-center">
          <span className="inline-flex max-w-full items-center justify-center truncate rounded-full bg-kumo-brand/10 px-2.5 py-1 font-mono text-[11px] font-medium leading-none text-kumo-brand ring-1 ring-kumo-brand/25 tabular-nums">
            {appVersion}
          </span>
        </div>
        <Popover.Title>{displayName}</Popover.Title>
        <Popover.Description className="truncate">{email}</Popover.Description>
        <div className="mt-3 border-t border-kumo-hairline pt-3">
          <Button
            type="button"
            onClick={() => {
              void signOut({
                fetchOptions: {
                  onSuccess: () => {
                    window.location.href = "/"
                  },
                },
              })
            }}
            size="sm"
            variant="secondary"
            className="w-full justify-start"
            icon={<LogOut className="h-4 w-4" aria-hidden />}
          >
            Sign out
          </Button>
        </div>
      </Popover.Content>
    </Popover>
  )
}
