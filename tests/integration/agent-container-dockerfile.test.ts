import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const dockerfile = readFileSync(
  new URL("../../packages/agent-container/Dockerfile", import.meta.url),
  "utf8",
)

describe("agent container image", () => {
  it("runs harness CLIs as a non-root user with a writable workspace", () => {
    expect(dockerfile).toContain("useradd --uid 10001")
    expect(dockerfile).toContain("chown -R c0:c0 /app /workspace /home/c0")
    expect(dockerfile).toContain("USER c0")
  })

  it("builds the Cloudflare CA bundle in a non-root-writable location", () => {
    expect(dockerfile).toContain("bundle=/tmp/c0-ca-certificates.crt")
    expect(dockerfile).not.toContain('cat "$cert" >> "$bundle"')
  })
})
