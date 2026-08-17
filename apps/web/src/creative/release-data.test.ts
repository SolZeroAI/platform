import * as Effect from "effect/Effect"
import { describe, expect, it } from "vitest"
import {
  createReleaseCardInput,
  decodeReleaseCardInputJson,
  parseTegamiReleaseEntry,
} from "./release-data"

describe("release card data", () => {
  it("decodes creative copy and builds a validated card input", async () => {
    const input = await Effect.runPromise(
      Effect.gen(function* () {
        const entry = yield* parseTegamiReleaseEntry(`---
packages:
  "release:solzero": minor
---

## Route model traffic

<!-- creative: {"title":"  Reliable model routing  ","bullets":["One gateway."],"workType":"feature"} -->

SolZero routes model traffic through one gateway.
`)
        return yield* createReleaseCardInput({ version: "1.5.0", entries: [entry] })
      }),
    )

    expect(input.highlights[0]).toMatchObject({
      title: "Reliable model routing",
      bullets: ["One gateway."],
      workType: "feature",
    })
  })

  it("rejects unknown creative directive fields", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        parseTegamiReleaseEntry(`## Release update

<!-- creative: {"title":"Release update","prompt":"Write better copy"} -->
`),
      ),
    )

    expect(error).toMatchObject({
      _tag: "ReleaseCardDataError",
      operation: "parse-entry",
    })
  })

  it("validates custom JSON input", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        decodeReleaseCardInputJson(
          JSON.stringify({
            version: "1.5.0",
            title: "Release update",
            highlights: [{ title: "Update", description: "Details", workType: "feat" }],
          }),
        ),
      ),
    )

    expect(error).toMatchObject({
      _tag: "ReleaseCardDataError",
      operation: "decode-input",
    })
  })
})
