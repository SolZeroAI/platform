import { describe, expect, it } from "vitest"
import { buildGitHubAppGitCredentials } from "../../packages/api/src/server/background/isolate/git-auth"

describe("isolate git auth", () => {
  it("formats GitHub App installation tokens as HTTPS Git credentials", () => {
    expect(buildGitHubAppGitCredentials(" ghs_installation_token ")).toEqual({
      username: "x-access-token",
      password: "ghs_installation_token",
    })
  })

  it("rejects blank GitHub App installation tokens", () => {
    expect(() => buildGitHubAppGitCredentials(" ")).toThrow(
      "GitHub App installation token is unavailable",
    )
  })
})
