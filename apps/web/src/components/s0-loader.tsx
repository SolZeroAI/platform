"use client"

import { useEffect, useId, useRef, type ReactNode } from "react"

interface S0LoaderProps {
  size?: number
  className?: string
}

const SOLZERO_OUTER_PATH =
  "M376 188V377C376 480.76 291.76 565 188 565C84.24 565 0 480.76 0 377V188C0 84.24 84.24 0 188 0C291.76 0 376 84.24 376 188Z"

const SOLZERO_STAR_PATH =
  "M188 94.5C188 197.634 272.866 282.5 376 282.5C272.866 282.5 188 367.366 188 470.5C188 367.366 103.134 282.5 0 282.5C103.134 282.5 188 197.634 188 94.5Z"

const SOLZERO_MARK_PATH = `${SOLZERO_OUTER_PATH}${SOLZERO_STAR_PATH}`

const CYCLE_DURATION = 2.8
const ASSEMBLY_START = CYCLE_DURATION * 0.12
const ASSEMBLY_DURATION = CYCLE_DURATION * 0.28
const DEPARTURE_START = CYCLE_DURATION * 0.64
const DEPARTURE_DURATION = CYCLE_DURATION * 0.14
const PIECE_STAGGER = CYCLE_DURATION * 0.06

const LOADER_PIECES = [
  { name: "north-west", height: 282.5, offsetX: -34, offsetY: -26, width: 188, x: 0, y: 0 },
  { name: "north-east", height: 282.5, offsetX: 34, offsetY: -26, width: 188, x: 188, y: 0 },
  {
    name: "south-east",
    height: 282.5,
    offsetX: 34,
    offsetY: 26,
    width: 188,
    x: 188,
    y: 282.5,
  },
  { name: "south-west", height: 282.5, offsetX: -34, offsetY: 26, width: 188, x: 0, y: 282.5 },
] as const

function sanitizeSvgId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "")
}

export function S0Loader({ size = 64, className = "" }: S0LoaderProps) {
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
                  duration: ASSEMBLY_DURATION,
                  ease: "power2.out",
                  opacity: 1,
                  scale: 1,
                  x: 0,
                  y: 0,
                },
                ASSEMBLY_START + index * PIECE_STAGGER,
              )
              .to(
                piece,
                {
                  duration: DEPARTURE_DURATION,
                  ease: "power2.in",
                  opacity: 0,
                  scale: 0.94,
                  x: motion.offsetX,
                  y: motion.offsetY,
                },
                DEPARTURE_START + index * PIECE_STAGGER,
              )
          })

          timeline.set({}, {}, CYCLE_DURATION)
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
