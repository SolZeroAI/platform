/* oxlint-disable s0-lint/no-if-statement, s0-lint/no-ternary -- This module is the shared redaction boundary for model-authored compact text. Direct guards keep length and secret handling explicit. */

export const SUBAGENT_TASK_PREVIEW_LIMIT = 280
export const SUBAGENT_COMPACT_SUMMARY_LIMIT = 1_200
export const SUBAGENT_COMPACT_ERROR_LIMIT = 600
export const SUBAGENT_COMPACT_PROGRESS_LIMIT = 280
export const SUBAGENT_COMPACT_LABEL_LIMIT = 120

const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----/giu, "[REDACTED]"],
  [/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]"],
  [
    /\b([A-Za-z0-9_]*(?:api[_-]?key|authorization|password|secret|token)[A-Za-z0-9_]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
    "$1=[REDACTED]",
  ],
  [/\b(?:sk|gh[opsu]|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/giu, "[REDACTED]"],
  [/\bAKIA[A-Z0-9]{16}\b/gu, "[REDACTED]"],
  [/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, "$1[REDACTED]@"],
]

function replaceControlCharacter(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint < 32 || codePoint === 127 ? " " : character
}

function compactWhitespace(value: string): string {
  const withoutControls = Array.from(value, replaceControlCharacter).join("")
  return withoutControls.replace(/\s+/gu, " ").trim()
}

/** Redact credential-like values before truncating model-authored compact text. */
export function sanitizeSubagentCompactText(value: string, maxLength: number): string {
  const compact = compactWhitespace(value)
  const redacted = SECRET_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    compact,
  )
  if (redacted.length <= maxLength) {
    return redacted
  }
  return maxLength <= 1 ? "…".slice(0, maxLength) : `${redacted.slice(0, maxLength - 1)}…`
}

export function sanitizeSubagentTaskPreview(value: string): string {
  return sanitizeSubagentCompactText(value, SUBAGENT_TASK_PREVIEW_LIMIT)
}

export function sanitizeSubagentCompactSummary(value: string): string {
  return sanitizeSubagentCompactText(value, SUBAGENT_COMPACT_SUMMARY_LIMIT)
}

export function sanitizeSubagentCompactError(value: string): string {
  return sanitizeSubagentCompactText(value, SUBAGENT_COMPACT_ERROR_LIMIT)
}

export function sanitizeSubagentCompactProgress(value: string): string {
  return sanitizeSubagentCompactText(value, SUBAGENT_COMPACT_PROGRESS_LIMIT)
}

export function sanitizeSubagentCompactLabel(value: string): string {
  return sanitizeSubagentCompactText(value, SUBAGENT_COMPACT_LABEL_LIMIT)
}
