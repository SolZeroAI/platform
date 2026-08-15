"use client"

import { GemSmoke } from "@paper-design/shaders-react"
import { S0LogoSvg } from "@/components/s0-logo-svg"
import { usePaperShaderReady, usePrefersReducedMotion } from "@/hooks/use-paper-shader"
import { useTheme } from "@/lib/theme"

interface S0AnimatedIconProps {
  size?: number
  className?: string
}

export function S0AnimatedIcon({ size = 20, className = "" }: S0AnimatedIconProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const { isDark } = useTheme()
  const { shaderReady, shaderRef } = usePaperShaderReady()

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
