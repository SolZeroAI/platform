"use client"

import type { ReactNode } from "react"
import { S0LogoSvg } from "@/components/s0-logo-svg"

interface S0LoaderProps {
  size?: number
  className?: string
}

export function S0Loader({ size = 64, className = "" }: S0LoaderProps) {
  return (
    <S0LogoSvg
      alt="Loading"
      className={`animate-pulse ${className}`.trim()}
      height={size}
      width={size}
    />
  )
}

/**
 * Centers empty/loading content within the *visible* width of a scrollable
 * table, not the full (possibly overflowing) table width.
 *
 * The wrapper sticks to the left edge of the scroll viewport and is sized to
 * `100cqw` (the inline size of the nearest container), so `justify-center`
 * centers content in view even when the table overflows horizontally.
 * Requires the scroll container to set `container-type: inline-size`.
 */
export function TableCellState({
  children,
  className = "min-h-32",
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`sticky left-0 flex w-[100cqw] items-center justify-center ${className}`.trim()}
    >
      {children}
    </div>
  )
}
