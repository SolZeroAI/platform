"use client"

import { useEffect, useId, useRef, type ReactNode } from "react"
import { hasCustomS0Logo } from "@solzero/shared"
import { getS0Brand } from "@/lib/brand"
import { S0LogoSvg } from "@/components/s0-logo-svg"
import {
  LOADER_ASSEMBLY_DURATION,
  LOADER_ASSEMBLY_START,
  LOADER_CYCLE_SECONDS,
  LOADER_DEPARTURE_DURATION,
  LOADER_DEPARTURE_START,
  LOADER_PIECE_STAGGER,
  LOADER_PIECES,
  SOLZERO_MARK_PATH,
} from "@/components/s0-loader-motion"

interface S0LoaderProps {
  size?: number
  className?: string
}

function sanitizeSvgId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "")
}

export function S0Loader({ size = 64, className = "" }: S0LoaderProps) {
  if (hasCustomS0Logo(getS0Brand())) {
    return (
      <span
        aria-label="Loading"
        className={`inline-flex motion-safe:animate-pulse ${className}`.trim()}
        role="img"
        style={{ height: size, width: size }}
      >
        <S0LogoSvg aria-hidden height={size} width={size} />
      </span>
    )
  }

  return <SolZeroLoader size={size} className={className} />
}

function SolZeroLoader({ size = 64, className = "" }: S0LoaderProps) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const instanceId = sanitizeSvgId(useId())
  const filterId = `s0-loader-bloom-${instanceId}`

  useEffect(() => {
    let disposed = false
    let cleanup = () => {}

    void import("gsap").then(({ default: gsap }) => {
      if (disposed) {
        return
      }

      const mm = gsap.matchMedia()

      const context = gsap.context(() => {
        const pieces = Array.from(
          containerRef.current?.querySelectorAll<SVGGElement>("[data-s0-loader-piece]") ?? [],
        )

        if (pieces.length !== LOADER_PIECES.length) {
          return
        }

        mm.add("(prefers-reduced-motion: reduce)", () => {
          gsap.set(pieces, { opacity: 1, scale: 1, x: 0, y: 0 })
        })

        mm.add("(prefers-reduced-motion: no-preference)", () => {
          pieces.forEach((piece, index) => {
            const motion = LOADER_PIECES[index]

            if (!motion) {
              return
            }

            gsap.set(piece, {
              opacity: 0,
              scale: 0.94,
              svgOrigin: "188 282.5",
              x: motion.offsetX,
              y: motion.offsetY,
            })
          })

          const timeline = gsap.timeline({ repeat: -1 })

          pieces.forEach((piece, index) => {
            const motion = LOADER_PIECES[index]

            if (!motion) {
              return
            }

            timeline
              .to(
                piece,
                {
                  duration: LOADER_ASSEMBLY_DURATION,
                  ease: "power2.out",
                  opacity: 1,
                  scale: 1,
                  x: 0,
                  y: 0,
                },
                LOADER_ASSEMBLY_START + index * LOADER_PIECE_STAGGER,
              )
              .to(
                piece,
                {
                  duration: LOADER_DEPARTURE_DURATION,
                  ease: "power2.in",
                  opacity: 0,
                  scale: 0.94,
                  x: motion.offsetX,
                  y: motion.offsetY,
                },
                LOADER_DEPARTURE_START + index * LOADER_PIECE_STAGGER,
              )
          })

          timeline.set({}, {}, LOADER_CYCLE_SECONDS)
        })
      }, containerRef)

      cleanup = () => {
        mm.revert()
        context.revert()
      }
    })

    return () => {
      disposed = true
      cleanup()
    }
  }, [])

  return (
    <span
      ref={containerRef}
      aria-label="Loading"
      className={`s0-loader ${className}`.trim()}
      role="img"
      style={{ height: size, width: size }}
    >
      <svg
        aria-hidden="true"
        className="block h-full w-full overflow-visible"
        focusable="false"
        viewBox="-95 -50 566 665"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter
            id={filterId}
            x="-70%"
            y="-50%"
            width="240%"
            height="200%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation="11" result="nearGlow" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="26" result="farGlow" />
            <feComponentTransfer in="farGlow" result="softGlow">
              <feFuncA type="linear" slope="0.52" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode in="softGlow" />
              <feMergeNode in="nearGlow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {LOADER_PIECES.map((piece) => (
            <clipPath
              key={piece.name}
              id={`s0-loader-piece-${piece.name}-${instanceId}`}
              clipPathUnits="userSpaceOnUse"
            >
              <rect x={piece.x} y={piece.y} width={piece.width} height={piece.height} />
            </clipPath>
          ))}
        </defs>

        <g filter={`url(#${filterId})`}>
          {LOADER_PIECES.map((piece) => (
            <g key={piece.name} data-s0-loader-piece={piece.name} className="s0-loader__piece">
              <g clipPath={`url(#s0-loader-piece-${piece.name}-${instanceId})`}>
                <path
                  d={SOLZERO_MARK_PATH}
                  clipRule="evenodd"
                  fill="currentColor"
                  fillRule="evenodd"
                />
              </g>
            </g>
          ))}
        </g>
      </svg>
    </span>
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
