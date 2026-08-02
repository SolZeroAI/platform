"use client"

interface C0LogoSvgProps {
  color?: string
  className?: string
  height?: number | string
  width?: number | string
}

export function C0LogoSvg({
  color = "currentColor",
  className = "",
  height = 20,
  width = 20,
}: C0LogoSvgProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height={height}
      viewBox="0 0 150 150"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M57.81 48.97
          A28.3 28.3 0 1 0 75 75
          A28.3 28.3 0 0 1 131.6 75
          A28.3 28.3 0 0 1 75 75"
        fill="none"
        stroke={color}
        strokeWidth="18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
