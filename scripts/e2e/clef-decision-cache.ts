import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const directory = resolve(".e2e/decision-cache")

/** Opaque HMAC key produced by the Clef client. It is safe as a file name. */
function cachePath(key: string): string | undefined {
  if (!/^e2e-clef-[a-f0-9]{64}$/.test(key)) return undefined
  return resolve(directory, `${key}.json`)
}

/** Read one validated Clef decision envelope result. A miss or a corrupt file returns undefined. */
export function readClefDecisionCache(key: string): unknown {
  const path = cachePath(key)
  if (path === undefined) return undefined
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

/** Store one Clef decision result. The request body is not written. */
export function writeClefDecisionCache(key: string, value: unknown): void {
  const path = cachePath(key)
  if (path === undefined) return
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 })
}
