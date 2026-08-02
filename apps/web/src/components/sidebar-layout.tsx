"use client"

import { createContext, useContext, useEffect } from "react"
import { useSidebar } from "@/hooks/use-sidebar"
import { SessionSidebar } from "./session-sidebar"

interface SidebarContextValue {
  isOpen: boolean
  toggle: () => void
  open: () => void
  close: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function useSidebarContext() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebarContext must be used within a SidebarLayout")
  }
  return context
}

interface SidebarLayoutProps {
  children: React.ReactNode
  sidebarContent?: React.ReactNode
  closeSidebarOnMount?: boolean
}

export function SidebarLayout({
  children,
  sidebarContent,
  closeSidebarOnMount = false,
}: SidebarLayoutProps) {
  const sidebar = useSidebar()
  const { close, isHydrated } = sidebar

  useEffect(() => {
    if (closeSidebarOnMount && isHydrated) {
      close()
    }
  }, [close, closeSidebarOnMount, isHydrated])

  return (
    <SidebarContext.Provider value={sidebar}>
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar with transition */}
        <div
          className={`max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:shadow-2xl transition-[width] duration-200 ease-in-out ${
            sidebar.isOpen ? "w-72" : "w-0"
          } flex-shrink-0 overflow-hidden`}
        >
          <SessionSidebar content={sidebarContent} isOpen={sidebar.isOpen} />
        </div>
        {sidebar.isOpen ? (
          <button
            type="button"
            aria-label="Close sidebar"
            onClick={sidebar.close}
            className="fixed bottom-0 right-0 top-0 left-72 z-40 hidden bg-[rgb(24_24_24/72%)] max-md:block"
          />
        ) : null}
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </SidebarContext.Provider>
  )
}
