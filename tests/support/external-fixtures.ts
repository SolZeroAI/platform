/**
 * Alchemy local dev has no Workers AI emulator. The remote binding needs a
 * deploy token, and the application does not use the e2e gateway token.
 */
export function workersAiDeploySkip(): string | undefined {
  if (process.env.CLOUDFLARE_API_TOKEN?.trim()) return undefined
  return "Application Workers AI needs a deployed remote binding. Local alchemy dev has no Workers AI emulator, and the application does not use the e2e gateway token."
}

export function requireFixture(name: string): string {
  const value = process.env[name]?.trim()
  if (!value)
    throw new Error(
      `External end-to-end fixture requires ${name}; configure an isolated integration in the e2e deployment.`,
    )
  return value
}
