"use client"

import { useEffect, useRef, type ReactNode } from "react"

// Path data mirrors apps/web/public/images/c0-logo.svg: a single stroke that
// traces the "c" arc into the overlapping "0" so DrawSVG can draw it in one pass.
const C0_PATH_D =
  "M57.81 48.97 A28.3 28.3 0 1 0 75 75 A28.3 28.3 0 0 1 131.6 75 A28.3 28.3 0 0 1 75 75"

const DURATION = 1
// Head draws fast, holds a slow plateau, then releases (SlowMo ease).
const HEAD_EASE = "slow(0.9, 0.9, false)"
// Tail stores then snaps in to catch the head, looping back into the next draw.
const TAIL_EASE = "power4.in"
// Tail starts chasing 60% of the way through the head's draw.
const CHASE_OFFSET = "<60%"

interface C0LoaderProps {
  size?: number
  className?: string
}

export function C0Loader({ size = 64, className = "" }: C0LoaderProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    let cleanup = () => {}

    void Promise.all([import("gsap"), import("gsap/DrawSVGPlugin"), import("gsap/EasePack")]).then(
      ([{ default: gsap }, { DrawSVGPlugin }, { EasePack }]) => {
        if (disposed) {
          return
        }

        // EasePack provides the SlowMo ("slow(...)") ease used by the head tween.
        gsap.registerPlugin(DrawSVGPlugin, EasePack)

        const mm = gsap.matchMedia()
        const context = gsap.context(() => {
          const path = containerRef.current?.querySelector("path")
          if (!path) return

          mm.add("(prefers-reduced-motion: reduce)", () => {
            gsap.set(path, { opacity: 1, drawSVG: "0% 100%" })
          })

          mm.add("(prefers-reduced-motion: no-preference)", () => {
            // Decouple the two ends. Each tween animates a plain number on its own
            // clock/ease; an onUpdate composes them into the drawSVG segment string.
            // Tweening drawSVG directly with two tweens would let the later (tail)
            // tween overwrite the property and drag the head onto the tail's ease.
            const seg = { head: 0, tail: 0 }
            const drawSegment = () => {
              // Tail can't pass the head; clamp so the segment never inverts.
              const start = Math.min(seg.tail, seg.head)
              gsap.set(path, { drawSVG: `${start}% ${seg.head}%` })
            }

            const tl = gsap.timeline({ repeat: -1, onUpdate: drawSegment })

            tl.set(path, { opacity: 1 })
              .to(seg, { head: 100, duration: DURATION, ease: HEAD_EASE }, 0)
              .to(seg, { tail: 100, duration: DURATION, ease: TAIL_EASE }, CHASE_OFFSET)
          })
        }, containerRef)

        cleanup = () => {
          mm.revert()
          context.revert()
        }
      },
    )

    return () => {
      disposed = true
      cleanup()
    }
  }, [])

  return (
    <div ref={containerRef} className={`text-kumo-brand ${className}`.trim()}>
      <svg viewBox="0 0 150 150" width={size} height={size} role="img" aria-label="Loading">
        <path
          d={C0_PATH_D}
          fill="none"
          stroke="currentColor"
          strokeWidth={18}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0}
        />
      </svg>
    </div>
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
