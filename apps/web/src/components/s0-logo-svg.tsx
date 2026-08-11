"use client"

import type { ImgHTMLAttributes } from "react"
import { getS0Brand } from "@/lib/brand"
import { useTheme } from "@/lib/theme"

interface S0LogoSvgProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "height" | "src" | "width"
> {
  height?: number | string
  width?: number | string
}

export function S0LogoSvg({
  className = "",
  height = 20,
  width = 20,
  alt = "",
  ...props
}: S0LogoSvgProps) {
  const { isDark } = useTheme()
  const brand = getS0Brand()

  return (
    <img
      {...props}
      alt={alt}
      className={className}
      draggable={false}
      height={height}
      src={isDark ? brand.logoDarkPath : brand.logoLightPath}
      width={width}
    />
  )
}
