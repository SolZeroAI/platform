import { describe, expect, it } from "vitest"
import { rankPopularTags } from "../../packages/api/src/server/background/db/repo-secrets"

describe("rankPopularTags", () => {
  const secrets = [
    { key: "alpha", tags: ["prod", "repo:acme/app"] },
    { key: "beta", tags: ["prod", "staging"] },
    { key: "gamma", tags: ["prod"] },
    { key: "delta", tags: ["staging"] },
    { key: "epsilon", tags: [] },
  ]

  it("returns the most-used tags first", () => {
    expect(rankPopularTags(secrets, 5)).toEqual(["prod", "staging", "repo:acme/app"])
  })

  it("limits the number of returned tags", () => {
    expect(rankPopularTags(secrets, 2)).toEqual(["prod", "staging"])
  })

  it("breaks ties alphabetically", () => {
    const tiedSecrets = [
      { key: "one", tags: ["zebra"] },
      { key: "two", tags: ["alpha"] },
    ]
    expect(rankPopularTags(tiedSecrets, 5)).toEqual(["alpha", "zebra"])
  })
})
