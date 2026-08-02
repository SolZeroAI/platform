export interface AccessControlConfig {
  allowedDomains: string[]
  allowedUsers: string[]
}

export interface AccessCheckParams {
  githubUsername?: string
  email?: string
}

/**
 * Parse comma-separated environment variable into a lowercase, trimmed array
 */
export function parseAllowlist(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Check if a user is allowed to sign in based on access control configuration.
 */
export function checkAccessAllowed(
  config: AccessControlConfig,
  params: AccessCheckParams,
): boolean {
  const { allowedDomains, allowedUsers } = config
  const { githubUsername, email } = params

  if (allowedDomains.length === 0 && allowedUsers.length === 0) {
    return true
  }

  if (githubUsername && allowedUsers.includes(githubUsername.toLowerCase())) {
    return true
  }

  if (email) {
    const domain = email.toLowerCase().split("@")[1]
    if (domain && allowedDomains.includes(domain)) {
      return true
    }
  }

  return false
}
