"use client"

import type { PaperShaderElement } from "@paper-design/shaders-react"
import { GemSmoke } from "@paper-design/shaders-react"
import { useCallback, useEffect, useState } from "react"
import { S0LogoSvg } from "@/components/s0-logo-svg"
import { useTheme } from "@/lib/theme"

interface S0AnimatedIconProps {
  size?: number
  className?: string
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const updatePreference = () => setPrefersReducedMotion(media.matches)

    updatePreference()
    media.addEventListener("change", updatePreference)

    return () => media.removeEventListener("change", updatePreference)
  }, [])

  return prefersReducedMotion
}

/**
 * The shader mounts its canvas asynchronously after the texture has loaded.
 * Keep the real logo visible until that first shader frame has painted.
 */
function useShaderReady() {
  const [shaderReady, setShaderReady] = useState(false)

  const shaderRef = useCallback((node: PaperShaderElement | null) => {
    if (!node) return undefined

    let rafId: number | null = null
    const markReady = () => {
      rafId = requestAnimationFrame(() => {
        rafId = requestAnimationFrame(() => setShaderReady(true))
      })
    }

    if (node.querySelector("canvas")) {
      markReady()
      return undefined
    }

    const observer = new MutationObserver(() => {
      if (node.querySelector("canvas")) {
        observer.disconnect()
        markReady()
      }
    })
    observer.observe(node, { childList: true })

    return () => {
      observer.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [])

  return { shaderReady, shaderRef }
}

export function S0AnimatedIcon({ size = 20, className = "" }: S0AnimatedIconProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const { isDark } = useTheme()
  const { shaderReady, shaderRef } = useShaderReady()

  const transitionClass = prefersReducedMotion
    ? "transition-opacity duration-300"
    : "transition-[opacity,filter] duration-1000 ease"

  return (
    <span
      aria-hidden="true"
      className={`relative isolate block shrink-0 ${className}`.trim()}
      style={{ width: size, height: size }}
    >
      <S0LogoSvg
        className={`pointer-events-none absolute inset-0 z-0 h-full w-full ${transitionClass} ${
          shaderReady ? "opacity-0 blur-[2px]" : "opacity-100 blur-0"
        }`}
        width={size}
        height={size}
      />
      <GemSmoke
        ref={shaderRef}
        aria-hidden="true"
        className={`absolute inset-0 z-10 ${transitionClass} ${
          shaderReady ? "opacity-100 blur-0" : "opacity-0 blur-[2px]"
        }`}
        width={size}
        height={size}
        image="/images/solzero-logo.svg"
        colors={["#0078d7", "#4da6e8", "#ffffff"]}
        colorBack="rgba(0, 0, 0, 0)"
        colorInner={isDark ? "#000000" : "#FFFFFF"}
        shape={undefined}
        innerDistortion={1}
        outerDistortion={0.8}
        outerGlow={0}
        innerGlow={1}
        offset={0}
        angle={0}
        size={0.8}
        speed={prefersReducedMotion ? 0 : 1}
        scale={1}
      />
    </span>
  )
}
