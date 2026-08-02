"use client"

interface C0LogoIconProps {
  size?: number
  className?: string
}

export function C0LogoIcon({ size = 20, className = "" }: C0LogoIconProps) {
  return (
    <span
      aria-hidden="true"
      className={`block shrink-0 bg-current ${className}`.trim()}
      style={{
        width: size,
        height: size,
        mask: "url('/images/c0-logo.svg') center / contain no-repeat",
        WebkitMask: "url('/images/c0-logo.svg') center / contain no-repeat",
      }}
    />
  )
}
