import { mkdirSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  adminPasswordFromStateDocument,
  localAdminPasswordPath,
  readLocalAdminPassword,
} from "../../scripts/admin-password-state"

describe("print-admin-password local state", () => {
  it("prefers Alchemy.Random attr.text over other redacted fields", () => {
    expect(
      adminPasswordFromStateDocument({
        other: { __redacted__: "wrong-secret" },
        attr: { text: { __redacted__: "correct-secret" } },
      }),
    ).toBe("correct-secret")
  })

  it("reads packages/infra/.alchemy local disk state for --local", () => {
    const root = mkdtempSync(join(tmpdir(), "admin-password-"))
    const path = localAdminPasswordPath(root, "S0", "dev")
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(
      path,
      JSON.stringify({
        fqn: "admin-password",
        other: { __redacted__: "cloudflare-state-secret" },
        attr: { text: { __redacted__: "local-worker-secret" } },
      }),
    )
    expect(readLocalAdminPassword(root, "dev")).toBe("local-worker-secret")
  })
})
