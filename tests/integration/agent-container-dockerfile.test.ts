import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { AGENT_CONTAINER_IMAGES } from "../../packages/agent-container/src/images"

const dockerfile = readFileSync(
  new URL("../../packages/agent-container/Dockerfile", import.meta.url),
  "utf8",
)
const apiEntrypoint = readFileSync(new URL("../../apps/api/index.ts", import.meta.url), "utf8")

describe("agent container image", () => {
  it("runs harness CLIs as a non-root user with a writable workspace", () => {
    expect(dockerfile).toContain("useradd --uid 10001")
    expect(dockerfile).toContain("chown -R s0:s0 /app /workspace /home/s0")
    expect(dockerfile).toContain("USER s0")
  })

  it("builds the Cloudflare CA bundle in a non-root-writable location", () => {
    expect(dockerfile).toContain("bundle=/tmp/s0-ca-certificates.crt")
    expect(dockerfile).not.toContain('cat "$cert" >> "$bundle"')
  })

  it("deploys prebuilt GHCR images by digest", () => {
    const resources = readFileSync(
      new URL("../../apps/api/infra/resources.ts", import.meta.url),
      "utf8",
    )

    expect(resources).toContain("image: AGENT_CONTAINER_IMAGES[options.runtime]")
    expect(resources).not.toContain("dockerfile:")
    for (const image of Object.values(AGENT_CONTAINER_IMAGES)) {
      expect(image).toMatch(/^ghcr\.io\/solzeroai\/[a-z0-9-]+@sha256:[a-f0-9]{64}$/)
    }
  })

  it("uses Cloudflare Containers outbound interception for credential injection", () => {
    expect(apiEntrypoint).toContain("export {\n  DynamicUserWorkflow,")
    expect(apiEntrypoint).toContain("ContainerProxy,")
    expect(apiEntrypoint).toContain("interceptHttps = true")
    expect(apiEntrypoint).toContain("this.setOutboundByHosts")
    expect(apiEntrypoint).toContain("AgentContainer.outboundHandlers")
  })
})
