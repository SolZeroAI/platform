"use client"

import type { PaperShaderElement } from "@paper-design/shaders-react"
import { useCallback, useEffect, useState } from "react"

export function usePrefersReducedMotion() {
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

/** Keep the fallback visible until the shader canvas has painted its first frame. */
export function usePaperShaderReady() {
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
