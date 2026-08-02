/**
 * Time formatting utilities for displaying relative timestamps.
 */

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days}d`
  }
  if (hours > 0) {
    return `${hours}h`
  }
  if (minutes > 0) {
    return `${minutes}m`
  }
  return "just now"
}

export function formatFullTimestamp(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toLocaleString([], {
    dateStyle: "full",
    timeStyle: "long",
  })
}

export function formatShortTimestamp(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function isInactiveSession(updatedAt: number): boolean {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  return updatedAt < sevenDaysAgo
}
