"use client"

import { useGSAP } from "@gsap/react"
import { gsap } from "gsap"
import { useEffect, useRef } from "react"

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const
const ROLL_DURATION = 0.5
const ROLL_EASE = "power3.out"

interface RollingDigitProps {
  digit: number
  /** Animate entrance + roll on mount (true for digits added after first render). */
  animateOnMount: boolean
}

/**
 * A single odometer-style digit: a vertical strip of 0-9 that translates so the
 * active digit sits in a 1em tall window. Roll the strip on value change.
 */
function RollingDigit({ digit, animateOnMount }: RollingDigitProps) {
  const columnRef = useRef<HTMLSpanElement>(null)
  const stripRef = useRef<HTMLSpanElement>(null)
  const isFirstRun = useRef(true)

  useGSAP(
    () => {
      const strip = stripRef.current
      const column = columnRef.current
      if (!strip || !column) return

      // yPercent is relative to the strip's own height (10 digits), so each
      // digit is 10% of the strip.
      const targetY = -10 * digit

      if (isFirstRun.current) {
        isFirstRun.current = false
        if (!animateOnMount) {
          gsap.set(strip, { yPercent: targetY })
          return
        }
        // New column appearing after the number already mounted: slide it in
        // while rolling from 0 to the target digit.
        gsap.fromTo(
          column,
          { opacity: 0, xPercent: -40 },
          { opacity: 1, xPercent: 0, duration: ROLL_DURATION, ease: ROLL_EASE },
        )
        gsap.fromTo(
          strip,
          { yPercent: 0 },
          { yPercent: targetY, duration: ROLL_DURATION, ease: ROLL_EASE },
        )
        return
      }

      gsap.to(strip, {
        yPercent: targetY,
        duration: ROLL_DURATION,
        ease: ROLL_EASE,
        overwrite: "auto",
      })
    },
    { dependencies: [digit, animateOnMount] },
  )

  return (
    <span ref={columnRef} className="relative inline-block h-[1em] overflow-hidden leading-none">
      <span ref={stripRef} className="flex flex-col leading-none will-change-transform">
        {DIGITS.map((d) => (
          <span key={d} className="flex h-[1em] items-center justify-center leading-none">
            {d}
          </span>
        ))}
      </span>
    </span>
  )
}

interface AnimatedNumberProps {
  value: number
  className?: string
}

/**
 * Animates a (non-negative integer) number as it changes, NumberFlow-style,
 * using GSAP to roll each digit. Digits are keyed by place value so the units
 * column stays put as the number grows.
 */
export function AnimatedNumber({ value, className }: AnimatedNumberProps) {
  const hasMounted = useRef(false)

  useEffect(() => {
    hasMounted.current = true
  }, [])

  const safeValue = Math.max(0, Math.trunc(value))
  const digits = String(safeValue).split("").map(Number)
  const animateOnMount = hasMounted.current

  return (
    <span className={`inline-flex tabular-nums leading-none ${className ?? ""}`}>
      <span aria-hidden className="inline-flex leading-none">
        {digits.map((digit, index) => {
          // Key by place value (distance from the units digit) so adding a
          // higher-order digit doesn't reshuffle the existing columns.
          const placeValue = digits.length - 1 - index
          return <RollingDigit key={placeValue} digit={digit} animateOnMount={animateOnMount} />
        })}
      </span>
      <span className="sr-only">{safeValue}</span>
    </span>
  )
}
