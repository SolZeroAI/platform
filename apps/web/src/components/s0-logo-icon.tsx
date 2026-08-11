"use client"

import { S0LogoSvg } from "@/components/s0-logo-svg"

interface S0LogoIconProps {
  size?: number
  className?: string
}

export function S0LogoIcon({ size = 20, className = "" }: S0LogoIconProps) {
  return <S0LogoSvg aria-hidden height={size} width={size} className={className} />
}
