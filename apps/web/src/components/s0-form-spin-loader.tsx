"use client"

import { useEffect, useId, useRef } from "react"

interface S0FormSpinLoaderProps {
  size?: number
  label?: string
  className?: string
}

const SOLZERO_MORPH_OVAL_PATH =
  "M188 0C291.76 0 376 84.24 376 188C376 251 376 282.5 376 282.5C376 282.5 376 314 376 377C376 480.76 291.76 565 188 565C84.24 565 0 480.76 0 377C0 314 0 282.5 0 282.5C0 282.5 0 251 0 188C0 84.24 84.24 0 188 0Z"

const SOLZERO_MORPH_STAR_PATH =
  "M188 94.5C188 146.067 209.2165 193.067 243.32475 227.17525C277.433 261.2835 324.433 282.5 376 282.5C324.433 282.5 277.433 303.7165 243.32475 337.82475C209.2165 371.933 188 418.933 188 470.5C188 418.933 166.7835 371.933 132.67525 337.82475C98.567 303.7165 51.567 282.5 0 282.5C51.567 282.5 98.567 261.2835 132.67525 227.17525C166.7835 193.067 188 146.067 188 94.5Z"

const CYCLE_DURATION = 2.8
const MORPH_START = CYCLE_DURATION * 0.1
const MORPH_IN_DURATION = CYCLE_DURATION * 0.35
const MORPH_OUT_START = CYCLE_DURATION * 0.58
const MORPH_OUT_DURATION = CYCLE_DURATION * 0.32

function sanitizeSvgId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "")
}

export function S0FormSpinLoader({
  size = 64,
  label = "Loading",
  className = "",
}: S0FormSpinLoaderProps) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const maskId = `s0-form-spin-mask-${sanitizeSvgId(useId())}`

  useEffect(() => {
    let disposed = false
    let cleanup = () => {}

    void Promise.all([import("gsap"), import("gsap/MorphSVGPlugin")]).then(
      ([{ default: gsap }, { MorphSVGPlugin }]) => {
        if (disposed) {
          return
        }

        gsap.registerPlugin(MorphSVGPlugin)

        const mm = gsap.matchMedia()
        const context = gsap.context(() => {
          const outer = containerRef.current?.querySelector<SVGPathElement>(
            "[data-s0-form-spin-outer]",
          )
          const star = containerRef.current?.querySelector<SVGPathElement>(
            "[data-s0-form-spin-star]",
          )
          const spin = containerRef.current
          if (!outer || !star || !spin) {
            return
          }

          mm.add("(prefers-reduced-motion: reduce)", () => {
            gsap.set(outer, { attr: { d: SOLZERO_MORPH_OVAL_PATH } })
            gsap.set(star, { opacity: 1, scale: 1, svgOrigin: "188 282.5" })
            gsap.set(spin, { rotation: 0, transformOrigin: "50% 50%" })
          })

          mm.add("(prefers-reduced-motion: no-preference)", () => {
            gsap.set(outer, { attr: { d: SOLZERO_MORPH_STAR_PATH } })
            gsap.set(star, { opacity: 1, scale: 0, svgOrigin: "188 282.5" })
            gsap.set(spin, { rotation: 0, transformOrigin: "50% 50%" })

            const timeline = gsap.timeline({ repeat: -1 })

            timeline
              .to(
                outer,
                {
                  duration: MORPH_IN_DURATION,
                  ease: "power2.inOut",
                  morphSVG: {
                    map: "complexity",
                    shape: SOLZERO_MORPH_OVAL_PATH,
                    type: "rotational",
                  },
                },
                MORPH_START,
              )
              .to(
                star,
                { duration: MORPH_IN_DURATION, ease: "power2.inOut", scale: 1 },
                MORPH_START,
              )
              .to(
                spin,
                { duration: MORPH_IN_DURATION, ease: "power2.inOut", rotation: 360 },
                MORPH_START,
              )
              .to(
                outer,
                {
                  duration: MORPH_OUT_DURATION,
                  ease: "power2.inOut",
                  morphSVG: {
                    map: "complexity",
                    shape: SOLZERO_MORPH_STAR_PATH,
                    type: "rotational",
                  },
                },
                MORPH_OUT_START,
              )
              .to(
                star,
                { duration: MORPH_OUT_DURATION, ease: "power2.inOut", scale: 0 },
                MORPH_OUT_START,
              )
              .to(
                spin,
                { duration: MORPH_OUT_DURATION, ease: "power2.inOut", rotation: 720 },
                MORPH_OUT_START,
              )
              .set({}, {}, CYCLE_DURATION)
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
    <span
      ref={containerRef}
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
            <path data-s0-form-spin-star d={SOLZERO_MORPH_STAR_PATH} fill="black" opacity={0} />
          </mask>
        </defs>

        <path
          data-s0-form-spin-outer
          d={SOLZERO_MORPH_STAR_PATH}
          fill="white"
          mask={`url(#${maskId})`}
        />
      </svg>
    </span>
  )
}
