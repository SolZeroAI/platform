"use client"

import { PanelLeft } from "lucide-react"
import { useSidebarContext } from "@/components/sidebar-layout"

interface PageHeaderProps {
  actions?: React.ReactNode
  border?: boolean
  children?: React.ReactNode
  className?: string
  contentClassName?: string
  heightClassName?: string
  toggleTopClassName?: string
}

export function PageHeader({
  actions,
  border = true,
  children,
  className = "",
  contentClassName = "",
  heightClassName = "h-[53px]",
  toggleTopClassName = "top-[calc((53px-2.5rem)/2)]",
}: PageHeaderProps) {
  const { isOpen, toggle } = useSidebarContext()
  const label = isOpen ? "Close sidebar" : "Open sidebar"
  const hasHeaderContent = Boolean(children || actions)
  const useGhostToggle = isOpen || border || hasHeaderContent
  const toggleVariantClassName = useGhostToggle
    ? "text-kumo-subtle transition-[background-color,color,transform] hover:bg-kumo-tint hover:text-kumo-default active:scale-[0.96]"
    : "bg-kumo-elevated text-kumo-subtle shadow-lg ring-1 ring-kumo-hairline transition-[background-color,color,box-shadow,transform] hover:bg-kumo-tint hover:text-kumo-default active:scale-[0.96]"

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        className={`fixed left-4 ${toggleTopClassName} z-[60] flex h-10 w-10 items-center justify-center rounded-xl ${toggleVariantClassName}`}
        title={label}
        aria-label={label}
      >
        <PanelLeft className="h-4 w-4" aria-hidden />
      </button>

      <header
        className={`flex flex-shrink-0 items-center bg-kumo-canvas ${
          border ? "border-b border-kumo-hairline" : ""
        } ${heightClassName} ${className}`}
      >
        {hasHeaderContent ? (
          <div
            className={`flex h-full min-w-0 flex-1 items-center justify-between gap-4 ${
              isOpen ? "px-4" : "pl-20 pr-4"
            } ${contentClassName}`}
          >
            <div className="flex min-w-0 items-center gap-3">{children}</div>
            {actions ? (
              <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>
            ) : null}
          </div>
        ) : null}
      </header>
    </>
  )
}
