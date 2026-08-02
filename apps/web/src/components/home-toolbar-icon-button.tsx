"use client"

import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"

export const TOOLS_TOOLBAR_CLASS_NAME = "home-toolbar-accent-purple"

export function HomeToolbarIconButton({
  ariaLabel,
  tooltip,
  tooltipHidden = false,
  className,
  children,
  onBlur,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  ...buttonProps
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  ariaLabel: string
  tooltip: string
  tooltipHidden?: boolean
}) {
  const tooltipId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [tooltipAnchor, setTooltipAnchor] = useState<{
    left: number
    top: number
    width: number
  } | null>(null)
  const tooltipDescriptionId = tooltipHidden ? undefined : tooltipId
  const tooltipVisible = !tooltipHidden && tooltipAnchor

  useEffect(() => {
    if (tooltipHidden) {
      setTooltipAnchor(null)
    }
  }, [tooltipHidden])

  const showTooltip = () => {
    if (tooltipHidden || !buttonRef.current) {
      return
    }

    const rect = buttonRef.current.getBoundingClientRect()
    setTooltipAnchor({
      left: rect.left,
      top: rect.top,
      width: rect.width,
    })
  }

  const hideTooltip = () => {
    setTooltipAnchor(null)
  }

  return (
    <span className="group relative inline-flex">
      <button
        {...buttonProps}
        ref={buttonRef}
        aria-label={ariaLabel}
        aria-describedby={tooltipDescriptionId}
        onBlur={(event) => {
          hideTooltip()
          onBlur?.(event)
        }}
        onFocus={(event) => {
          showTooltip()
          onFocus?.(event)
        }}
        onMouseEnter={(event) => {
          showTooltip()
          onMouseEnter?.(event)
        }}
        onMouseLeave={(event) => {
          hideTooltip()
          onMouseLeave?.(event)
        }}
        className={[
          "relative flex h-9 w-9 items-center justify-center rounded-lg text-sm text-kumo-subtle transition-[background-color,color,opacity,transform] hover:bg-kumo-tint hover:text-kumo-default active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </button>
      {tooltipVisible
        ? createPortal(
            <span
              id={tooltipId}
              role="tooltip"
              style={{
                left: tooltipAnchor.left + tooltipAnchor.width / 2,
                top: tooltipAnchor.top,
                transform: "translate(-50%, calc(-100% - 8px))",
              }}
              className="pointer-events-none fixed z-[100] whitespace-nowrap rounded-md bg-kumo-elevated px-2 py-1 text-xs text-kumo-default opacity-100 shadow-lg ring-1 ring-kumo-line backdrop-blur-sm"
            >
              {tooltip}
            </span>,
            document.body,
          )
        : null}
    </span>
  )
}
