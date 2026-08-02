import { describe, expect, it } from "vitest"
import { filterSecretMetadata } from "../../packages/api/src/server/background/db/repo-secrets"

describe("filterSecretMetadata", () => {
  const secrets = [
    { key: "ALPHA_KEY", tags: ["repo:acme/app", "prod"] },
    { key: "beta_key", tags: ["repo:acme/other"] },
    { key: "gamma_key", tags: [] },
  ]

  it("returns all secrets when no filters are provided", () => {
    expect(filterSecretMetadata(secrets)).toEqual(secrets)
  })

  it("filters secrets by key substring", () => {
    expect(filterSecretMetadata(secrets, { q: "alpha" })).toEqual([secrets[0]])
    expect(filterSecretMetadata(secrets, { q: "key" })).toEqual(secrets)
  })

  it("filters secrets by any selected tag", () => {
    expect(filterSecretMetadata(secrets, { tags: ["prod"] })).toEqual([secrets[0]])
    expect(filterSecretMetadata(secrets, { tags: ["repo:acme/app", "repo:acme/other"] })).toEqual([
      secrets[0],
      secrets[1],
    ])
  })

  it("applies key and tag filters together", () => {
    expect(
      filterSecretMetadata(secrets, {
        q: "beta",
        tags: ["repo:acme/other"],
      }),
    ).toEqual([secrets[1]])
  })
})
