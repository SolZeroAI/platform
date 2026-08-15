"use client"

import { useId, type ReactNode } from "react"

interface S0LoaderProps {
  size?: number
  className?: string
}

const SOLZERO_OUTER_PATH =
  "M376 188V377C376 480.76 291.76 565 188 565C84.24 565 0 480.76 0 377V188C0 84.24 84.24 0 188 0C291.76 0 376 84.24 376 188Z"

const SOLZERO_STAR_PATH =
  "M188 94.5C188 197.634 272.866 282.5 376 282.5C272.866 282.5 188 367.366 188 470.5C188 367.366 103.134 282.5 0 282.5C103.134 282.5 188 197.634 188 94.5Z"

const SOLZERO_MARK_PATH = `${SOLZERO_OUTER_PATH}${SOLZERO_STAR_PATH}`

const LOADER_PIECES = [
  { name: "north-west", height: 282.5, width: 188, x: 0, y: 0 },
  { name: "north-east", height: 282.5, width: 188, x: 188, y: 0 },
  { name: "south-east", height: 282.5, width: 188, x: 188, y: 282.5 },
  { name: "south-west", height: 282.5, width: 188, x: 0, y: 282.5 },
] as const

function sanitizeSvgId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "")
}

export function S0Loader({ size = 64, className = "" }: S0LoaderProps) {
  const instanceId = sanitizeSvgId(useId())
  const filterId = `s0-loader-bloom-${instanceId}`

  return (
    <span
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
            <g key={piece.name} className={`s0-loader__piece s0-loader__piece--${piece.name}`}>
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
