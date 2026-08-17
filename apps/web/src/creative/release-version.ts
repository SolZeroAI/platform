import { inc } from "semver"

export const releaseBumps = ["patch", "minor", "major"] as const

export type ReleaseBump = (typeof releaseBumps)[number]

const releaseBumpPriority: Record<ReleaseBump, number> = {
  patch: 0,
  minor: 1,
  major: 2,
}

const SOLZERO_RELEASE_BUMP = /^[\s\S]*["']?release:solzero["']?\s*:\s*(major|minor|patch)/m

export function parseSolZeroReleaseBump(markdown: string): ReleaseBump | undefined {
  return SOLZERO_RELEASE_BUMP.exec(markdown)?.[1] as ReleaseBump | undefined
}

export function nextReleaseVersion(currentVersion: string, bumps: readonly ReleaseBump[]): string {
  const bump = bumps.reduce<ReleaseBump | undefined>((highest, candidate) => {
    if (!highest || releaseBumpPriority[candidate] > releaseBumpPriority[highest]) return candidate
    return highest
  }, undefined)
  if (!bump) return currentVersion

  const version = inc(currentVersion, bump)
  if (!version) throw new Error("VERSION must contain one valid SemVer version.")
  return version
}
