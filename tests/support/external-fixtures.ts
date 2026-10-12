export function requireFixture(name: string): string {
  const value = process.env[name]?.trim()
  if (!value)
    throw new Error(
      `External end-to-end fixture requires ${name}; configure an isolated integration in the e2e deployment.`,
    )
  return value
}
