"use client"

import { useId } from "react"

interface S0FormSpinLoaderProps {
  size?: number
  label?: string
  className?: string
}

const SOLZERO_MORPH_OVAL_PATH =
  "M188 0C291.76 0 376 84.24 376 188C376 251 376 282.5 376 282.5C376 282.5 376 314 376 377C376 480.76 291.76 565 188 565C84.24 565 0 480.76 0 377C0 314 0 282.5 0 282.5C0 282.5 0 251 0 188C0 84.24 84.24 0 188 0Z"

const SOLZERO_MORPH_STAR_PATH =
  "M188 94.5C188 146.067 209.2165 193.067 243.32475 227.17525C277.433 261.2835 324.433 282.5 376 282.5C324.433 282.5 277.433 303.7165 243.32475 337.82475C209.2165 371.933 188 418.933 188 470.5C188 418.933 166.7835 371.933 132.67525 337.82475C98.567 303.7165 51.567 282.5 0 282.5C51.567 282.5 98.567 261.2835 132.67525 227.17525C166.7835 193.067 188 146.067 188 94.5Z"

function sanitizeSvgId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "")
}

export function S0FormSpinLoader({
  size = 64,
  label = "Loading",
  className = "",
}: S0FormSpinLoaderProps) {
  const maskId = `s0-form-spin-mask-${sanitizeSvgId(useId())}`

  return (
    <span
      aria-label={label}
      className={`s0-form-spin-loader ${className}`.trim()}
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
          <mask
            id={maskId}
            x="0"
            y="0"
            width="376"
            height="565"
            maskContentUnits="userSpaceOnUse"
            maskUnits="userSpaceOnUse"
          >
            <rect x="0" y="0" width="376" height="565" fill="white" />
            <path className="s0-form-spin-loader__star" d={SOLZERO_MORPH_STAR_PATH} fill="black" />
          </mask>
        </defs>

        <g className="s0-form-spin-loader__spin">
          <path
            className="s0-form-spin-loader__outer"
            d={SOLZERO_MORPH_OVAL_PATH}
            fill="white"
            mask={`url(#${maskId})`}
          />
        </g>
      </svg>
    </span>
  )
}
