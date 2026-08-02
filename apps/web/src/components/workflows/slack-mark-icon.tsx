import type { CSSProperties } from "react"

const SLACK_MARK_MASK_STYLE = {
  WebkitMask: "url('/images/slack-mark-monochrome-black.svg') center / 220% 220% no-repeat",
  mask: "url('/images/slack-mark-monochrome-black.svg') center / 220% 220% no-repeat",
} satisfies CSSProperties

export function SlackMarkIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
      style={SLACK_MARK_MASK_STYLE}
    />
  )
}
