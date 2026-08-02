const VALID_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
export const MAX_KEY_LENGTH = 256
export const MAX_VALUE_SIZE = 16384
export const MAX_TOTAL_VALUE_SIZE = 65536
export const MAX_SECRETS_PER_USER = 50

const RESERVED_KEYS = new Set([
  "PYTHONUNBUFFERED",
  "REPO_OWNER",
  "REPO_NAME",
  "SESSION_CONFIG",
  "RESTORED_FROM_SNAPSHOT",
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "PWD",
  "LANG",
])

export function validateKey(value: string): string | null {
  if (!value) return "Key is required"
  if (value.length > MAX_KEY_LENGTH) return "Key is too long"
  if (!VALID_KEY_PATTERN.test(value)) return "Key must match [A-Za-z_][A-Za-z0-9_]*"
  if (RESERVED_KEYS.has(value.toUpperCase())) return `Key '${value}' is reserved`
  return null
}

export function getUtf8Size(value: string): number {
  return new TextEncoder().encode(value).length
}
