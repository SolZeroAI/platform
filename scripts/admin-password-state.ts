import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

export const ADMIN_PASSWORD_STATE_STACKS = ["S0", "S0Api"] as const

function redactedString(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined
  if ("__redacted__" in value && typeof value.__redacted__ === "string") {
    return value.__redacted__
  }
  return undefined
}

export function adminPasswordFromStateDocument(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined
  if ("attr" in value) {
    const attr = value.attr
    if (typeof attr === "object" && attr !== null && "text" in attr) {
      const fromAttr = redactedString(attr.text)
      if (fromAttr) return fromAttr
    }
  }
  const direct = redactedString(value)
  if (direct) return direct
  for (const child of Object.values(value)) {
    const match = adminPasswordFromStateDocument(child)
    if (match) return match
  }
  return undefined
}

export function localAdminPasswordPath(
  root: string,
  stack: (typeof ADMIN_PASSWORD_STATE_STACKS)[number],
  stage: string,
) {
  return resolve(root, "packages/infra/.alchemy/state", stack, stage, "admin-password.json")
}

export function readLocalAdminPassword(root: string, stage: string): string | undefined {
  for (const stack of ADMIN_PASSWORD_STATE_STACKS) {
    const path = localAdminPasswordPath(root, stack, stage)
    if (!existsSync(path)) continue
    const password = adminPasswordFromStateDocument(JSON.parse(readFileSync(path, "utf8")))
    if (password) return password
  }
  return undefined
}
